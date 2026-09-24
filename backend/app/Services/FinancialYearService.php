<?php

namespace App\Services;

use App\Models\Account;
use App\Models\AccountingPeriod;
use App\Models\FiscalYearClose;
use App\Models\Journal;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Year-end close: every income and expense account is brought to zero and
 * the net result goes to "accumulated surplus" (reserve fund) for the AGM
 * to distribute. All months of the year are then closed for good.
 */
class FinancialYearService
{
    public const MODULE = 'year_close';

    public function __construct(private LedgerService $ledger) {}

    /** "2026-27" (or "2026" for a January year) → [start, end]. */
    public function range(string $fy): array
    {
        if (! preg_match('/^(\d{4})(-\d{2})?$/', $fy, $m)) {
            throw ValidationException::withMessages(['fiscal_year' => __('অর্থবছর সঠিক নয়।')]);
        }
        $startMonth = (int) (SettingService::get('fiscal_year_start_month') ?: 7);
        $start = Carbon::create((int) $m[1], $startMonth, 1)->startOfDay();

        return [$start->toDateString(), $start->copy()->addYear()->subDay()->toDateString()];
    }

    /** Years that have any accounting activity, newest first, with their close status. */
    public function years(): array
    {
        $current = $this->ledger->fiscalYear(now());
        $years = AccountingPeriod::whereNotNull('fiscal_year')->distinct()->pluck('fiscal_year')->push($current)->unique()->sortDesc()->values();
        $closes = FiscalYearClose::with('closer:id,name_bn,name_en', 'journal:id,voucher_no')->get()->keyBy('fiscal_year');

        return $years->map(function ($fy) use ($closes, $current) {
            [$start, $end] = $this->range($fy);

            return ['fiscal_year' => $fy, 'start_date' => $start, 'end_date' => $end, 'is_current' => $fy === $current,
                'close' => $closes[$fy] ?? null];
        })->all();
    }

    public function preview(string $fy): array
    {
        [$start, $end] = $this->range($fy);
        $lines = $this->closingBalances($start, $end);
        $income = round(-$lines->where('type', 'income')->sum('net'), 2);
        $expense = round($lines->where('type', 'expense')->sum('net'), 2);
        $problems = [];
        if (FiscalYearClose::where('fiscal_year', $fy)->exists()) {
            $problems[] = __('এই অর্থবছর ইতিমধ্যে বন্ধ করা হয়েছে।');
        }
        if (! Carbon::parse($end)->lt(today())) {
            $problems[] = __('অর্থবছর শেষ হওয়ার আগে বন্ধ করা যাবে না।');
        }
        $pending = Journal::whereBetween('date', [$start, $end])->whereIn('status', ['pending', 'returned'])->count();
        if ($pending) {
            $problems[] = __('এই বছরে :n টি ভাউচার অনুমোদনের অপেক্ষায় বা ফেরত আছে; আগে নিষ্পত্তি করুন।', ['n' => $pending]);
        }
        $earlier = collect($this->years())->filter(fn ($y) => $y['end_date'] < $start && ! $y['close'])->pluck('fiscal_year');
        if ($earlier->isNotEmpty()) {
            $problems[] = __('আগের অর্থবছর (:years) আগে বন্ধ করুন।', ['years' => $earlier->sort()->implode(', ')]);
        }

        return [
            'fiscal_year' => $fy, 'start_date' => $start, 'end_date' => $end,
            'income_total' => $income, 'expense_total' => $expense, 'surplus' => round($income - $expense, 2),
            'accounts' => $lines->map(fn ($l) => ['code' => $l->code, 'name_bn' => $l->name_bn, 'name_en' => $l->name_en, 'type' => $l->type,
                'amount' => round($l->type === 'income' ? -$l->net : $l->net, 2)])->values(),
            'open_periods' => AccountingPeriod::where('fiscal_year', $fy)->where('status', 'open')->count(),
            'problems' => $problems, 'can_close' => $problems === [],
        ];
    }

    public function close(string $fy, ?string $note, int $userId): FiscalYearClose
    {
        $p = $this->preview($fy);
        if (! $p['can_close']) {
            throw ValidationException::withMessages(['fiscal_year' => $p['problems'][0]]);
        }

        return DB::transaction(function () use ($fy, $p, $note, $userId) {
            $journal = null;
            $lines = $this->closingBalances($p['start_date'], $p['end_date'])->map(fn ($l) => [
                'account_id' => $l->id, 'debit' => $l->net < 0 ? -$l->net : 0, 'credit' => $l->net > 0 ? $l->net : 0,
                'remarks' => __('বছর শেষে শূন্য করা হলো'),
            ])->values()->all();

            if ($lines) {
                $surplus = $p['surplus'];
                $lines[] = ['account_id' => Account::byKey('accumulated_surplus')->id,
                    'debit' => $surplus < 0 ? -$surplus : 0, 'credit' => $surplus > 0 ? $surplus : 0,
                    'remarks' => $surplus >= 0 ? __('বছরের উদ্বৃত্ত') : __('বছরের ঘাটতি')];
                $lines = array_values(array_filter($lines, fn ($l) => $l['debit'] > 0 || $l['credit'] > 0));

                // The last month may already be closed monthly; open it just for this entry.
                $last = AccountingPeriod::where('period_key', substr($p['end_date'], 0, 7))->first();
                $wasClosed = $last?->status === 'closed';
                $wasClosed && $last->update(['status' => 'open']);
                $journal = $this->ledger->postNow('journal', $p['end_date'],
                    __(':fy অর্থবছরের সমাপনী এন্ট্রি — আয়-ব্যয় পুঞ্জীভূত উদ্বৃত্তে স্থানান্তর', ['fy' => $fy]), $lines, self::MODULE);
            }

            // Make sure every month exists, then close them all.
            $cursor = Carbon::parse($p['start_date']);
            while ($cursor->toDateString() <= $p['end_date']) {
                AccountingPeriod::firstOrCreate(['period_key' => $cursor->format('Y-m')], [
                    'fiscal_year' => $fy, 'start_date' => $cursor->copy()->startOfMonth()->toDateString(),
                    'end_date' => $cursor->copy()->endOfMonth()->toDateString(), 'status' => 'open',
                ]);
                $cursor->addMonth();
            }
            AccountingPeriod::whereBetween('start_date', [$p['start_date'], $p['end_date']])->where('status', 'open')
                ->update(['status' => 'closed', 'closed_by' => $userId, 'closed_at' => now()]);

            return FiscalYearClose::create([
                'fiscal_year' => $fy, 'start_date' => $p['start_date'], 'end_date' => $p['end_date'],
                'income_total' => $p['income_total'], 'expense_total' => $p['expense_total'], 'surplus' => $p['surplus'],
                'journal_id' => $journal?->id, 'note' => $note, 'closed_by' => $userId, 'closed_at' => now(),
            ]);
        });
    }

    public function isClosed(?string $fy): bool
    {
        return $fy !== null && FiscalYearClose::where('fiscal_year', $fy)->exists();
    }

    /** Income/expense accounts with their net (debit − credit) movement in the year. */
    private function closingBalances(string $start, string $end)
    {
        return DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->join('chart_of_accounts as a', 'a.id', '=', 'journal_lines.account_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)->whereBetween('journals.date', [$start, $end])
            ->where(fn ($w) => $w->whereNull('journals.module')->orWhere('journals.module', '!=', self::MODULE))
            ->whereIn('a.type', ['income', 'expense'])
            ->groupBy('a.id', 'a.code', 'a.name_bn', 'a.name_en', 'a.type')->orderBy('a.code')
            ->selectRaw('a.id, a.code, a.name_bn, a.name_en, a.type, ROUND(SUM(journal_lines.debit) - SUM(journal_lines.credit), 2) as net')
            ->get()->map(function ($r) {
                $r->net = round((float) $r->net, 2);

                return $r;
            })->filter(fn ($r) => $r->net != 0)->values();
    }
}
