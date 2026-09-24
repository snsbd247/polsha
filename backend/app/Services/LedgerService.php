<?php

namespace App\Services;

use App\Models\Account;
use App\Models\AccountingPeriod;
use App\Models\ApprovalRequest;
use App\Models\DayClose;
use App\Models\Journal;
use App\Models\MembershipApplication;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The only way money enters the ledger. Every journal is double-entry
 * (debits = credits), lands in an open monthly period, and is never edited
 * once posted — mistakes are corrected with a reversal voucher.
 */
class LedgerService
{
    /** Statuses whose lines count in balances (a reversed voucher stays in, its reversal cancels it). */
    public const EFFECTIVE = ['posted', 'reversed'];

    public function __construct(private ApprovalService $approvals) {}

    /**
     * Post straight away (cash/bank vouchers, system postings).
     *
     * @param  array<int, array{account_id:int, debit?:float|string|null, credit?:float|string|null, remarks?:?string}>  $lines
     */
    public function postNow(string $type, string $date, ?string $narration, array $lines, ?string $module = null, ?Model $source = null): Journal
    {
        return DB::transaction(function () use ($type, $date, $narration, $lines, $module, $source) {
            $journal = $this->make($type, $date, $narration, $lines, $module, $source, 'posted');
            $journal->update(['posted_by' => auth()->id(), 'posted_at' => now()]);

            return $journal;
        });
    }

    /** Manual journal / opening balance: saved as pending until a manager approves it. */
    public function submit(string $type, string $date, ?string $narration, array $lines): Journal
    {
        return DB::transaction(function () use ($type, $date, $narration, $lines) {
            $journal = $this->make($type, $date, $narration, $lines, 'accounting', null, 'pending');
            $this->requestApproval($journal);

            return $journal->fresh();
        });
    }

    /** Correct a voucher that was sent back, then send it for approval again. */
    public function resubmit(Journal $journal, string $date, ?string $narration, array $lines): Journal
    {
        if ($journal->status !== 'returned') {
            throw ValidationException::withMessages(['journal' => __('শুধু ফেরত আসা ভাউচার সংশোধন করা যায়।')]);
        }

        return DB::transaction(function () use ($journal, $date, $narration, $lines) {
            $clean = $this->validateLines($lines);
            $period = $this->openPeriodFor($date);
            $journal->lines()->delete();
            $journal->lines()->createMany($clean);
            $journal->update([
                'date' => $date, 'narration' => $narration, 'period_id' => $period->id, 'status' => 'pending',
                'amount' => array_sum(array_column($clean, 'debit')),
            ]);
            $this->requestApproval($journal);

            return $journal->fresh();
        });
    }

    /** Approval handler: pending → posted. */
    public function approve(Journal $journal): void
    {
        if ($journal->status !== 'pending') {
            return;
        }
        $this->openPeriodFor($journal->date->toDateString());
        $this->guardClosedDay($journal->date->toDateString(), $journal->lines()->pluck('account_id')->all());
        $journal->update(['status' => 'posted', 'posted_by' => auth()->id(), 'posted_at' => now()]);
    }

    public function requestReversal(Journal $journal, string $reason): ApprovalRequest
    {
        if ($journal->status !== 'posted' || $journal->reversal_of_id) {
            throw ValidationException::withMessages(['journal' => __('শুধু পোস্টেড ভাউচার রিভার্স করা যায়।')]);
        }
        $pending = ApprovalRequest::where('action_key', 'accounting.reversal')->where('status', ApprovalRequest::PENDING)
            ->where('approvable_type', Journal::class)->where('approvable_id', $journal->id)->exists();
        if ($pending) {
            throw ValidationException::withMessages(['journal' => __('এই ভাউচারের রিভার্সাল অনুমোদনের অপেক্ষায় আছে।')]);
        }

        return $this->approvals->submit(
            'accounting.reversal',
            __('ভাউচার রিভার্সাল: :no', ['no' => $journal->voucher_no]),
            $journal,
            ['ভাউচার' => $journal->voucher_no, 'পরিমাণ' => $journal->amount, 'কারণ' => $reason],
            null,
            (float) $journal->amount,
        );
    }

    /** Approval handler: book the mirror-image voucher (today) and mark the original reversed. */
    public function reverse(Journal $journal, ?string $reason = null): Journal
    {
        return DB::transaction(function () use ($journal, $reason) {
            $journal = Journal::whereKey($journal->id)->lockForUpdate()->firstOrFail();
            if ($journal->status !== 'posted') {
                throw ValidationException::withMessages(['journal' => __('শুধু পোস্টেড ভাউচার রিভার্স করা যায়।')]);
            }
            $lines = $journal->lines->map(fn ($l) => [
                'account_id' => $l->account_id, 'debit' => $l->credit, 'credit' => $l->debit, 'remarks' => $l->remarks,
            ])->all();
            $narration = __('রিভার্সাল: :no', ['no' => $journal->voucher_no]).($reason ? ' — '.$reason : '');
            $reversal = $this->make($journal->voucher_type === 'opening' ? 'journal' : $journal->voucher_type,
                now()->toDateString(), $narration, $lines, $journal->module, $journal->source, 'posted', false);
            $reversal->update(['reversal_of_id' => $journal->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
            $journal->update(['status' => 'reversed', 'reversed_by_id' => $reversal->id]);

            return $reversal;
        });
    }

    /**
     * Membership admission fee → ledger. Idempotent (one voucher per
     * application) so the backfill command can be run any number of times.
     */
    public function postAdmissionFee(MembershipApplication $app, ?string $date = null): ?Journal
    {
        if ((float) $app->admission_fee <= 0 || ! $app->member_id) {
            return null;
        }
        $exists = Journal::where('source_type', $app->getMorphClass())->where('source_id', $app->id)->exists();
        if ($exists) {
            return null;
        }
        $debit = Account::byKey($app->fee_status === 'due' ? 'accounts_receivable' : 'cash_society');
        $income = Account::byKey('admission_fee_income');
        $date ??= $app->member?->admitted_on?->toDateString() ?? now()->toDateString();

        return $this->postNow(
            $app->fee_status === 'due' ? 'journal' : 'receipt',
            $date,
            __('ভর্তি ফি — আবেদন :no', ['no' => $app->application_no]),
            [
                ['account_id' => $debit->id, 'debit' => $app->admission_fee],
                ['account_id' => $income->id, 'credit' => $app->admission_fee],
            ],
            'membership',
            $app,
        );
    }

    /** Signed balance (debit − credit) of one account up to and including a date. */
    public function balance(int $accountId, ?string $asOf = null, bool $before = false): float
    {
        $q = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->where('journal_lines.account_id', $accountId)->whereIn('journals.status', self::EFFECTIVE);
        if ($asOf) {
            $q->where('journals.date', $before ? '<' : '<=', $asOf);
        }

        return round((float) $q->sum(DB::raw('journal_lines.debit - journal_lines.credit')), 2);
    }

    public function openPeriodFor(string $date): AccountingPeriod
    {
        $d = Carbon::parse($date);
        $period = AccountingPeriod::firstOrCreate(['period_key' => $d->format('Y-m')], [
            'fiscal_year' => $this->fiscalYear($d),
            'start_date' => $d->copy()->startOfMonth()->toDateString(),
            'end_date' => $d->copy()->endOfMonth()->toDateString(),
            'status' => 'open',
        ]);
        if ($period->status !== 'open') {
            throw ValidationException::withMessages(['date' => __(':period মাসের হিসাব বন্ধ করা হয়েছে; এই তারিখে এন্ট্রি দেওয়া যাবে না।', ['period' => $period->period_key])]);
        }

        return $period;
    }

    public function fiscalYear(Carbon $d): string
    {
        $start = (int) (SettingService::get('fiscal_year_start_month') ?: 7);
        $y = $d->month >= $start ? $d->year : $d->year - 1;

        return $start === 1 ? (string) $y : $y.'-'.substr((string) ($y + 1), 2);
    }

    private function make(string $type, string $date, ?string $narration, array $lines, ?string $module, ?Model $source, string $status, bool $checkFunds = true): Journal
    {
        if (! isset(Journal::TYPES[$type])) {
            throw ValidationException::withMessages(['voucher_type' => __('অজানা ভাউচারের ধরন।')]);
        }
        $clean = $this->validateLines($lines);
        $period = $this->openPeriodFor($date);
        $this->guardClosedDay($date, array_column($clean, 'account_id'));

        $journal = Journal::create([
            'voucher_no' => SequenceService::next(Journal::SEQUENCES[$type]),
            'voucher_type' => $type,
            'date' => $date,
            'narration' => $narration,
            'module' => $module,
            'source_type' => $source?->getMorphClass(),
            'source_id' => $source?->getKey(),
            'period_id' => $period->id,
            'status' => $status,
            'amount' => array_sum(array_column($clean, 'debit')),
            'created_by' => auth()->id(),
        ]);
        $journal->lines()->createMany($clean);

        if ($status === 'posted' && $checkFunds) {
            $this->guardFunds($journal);
        }

        return $journal;
    }

    /** Once a day's cash is counted and closed, no cash voucher may land on it (or before it). */
    public function guardClosedDay(string $date, array $accountIds): void
    {
        $touchesCash = Account::whereIn('id', array_unique($accountIds))->whereIn('key', Account::CASH_STREAMS)->exists();
        if ($touchesCash && ($closed = DayClose::lockedOn($date))) {
            throw ValidationException::withMessages(['date' => __(':date তারিখ পর্যন্ত দিন বন্ধ (ক্যাশ মিলানো) করা হয়েছে; এই তারিখে নগদ লেনদেন করা যাবে না।', [
                'date' => $closed->date->format('d/m/Y'),
            ])]);
        }
    }

    /** Cash in hand and bank balances may not go below zero. */
    private function guardFunds(Journal $journal): void
    {
        $credited = $journal->lines()->where('credit', '>', 0)->pluck('account_id')->unique();
        $funds = Account::whereIn('id', $credited)->where(fn ($q) => $q->whereIn('key', Account::CASH_STREAMS)->orWhereHas('bankAccount'))->get();
        foreach ($funds as $acc) {
            $bal = $this->balance($acc->id);
            if ($bal < 0) {
                throw ValidationException::withMessages(['amount' => __(':account-এ পর্যাপ্ত টাকা নেই (ঘাটতি :amount)।', [
                    'account' => app()->getLocale() === 'en' && $acc->name_en ? $acc->name_en : $acc->name_bn,
                    'amount' => number_format(-$bal, 2),
                ])]);
            }
        }
    }

    /** @return array<int, array{account_id:int, debit:float, credit:float, remarks:?string}> */
    private function validateLines(array $lines): array
    {
        $clean = [];
        foreach (array_values($lines) as $i => $l) {
            $debit = round((float) ($l['debit'] ?? 0), 2);
            $credit = round((float) ($l['credit'] ?? 0), 2);
            if ($debit < 0 || $credit < 0 || ($debit > 0) === ($credit > 0)) {
                throw ValidationException::withMessages(["lines.$i" => __('প্রতিটি লাইনে হয় ডেবিট নয়তো ক্রেডিট দিতে হবে (একটি)।')]);
            }
            $clean[] = ['account_id' => (int) $l['account_id'], 'debit' => $debit, 'credit' => $credit, 'remarks' => $l['remarks'] ?? null];
        }
        if (count($clean) < 2) {
            throw ValidationException::withMessages(['lines' => __('কমপক্ষে দুটি লাইন লাগবে।')]);
        }
        $dr = round(array_sum(array_column($clean, 'debit')), 2);
        $cr = round(array_sum(array_column($clean, 'credit')), 2);
        if ($dr !== $cr) {
            throw ValidationException::withMessages(['lines' => __('ডেবিট (:dr) ও ক্রেডিট (:cr) সমান নয়।', ['dr' => number_format($dr, 2), 'cr' => number_format($cr, 2)])]);
        }

        $ids = array_unique(array_column($clean, 'account_id'));
        $ok = Account::whereIn('id', $ids)->where('is_postable', true)->where('is_active', true)->count();
        if ($ok !== count($ids)) {
            throw ValidationException::withMessages(['lines' => __('শুধু সক্রিয় লেনদেনযোগ্য হিসাবে পোস্ট করা যায়।')]);
        }

        return $clean;
    }

    private function requestApproval(Journal $journal): void
    {
        $journal->load('lines.account');
        // Payload keys are shown translated on the approval page, so line keys stay language-neutral.
        $payload = ['ভাউচার' => $journal->voucher_no, 'তারিখ' => $journal->date->format('d/m/Y'), 'বিবরণ' => $journal->narration];
        foreach ($journal->lines as $i => $l) {
            $payload['#'.($i + 1).' '.$l->account->code] = ($l->debit > 0 ? 'Dr '.$l->debit : 'Cr '.$l->credit)
                .' — '.$l->account->name_bn.($l->account->name_en ? ' / '.$l->account->name_en : '');
        }
        $request = $this->approvals->submit(
            'accounting.journal',
            __('জার্নাল ভাউচার: :no', ['no' => $journal->voucher_no]),
            $journal,
            $payload,
            null,
            (float) $journal->amount,
        );
        // submit() may have auto-approved (rule disabled) and already posted it.
        $journal->refresh();
        $journal->update(['approval_request_id' => $request->id]);
    }
}
