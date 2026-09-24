<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\Loan;
use App\Models\LoanInstallment;
use App\Models\LoanPayment;
use App\Models\LoanProduct;
use App\Models\Member;
use App\Models\MemberAccount;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Loans: application → approval → disbursement → instalments → closed.
 *
 * The schedule is fixed at disbursement. Penalty is a % per month on the
 * unpaid instalment money, counted day by day once the grace days are over,
 * and stored on the instalment up to the last payment date. A payment goes to
 * penalty first, then interest, then principal; the voucher keeps the three
 * in separate ledger accounts (penalty and interest income on receipt).
 *
 * Only the latest payment of a loan can be cancelled: its snapshot puts the
 * instalments back exactly as they were, so earlier splits never move.
 */
class LoanService
{
    public const PERIODS_PER_YEAR = ['monthly' => 12, 'weekly' => 52, 'quarterly' => 4];

    public const BUCKETS = ['1_30' => '১–৩০ দিন', '31_90' => '৩১–৯০ দিন', '90_plus' => '৯০+ দিন'];

    public function __construct(
        private LedgerService $ledger,
        private ApprovalService $approvals,
        private ReceiptService $receipts,
    ) {}

    // ---- schedule ----

    /** First instalment one period after disbursement (one-time: after the term). */
    public function defaultFirstDue(array $terms, string $disbursedOn): string
    {
        $d = Carbon::parse($disbursedOn);

        $due = match ($terms['frequency']) {
            'weekly' => $d->addWeek(),
            'quarterly' => $d->addMonthsNoOverflow(3),
            'one_time' => $d->addMonthsNoOverflow(max(1, (int) ($terms['term_months'] ?? 1))),
            default => $d->addMonthNoOverflow(),
        };

        return $due->toDateString();
    }

    /**
     * Instalment rows with principal and interest apart. Flat charges the
     * yearly rate on the full amount for the whole term; declining charges
     * each period's rate on the balance still owed (equal instalments).
     *
     * @param  array{interest_rate:float|string, interest_method:string, frequency:string, installments:int, term_months?:?int}  $terms
     * @return array<int, array{seq:int, due_date:string, principal:float, interest:float}>
     */
    public function buildSchedule(array $terms, float $amount, string $firstDue): array
    {
        $oneTime = $terms['frequency'] === 'one_time';
        $n = $oneTime ? 1 : max(1, (int) $terms['installments']);
        $rate = (float) $terms['interest_rate'] / 100;
        $years = $oneTime ? max(1, (int) ($terms['term_months'] ?? 1)) / 12 : $n / self::PERIODS_PER_YEAR[$terms['frequency']];
        $paisa = (int) round($amount * 100);

        $principal = [];
        $interest = [];
        if ($terms['interest_method'] === 'declining' && ! $oneTime && $rate > 0) {
            $i = $rate / self::PERIODS_PER_YEAR[$terms['frequency']];
            $emi = $amount * $i / (1 - (1 + $i) ** -$n);
            $left = $paisa;
            for ($k = 1; $k <= $n; $k++) {
                $int = (int) round($left * $i);
                $pr = $k === $n ? $left : min($left, max(0, (int) round($emi * 100) - $int));
                $principal[] = $pr;
                $interest[] = $int;
                $left -= $pr;
            }
        } else {
            $principal = $this->split($paisa, $n);
            $interest = $this->split((int) round($amount * $rate * $years * 100), $n);
        }

        $first = Carbon::parse($firstDue);
        $rows = [];
        for ($k = 0; $k < $n; $k++) {
            $due = match ($terms['frequency']) {
                'weekly' => $first->copy()->addWeeks($k),
                'quarterly' => $first->copy()->addMonthsNoOverflow(3 * $k),
                default => $first->copy()->addMonthsNoOverflow($k),
            };
            $rows[] = ['seq' => $k + 1, 'due_date' => $due->toDateString(), 'principal' => $principal[$k] / 100, 'interest' => $interest[$k] / 100];
        }

        return $rows;
    }

    // ---- eligibility ----

    /** min(product limit, multiplier × (savings + share balance)). */
    public function limitFor(Member $member, LoanProduct $product): array
    {
        $balances = MemberAccount::where('member_id', $member->id)->pluck('balance', 'kind');
        $savings = round((float) ($balances['savings'] ?? 0), 2);
        $share = round((float) ($balances['share'] ?? 0), 2);
        $multiplier = $product->savings_multiplier !== null ? (float) $product->savings_multiplier : null;
        $byDeposit = $multiplier !== null ? round($multiplier * ($savings + $share), 2) : null;

        return [
            'product_max' => (float) $product->max_amount, 'savings' => $savings, 'share' => $share,
            'multiplier' => $multiplier, 'by_deposit' => $byDeposit,
            'limit' => $byDeposit === null ? (float) $product->max_amount : min((float) $product->max_amount, $byDeposit),
        ];
    }

    public function openLoan(int $memberId, ?int $except = null): ?Loan
    {
        return Loan::where('member_id', $memberId)->whereIn('status', Loan::OPEN)->when($except, fn ($q) => $q->whereKeyNot($except))->first();
    }

    /** Running loans (open) this member already stands guarantor for. */
    public function guaranteeCount(int $memberId, ?int $exceptLoan = null): int
    {
        return DB::table('loan_guarantors')->join('loans', 'loans.id', '=', 'loan_guarantors.loan_id')
            ->where('loan_guarantors.member_id', $memberId)->whereIn('loans.status', Loan::OPEN)
            ->when($exceptLoan, fn ($q) => $q->where('loans.id', '!=', $exceptLoan))->count();
    }

    // ---- application ----

    /**
     * @param  array{member_id:int, product_id:int, applied_on:string, amount:float, purpose?:?string, remarks?:?string, guarantors:array<int, array{member_id:int, relation?:?string}>}  $data
     */
    public function apply(array $data): Loan
    {
        $member = Member::with('farmer')->findOrFail($data['member_id']);
        $product = LoanProduct::findOrFail($data['product_id']);
        if ($member->status !== Member::ACTIVE) {
            throw ValidationException::withMessages(['member_id' => __('শুধু সক্রিয় সদস্য ঋণের আবেদন করতে পারেন।')]);
        }
        if (! $product->is_active) {
            throw ValidationException::withMessages(['product_id' => __('এই ঋণের ধরনটি বন্ধ আছে।')]);
        }
        if ($open = $this->openLoan($member->id)) {
            throw ValidationException::withMessages(['member_id' => __('এই সদস্যের একটি ঋণ চলমান বা অপেক্ষমাণ আছে (:no)। একসাথে একটির বেশি ঋণ দেওয়া যায় না।', ['no' => $open->loan_no])]);
        }
        $amount = round((float) $data['amount'], 2);
        $limit = $this->limitFor($member, $product);
        if ($amount <= 0 || $amount > $limit['limit']) {
            throw ValidationException::withMessages(['amount' => __('এই সদস্যের ঋণসীমা :limit টাকা।', ['limit' => number_format($limit['limit'], 2)])]);
        }
        $guarantors = $this->checkGuarantors($member, $product, $data['guarantors'] ?? []);

        return DB::transaction(function () use ($data, $member, $product, $amount, $limit, $guarantors) {
            $loan = Loan::create([
                'loan_no' => SequenceService::next('loan'), 'member_id' => $member->id, 'product_id' => $product->id,
                'applied_on' => $data['applied_on'], 'amount' => $amount, 'purpose' => $data['purpose'] ?? null,
                'interest_rate' => $product->interest_rate, 'interest_method' => $product->interest_method, 'frequency' => $product->frequency,
                'installments' => $product->frequency === 'one_time' ? 1 : $product->installments, 'term_months' => $product->term_months,
                'penalty_rate' => $product->penalty_rate, 'grace_days' => $product->grace_days, 'limit_amount' => $limit['limit'],
                'status' => 'pending', 'remarks' => $data['remarks'] ?? null, 'created_by' => auth()->id(),
            ]);
            foreach ($guarantors as $g) {
                $loan->guarantors()->create($g);
            }
            $preview = $this->buildSchedule($loan->only(['interest_rate', 'interest_method', 'frequency', 'installments', 'term_months']), $amount,
                $this->defaultFirstDue($loan->only(['frequency', 'term_months']), $loan->applied_on->toDateString()));
            $req = $this->approvals->submit(
                'loan.application',
                __('ঋণ আবেদন').': '.$member->farmer?->name_bn.__(' (সদস্য নং ').$member->member_no.')',
                $loan,
                ['ঋণ নং' => $loan->loan_no, 'সদস্য' => $member->farmer?->name_bn.' ('.$member->member_no.')',
                    'ঋণের ধরন' => $product->name_bn, 'টাকার পরিমাণ' => $amount, 'ঋণসীমা' => $limit['limit'],
                    'সুদ' => (float) $product->interest_rate.'% ('.__(LoanProduct::METHODS[$product->interest_method]).')',
                    'কিস্তি' => count($preview).' × '.__(LoanProduct::FREQUENCIES[$product->frequency]),
                    'মোট সুদ' => round(array_sum(array_column($preview, 'interest')), 2),
                    'জামিনদার' => Member::with('farmer')->whereIn('id', array_column($guarantors, 'member_id'))->get()
                        ->map(fn ($g) => $g->farmer?->name_bn.' ('.$g->member_no.')')->implode(', ') ?: '—']
                    + (! empty($data['purpose']) ? ['উদ্দেশ্য' => $data['purpose']] : []),
                null,
                $amount,
            );
            if ($loan->fresh()->status === 'pending') {
                $loan->update(['approval_request_id' => $req->id]);
            }

            return $loan->fresh();
        });
    }

    /** @return array<int, array{member_id:int, relation:?string}> */
    private function checkGuarantors(Member $borrower, LoanProduct $product, array $rows, ?int $exceptLoan = null): array
    {
        $rows = collect($rows)->filter(fn ($g) => ! empty($g['member_id']))->values();
        if ($rows->count() < $product->guarantors_required) {
            throw ValidationException::withMessages(['guarantors' => __('এই ঋণে কমপক্ষে :n জন জামিনদার লাগবে।', ['n' => $product->guarantors_required])]);
        }
        if ($rows->pluck('member_id')->unique()->count() !== $rows->count()) {
            throw ValidationException::withMessages(['guarantors' => __('একই জামিনদার একাধিকবার দেওয়া হয়েছে।')]);
        }
        $max = (int) SettingService::get('loan_max_guarantees', 2);
        $members = Member::with('farmer')->whereIn('id', $rows->pluck('member_id'))->get()->keyBy('id');
        foreach ($rows as $i => $g) {
            $m = $members[$g['member_id']] ?? null;
            $key = "guarantors.$i.member_id";
            if (! $m || $m->status !== Member::ACTIVE) {
                throw ValidationException::withMessages([$key => __('জামিনদারকে অবশ্যই সক্রিয় সদস্য হতে হবে।')]);
            }
            if ($m->id === $borrower->id) {
                throw ValidationException::withMessages([$key => __('ঋণগ্রহীতা নিজে জামিনদার হতে পারেন না।')]);
            }
            if ($this->guaranteeCount($m->id, $exceptLoan) >= $max) {
                throw ValidationException::withMessages([$key => __(':name ইতিমধ্যে :n টি চলমান ঋণের জামিনদার (সর্বোচ্চ :n টি)।', ['name' => $m->farmer?->name_bn, 'n' => $max])]);
            }
        }

        return $rows->map(fn ($g) => ['member_id' => (int) $g['member_id'], 'relation' => $g['relation'] ?? null])->all();
    }

    /** Approval handler. */
    public function approve(Loan $loan): void
    {
        Loan::whereKey($loan->id)->where('status', 'pending')->update(['status' => 'approved']);
    }

    public function reject(Loan $loan): void
    {
        Loan::whereKey($loan->id)->where('status', 'pending')->update(['status' => 'rejected']);
    }

    /** An approved loan that will not be paid out after all. */
    public function cancelApplication(Loan $loan, string $reason): Loan
    {
        if ($loan->status !== 'approved') {
            throw ValidationException::withMessages(['status' => __('শুধু বিতরণ-বাকি অনুমোদিত ঋণ বাতিল করা যায়।')]);
        }
        $loan->update(['status' => 'cancelled', 'remarks' => trim(($loan->remarks ? $loan->remarks.' | ' : '').__('বাতিলের কারণ').': '.$reason)]);

        return $loan;
    }

    // ---- disbursement ----

    /** @param  array{date:string, method:string, fund_account_id?:?int, reference?:?string, first_due_on?:?string}  $data */
    public function disburse(Loan $loan, array $data): Loan
    {
        if ($loan->status !== 'approved') {
            throw ValidationException::withMessages(['status' => __('শুধু অনুমোদিত ঋণ বিতরণ করা যায়।')]);
        }
        if ($loan->member?->status !== Member::ACTIVE) {
            throw ValidationException::withMessages(['status' => __('সদস্য এখন সক্রিয় নন; ঋণ বিতরণ করা যাবে না।')]);
        }
        if ($data['date'] < $loan->applied_on->toDateString()) {
            throw ValidationException::withMessages(['date' => __('বিতরণের তারিখ আবেদনের তারিখের আগে হতে পারে না।')]);
        }
        $firstDue = ! empty($data['first_due_on']) ? $data['first_due_on'] : $this->defaultFirstDue($loan->only(['frequency', 'term_months']), $data['date']);
        if ($firstDue <= $data['date']) {
            throw ValidationException::withMessages(['first_due_on' => __('প্রথম কিস্তির তারিখ বিতরণের পরে হতে হবে।')]);
        }
        if (($data['method'] ?? 'cash') !== 'cash' && empty($data['reference'])) {
            throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
        }
        $fund = $this->receipts->fund('loan', $data['method'] ?? 'cash', $data['fund_account_id'] ?? null);
        $this->ledger->openPeriodFor($data['date']);

        return DB::transaction(function () use ($loan, $data, $firstDue, $fund) {
            $loan = Loan::whereKey($loan->id)->lockForUpdate()->firstOrFail();
            if ($loan->status !== 'approved') {
                throw ValidationException::withMessages(['status' => __('শুধু অনুমোদিত ঋণ বিতরণ করা যায়।')]);
            }
            $rows = $this->buildSchedule($loan->only(['interest_rate', 'interest_method', 'frequency', 'installments', 'term_months']), (float) $loan->amount, $firstDue);
            foreach ($rows as $r) {
                $loan->schedule()->create($r);
            }
            $amount = (float) $loan->amount;
            $journal = $this->ledger->postNow('payment', $data['date'],
                __('ঋণ বিতরণ').' '.$loan->loan_no.' — '.$loan->member?->farmer?->name_bn.' ('.$loan->member?->member_no.')',
                [['account_id' => Account::byKey('loans_receivable')->id, 'debit' => $amount],
                    ['account_id' => $fund->id, 'credit' => $amount, 'remarks' => $data['reference'] ?? null]],
                'loan', $loan);
            $loan->update([
                'status' => 'active', 'disbursed_on' => $data['date'], 'first_due_on' => $firstDue,
                'total_interest' => round(array_sum(array_column($rows, 'interest')), 2),
                'method' => $data['method'] ?? 'cash', 'fund_account_id' => $fund->id, 'reference' => $data['reference'] ?? null,
                'journal_id' => $journal->id, 'disbursed_by' => auth()->id(),
            ]);

            return $loan->fresh();
        });
    }

    // ---- position & penalty ----

    /** Penalty earned on one instalment from the stored point (or grace end) up to $date. */
    public function newPenalty(Loan $loan, LoanInstallment $inst, string $date): float
    {
        $rate = (float) $loan->penalty_rate;
        $base = $inst->outstanding();
        if ($rate <= 0 || $base <= 0) {
            return 0.0;
        }
        $start = $inst->due_date->copy()->addDays((int) $loan->grace_days);
        if ($inst->penalty_to && $inst->penalty_to->gt($start)) {
            $start = $inst->penalty_to->copy();
        }
        $days = (int) $start->diffInDays(Carbon::parse($date), false);

        return $days > 0 ? round($base * $rate / 100 / 30 * $days, 2) : 0.0;
    }

    /**
     * Where a loan stands on a date (nothing saved): what is owed, what is
     * overdue and the penalty so far, per instalment and in total.
     */
    public function position(Loan $loan, ?string $asOf = null, ?Collection $schedule = null): array
    {
        $asOf ??= now()->toDateString();
        $schedule ??= $loan->schedule()->get();
        $rows = [];
        $t = ['principal' => 0.0, 'interest' => 0.0, 'penalty' => 0.0, 'overdue' => 0.0, 'due_now' => 0.0,
            'principal_paid' => 0.0, 'interest_paid' => 0.0, 'penalty_paid' => 0.0];
        $oldest = null;
        foreach ($schedule as $i) {
            $penalty = round((float) $i->penalty_accrued - (float) $i->penalty_paid + $this->newPenalty($loan, $i, $asOf), 2);
            $out = $i->outstanding();
            $dueDate = $i->due_date->toDateString();
            $overdue = $out > 0 && $dueDate < $asOf;
            if ($overdue && ! $oldest) {
                $oldest = $dueDate;
            }
            $t['principal'] += $i->principalDue();
            $t['interest'] += $i->interestDue();
            $t['penalty'] += $penalty;
            $t['principal_paid'] += (float) $i->principal_paid;
            $t['interest_paid'] += (float) $i->interest_paid;
            $t['penalty_paid'] += (float) $i->penalty_paid;
            if ($overdue) {
                $t['overdue'] += $out;
            }
            if ($dueDate <= $asOf) {
                $t['due_now'] += $out;
            }
            $rows[] = $i->only(['id', 'seq', 'principal', 'interest', 'principal_paid', 'interest_paid', 'penalty_paid', 'paid_on'])
                + ['due_date' => $dueDate, 'total' => round((float) $i->principal + (float) $i->interest, 2), 'outstanding' => $out,
                    'penalty_due' => $penalty, 'overdue' => $overdue,
                    'state' => $out <= 0 ? 'paid' : ($overdue ? 'overdue' : ((float) $i->principal_paid + (float) $i->interest_paid > 0 ? 'partial' : 'due'))];
        }
        $t = array_map(fn ($v) => round($v, 2), $t);
        $days = $oldest ? (int) Carbon::parse($oldest)->diffInDays(Carbon::parse($asOf)) : 0;

        return [
            'as_of' => $asOf, 'installments' => $rows,
            'principal_outstanding' => $t['principal'], 'interest_outstanding' => $t['interest'], 'penalty_due' => $t['penalty'],
            'principal_paid' => $t['principal_paid'], 'interest_paid' => $t['interest_paid'], 'penalty_paid' => $t['penalty_paid'],
            'overdue_amount' => $t['overdue'], 'due_now' => round($t['due_now'] + $t['penalty'], 2),
            'payoff' => round($t['principal'] + $t['interest'] + $t['penalty'], 2),
            'days_overdue' => $days, 'oldest_overdue' => $oldest, 'bucket' => self::bucket($days),
        ];
    }

    public static function bucket(int $days): ?string
    {
        return match (true) {
            $days <= 0 => null,
            $days <= 30 => '1_30',
            $days <= 90 => '31_90',
            default => '90_plus',
        };
    }

    // ---- repayment ----

    /** @param  array{date:string, amount:float, method:string, fund_account_id?:?int, reference?:?string, remarks?:?string}  $data */
    public function pay(Loan $loan, array $data): LoanPayment
    {
        if ($loan->status !== 'active') {
            throw ValidationException::withMessages(['loan' => __('শুধু চলমান ঋণের কিস্তি নেওয়া যায়।')]);
        }
        if ($data['date'] < $loan->disbursed_on->toDateString()) {
            throw ValidationException::withMessages(['date' => __('পরিশোধের তারিখ বিতরণের তারিখের আগে হতে পারে না।')]);
        }
        $amount = round((float) $data['amount'], 2);
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => __('টাকার পরিমাণ শূন্যের বেশি হতে হবে।')]);
        }
        if (($data['method'] ?? 'cash') !== 'cash' && empty($data['reference'])) {
            throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
        }
        $fund = $this->receipts->fund('loan', $data['method'] ?? 'cash', $data['fund_account_id'] ?? null);
        $this->ledger->openPeriodFor($data['date']);

        return DB::transaction(function () use ($loan, $data, $amount, $fund) {
            $loan = Loan::with('member.farmer')->whereKey($loan->id)->lockForUpdate()->firstOrFail();
            if ($loan->payments()->where('status', 'cancel_pending')->exists()) {
                throw ValidationException::withMessages(['loan' => __('এই ঋণের একটি পরিশোধ বাতিলের অপেক্ষায় আছে; আগে সেটি নিষ্পত্তি করুন।')]);
            }
            $last = $loan->payments()->where('status', 'posted')->max('date');
            if ($last && $data['date'] < Carbon::parse($last)->toDateString()) {
                throw ValidationException::withMessages(['date' => __('আগের পরিশোধের (:date) আগের তারিখে পরিশোধ নেওয়া যায় না।', ['date' => Carbon::parse($last)->format('d/m/Y')])]);
            }
            $date = $data['date'];
            $schedule = LoanInstallment::where('loan_id', $loan->id)->orderBy('seq')->lockForUpdate()->get();
            $snapshot = $schedule->map(fn ($i) => $i->only(LoanInstallment::STATE) + ['penalty_to' => $i->penalty_to?->toDateString(), 'paid_on' => $i->paid_on?->toDateString()])->all();

            // bring every instalment's penalty up to the payment date
            foreach ($schedule as $i) {
                $new = $this->newPenalty($loan, $i, $date);
                if ($new > 0) {
                    $i->penalty_accrued = round((float) $i->penalty_accrued + $new, 2);
                    $i->penalty_to = $date;
                }
            }
            $payoff = round($schedule->sum(fn ($i) => $i->outstanding() + (float) $i->penalty_accrued - (float) $i->penalty_paid), 2);
            if ($amount > $payoff) {
                throw ValidationException::withMessages(['amount' => __('সর্বোচ্চ পরিশোধযোগ্য :amount টাকা (জরিমানাসহ পুরো ঋণ)।', ['amount' => number_format($payoff, 2)])]);
            }

            // penalty → interest → principal (due instalments first, then advance payments in order)
            $left = (int) round($amount * 100);
            $got = ['penalty' => 0, 'interest' => 0, 'principal' => 0];
            $take = function (LoanInstallment $i, string $part, float $owed) use (&$left, &$got) {
                $p = min($left, (int) round($owed * 100));
                if ($p > 0) {
                    $col = $part.'_paid';
                    $i->{$col} = round((float) $i->{$col} + $p / 100, 2);
                    $left -= $p;
                    $got[$part] += $p;
                }
            };
            foreach ($schedule as $i) {
                $take($i, 'penalty', (float) $i->penalty_accrued - (float) $i->penalty_paid);
            }
            $due = $schedule->filter(fn ($i) => $i->due_date->toDateString() <= $date);
            foreach ($due as $i) {
                $take($i, 'interest', $i->interestDue());
            }
            foreach ($due as $i) {
                $take($i, 'principal', $i->principalDue());
            }
            foreach ($schedule->reject(fn ($i) => $i->due_date->toDateString() <= $date) as $i) {
                $take($i, 'interest', $i->interestDue());
                $take($i, 'principal', $i->principalDue());
            }
            foreach ($schedule as $i) {
                if (! $i->paid_on && $i->outstanding() <= 0) {
                    $i->paid_on = $date;
                }
                $i->save();
            }

            $got = array_map(fn ($p) => $p / 100, $got);
            $principalAfter = round($schedule->sum(fn ($i) => $i->principalDue()), 2);
            $payment = LoanPayment::create([
                'payment_no' => SequenceService::next('loan_payment'), 'loan_id' => $loan->id, 'date' => $date, 'amount' => $amount,
                'penalty' => $got['penalty'], 'interest' => $got['interest'], 'principal' => $got['principal'], 'principal_after' => $principalAfter,
                'method' => $data['method'] ?? 'cash', 'fund_account_id' => $fund->id, 'reference' => $data['reference'] ?? null,
                'remarks' => $data['remarks'] ?? null, 'status' => 'posted', 'snapshot' => $snapshot, 'created_by' => auth()->id(),
            ]);

            $lines = [['account_id' => $fund->id, 'debit' => $amount, 'remarks' => $data['reference'] ?? null]];
            foreach (['penalty' => 'loan_penalty_income', 'interest' => 'loan_interest_income', 'principal' => 'loans_receivable'] as $part => $key) {
                if ($got[$part] > 0) {
                    $lines[] = ['account_id' => Account::byKey($key)->id, 'credit' => $got[$part]];
                }
            }
            $journal = $this->ledger->postNow('receipt', $date,
                __('ঋণ পরিশোধ').' '.$payment->payment_no.' — '.$loan->loan_no.' — '.$loan->member?->farmer?->name_bn, $lines, 'loan', $payment);
            $payment->update(['journal_id' => $journal->id]);

            if ($schedule->every(fn ($i) => $i->outstanding() <= 0)) {
                $loan->update(['status' => 'closed', 'closed_on' => $date]);
            }

            return $payment->fresh();
        });
    }

    public function requestPaymentCancel(LoanPayment $payment, string $reason): ApprovalRequest
    {
        if ($payment->status !== 'posted') {
            throw ValidationException::withMessages(['payment' => $payment->status === 'cancel_pending'
                ? __('এই পরিশোধ বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় আছে।') : __('এই পরিশোধ বাতিল করা যায় না।')]);
        }
        CombinedPaymentService::guardPart($payment);
        if (LoanPayment::where('loan_id', $payment->loan_id)->where('status', 'posted')->where('id', '>', $payment->id)->exists()) {
            throw ValidationException::withMessages(['payment' => __('শুধু সর্বশেষ পরিশোধ বাতিল করা যায়; পরেরগুলো আগে বাতিল করুন।')]);
        }

        return DB::transaction(function () use ($payment, $reason) {
            $payment->update(['status' => 'cancel_pending', 'cancel_reason' => $reason]);
            $loan = $payment->loan()->with('member.farmer')->first();

            return $this->approvals->submit(
                'loan.payment_cancel',
                __('ঋণ পরিশোধ বাতিল: :no', ['no' => $payment->payment_no]),
                $payment,
                ['রশিদ নং' => $payment->payment_no, 'ঋণ নং' => $loan->loan_no, 'সদস্য' => $loan->member?->farmer?->name_bn,
                    'তারিখ' => $payment->date->format('d/m/Y'), 'পরিমাণ' => (float) $payment->amount,
                    'জরিমানা' => (float) $payment->penalty, 'সুদ' => (float) $payment->interest, 'আসল' => (float) $payment->principal, 'কারণ' => $reason],
                null,
                (float) $payment->amount,
            );
        });
    }

    /** Approval handler: put the instalments back as they were and reverse the voucher. */
    public function cancelPayment(LoanPayment $payment): void
    {
        DB::transaction(function () use ($payment) {
            $payment = LoanPayment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            if ($payment->status === 'cancelled') {
                return;
            }
            $loan = Loan::whereKey($payment->loan_id)->lockForUpdate()->firstOrFail();
            foreach ($payment->snapshot ?? [] as $s) {
                LoanInstallment::where('loan_id', $loan->id)->where('seq', $s['seq'])
                    ->update(collect($s)->except(['loan_id', 'seq'])->all());
            }
            if ($payment->journal && $payment->journal->status === 'posted') {
                $this->ledger->reverse($payment->journal, __('ঋণ পরিশোধ বাতিল').($payment->cancel_reason ? ': '.$payment->cancel_reason : ''));
            }
            $payment->update(['status' => 'cancelled', 'cancelled_at' => now()]);
            if ($loan->status === 'closed') {
                $loan->update(['status' => 'active', 'closed_on' => null]);
            }
        });
    }

    public function keepPayment(LoanPayment $payment): void
    {
        LoanPayment::whereKey($payment->id)->where('status', 'cancel_pending')->update(['status' => 'posted', 'cancel_reason' => null]);
    }

    /** Split paisa into n parts that add up exactly; the last part takes the remainder. */
    private function split(int $paisa, int $n): array
    {
        $each = intdiv($paisa, $n);

        return array_merge(array_fill(0, $n - 1, $each), [$paisa - $each * ($n - 1)]);
    }
}
