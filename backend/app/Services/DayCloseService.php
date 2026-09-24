<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\DayClose;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Day-end cash reconciliation: for every cash stream,
 * opening + collections − payments = expected closing, counted against
 * the cash actually in the drawer. Closing a day freezes cash on it (and
 * before it); reopening needs approval and only the latest closed day can
 * be reopened.
 */
class DayCloseService
{
    public function __construct(private LedgerService $ledger, private ApprovalService $approvals) {}

    /** What the books say for the day, per cash stream and per module. */
    public function summary(string $date): array
    {
        $accounts = Account::whereIn('key', Account::CASH_STREAMS)->orderBy('code')->get();
        $streams = [];
        foreach ($accounts as $acc) {
            $moves = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
                ->where('journal_lines.account_id', $acc->id)->whereIn('journals.status', LedgerService::EFFECTIVE)
                ->where('journals.date', $date)
                ->selectRaw('COALESCE(journals.module, ?) module, SUM(journal_lines.debit) dr, SUM(journal_lines.credit) cr, COUNT(*) n', ['accounting'])
                ->groupBy('module')->get();
            $opening = $this->ledger->balance($acc->id, $date, true);
            $in = round((float) $moves->sum('dr'), 2);
            $out = round((float) $moves->sum('cr'), 2);
            $streams[] = [
                'account_id' => $acc->id, 'key' => $acc->key, 'code' => $acc->code, 'name_bn' => $acc->name_bn, 'name_en' => $acc->name_en,
                'opening' => $opening, 'collections' => $in, 'payments' => $out, 'expected' => round($opening + $in - $out, 2),
                'modules' => $moves->map(fn ($m) => ['module' => $m->module, 'collections' => round((float) $m->dr, 2), 'payments' => round((float) $m->cr, 2), 'count' => (int) $m->n])->values(),
            ];
        }
        $sum = fn (string $k) => round(array_sum(array_column($streams, $k)), 2);
        $vouchers = DB::table('journals')->join('journal_lines', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journal_lines.account_id', $accounts->pluck('id'))->whereIn('journals.status', LedgerService::EFFECTIVE)
            ->where('journals.date', $date)
            ->select('journals.id', 'journals.voucher_no', 'journals.voucher_type', 'journals.narration', 'journals.module',
                'journal_lines.account_id', 'journal_lines.debit', 'journal_lines.credit')
            ->orderBy('journals.id')->get()
            ->map(fn ($v) => (array) $v + ['debit' => (float) $v->debit, 'credit' => (float) $v->credit]);
        $pending = DB::table('journals')->join('journal_lines', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journal_lines.account_id', $accounts->pluck('id'))->where('journals.status', 'pending')
            ->where('journals.date', $date)->distinct()->count('journals.id');

        $last = DayClose::lastClosed();

        return [
            'date' => $date, 'streams' => $streams,
            'opening' => $sum('opening'), 'collections' => $sum('collections'), 'payments' => $sum('payments'), 'expected' => $sum('expected'),
            'vouchers' => $vouchers, 'pending_vouchers' => $pending,
            'close' => DayClose::with(['closer:id,name_bn,name_en', 'reopener:id,name_bn,name_en'])->whereDate('date', $date)->first(),
            'last_closed' => $last?->date->toDateString(),
        ];
    }

    /**
     * @param  array<int, float>  $actual  account_id => cash counted
     */
    public function close(string $date, array $actual, ?string $note, ?array $denominations = null): DayClose
    {
        if ($date > now()->toDateString()) {
            throw ValidationException::withMessages(['date' => __('ভবিষ্যতের দিন বন্ধ করা যায় না।')]);
        }
        $last = DayClose::lastClosed();
        if ($last && $date <= $last->date->toDateString()) {
            throw ValidationException::withMessages(['date' => __(':date পর্যন্ত দিন আগেই বন্ধ করা হয়েছে।', ['date' => $last->date->format('d/m/Y')])]);
        }

        return DB::transaction(function () use ($date, $actual, $note, $denominations) {
            $summary = $this->summary($date);
            if ($summary['pending_vouchers'] > 0) {
                throw ValidationException::withMessages(['date' => __('এই দিনের :n টি নগদ ভাউচার অনুমোদনের অপেক্ষায় আছে; আগে সেগুলো নিষ্পত্তি করুন।', ['n' => $summary['pending_vouchers']])]);
            }
            $breakdown = [];
            foreach ($summary['streams'] as $s) {
                $counted = round((float) ($actual[$s['account_id']] ?? $actual[(string) $s['account_id']] ?? $s['expected']), 2);
                $breakdown[] = collect($s)->except('modules')->all() + ['actual' => $counted, 'difference' => round($counted - $s['expected'], 2)];
            }
            $actualTotal = round(array_sum(array_column($breakdown, 'actual')), 2);
            $difference = round($actualTotal - $summary['expected'], 2);
            if (collect($breakdown)->contains(fn ($b) => $b['difference'] != 0) && trim((string) $note) === '') {
                throw ValidationException::withMessages(['note' => __('গরমিল আছে — কারণ লিখুন।')]);
            }
            $existing = DayClose::whereDate('date', $date)->first();
            $data = [
                'date' => $date, 'opening' => $summary['opening'], 'collections' => $summary['collections'], 'payments' => $summary['payments'],
                'expected' => $summary['expected'], 'actual' => $actualTotal, 'difference' => $difference, 'breakdown' => $breakdown,
                'denominations' => $denominations, 'note' => $note, 'status' => 'closed', 'closed_by' => auth()->id(), 'closed_at' => now(),
                'reopen_reason' => null,
            ];

            return $existing ? tap($existing)->update($data) : DayClose::create($data);
        });
    }

    public function requestReopen(DayClose $day, string $reason): ApprovalRequest
    {
        if ($day->status !== 'closed') {
            throw ValidationException::withMessages(['day' => $day->status === 'reopen_pending'
                ? __('এই দিন খোলার অনুরোধ অনুমোদনের অপেক্ষায় আছে।') : __('দিনটি বন্ধ নেই।')]);
        }
        if (DayClose::lastClosed()?->id !== $day->id) {
            throw ValidationException::withMessages(['day' => __('শুধু সর্বশেষ বন্ধ দিনটি খোলা যায়; পরের দিনগুলো আগে খুলুন।')]);
        }

        return DB::transaction(function () use ($day, $reason) {
            $day->update(['status' => 'reopen_pending', 'reopen_reason' => $reason]);

            return $this->approvals->submit(
                'cash.day_reopen',
                __('বন্ধ দিন খোলা: :date', ['date' => $day->date->format('d/m/Y')]),
                $day,
                ['তারিখ' => $day->date->format('d/m/Y'), 'প্রত্যাশিত জের' => (float) $day->expected, 'প্রকৃত নগদ' => (float) $day->actual,
                    'গরমিল' => (float) $day->difference, 'কারণ' => $reason],
            );
        });
    }

    /** Approval handler. */
    public function reopen(DayClose $day): void
    {
        $day->update(['status' => 'reopened', 'reopened_by' => auth()->id(), 'reopened_at' => now()]);
    }

    public function keepClosed(DayClose $day): void
    {
        DayClose::whereKey($day->id)->where('status', 'reopen_pending')->update(['status' => 'closed']);
    }

    /** Days with cash movement that were never closed, oldest first (up to yesterday). */
    public function unclosedDays(int $limit = 31): array
    {
        $from = DayClose::lastClosed()?->date->copy()->addDay()->toDateString();
        $ids = Account::whereIn('key', Account::CASH_STREAMS)->pluck('id');
        $q = DB::table('journals')->join('journal_lines', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journal_lines.account_id', $ids)->whereIn('journals.status', LedgerService::EFFECTIVE)
            ->where('journals.date', '<', now()->toDateString());
        if ($from) {
            $q->where('journals.date', '>=', $from);
        }

        return $q->distinct()->orderBy('journals.date')->limit($limit)->pluck('journals.date')
            ->map(fn ($d) => Carbon::parse($d)->toDateString())->all();
    }
}
