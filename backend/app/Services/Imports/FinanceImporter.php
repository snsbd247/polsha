<?php

namespace App\Services\Imports;

use App\Models\Account;
use App\Models\Farmer;
use App\Models\ImportBatch;
use App\Models\Invoice;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\Loan;
use App\Models\LoanInstallment;
use App\Models\LoanProduct;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\Mouza;
use App\Models\Receipt;
use App\Models\Season;
use App\Models\Upazila;
use App\Services\IrrigationService;
use App\Services\LedgerService;
use App\Services\LoanService;
use App\Services\MemberFundService;
use App\Services\ReceiptService;
use App\Services\SequenceService;
use App\Services\SettingService;
use App\Support\Bn;
use App\Support\ImportValue;
use Carbon\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Money-side migration from the paper books or an old system. Every
 * opening figure is booked against Opening Balance Equity, so the trial
 * balance stays even and the import can be reversed cleanly later.
 *
 *  savings_opening / share_opening — member balance (Dr OBE / Cr deposits or capital)
 *  loan_opening      — running loan with its schedule, earlier repayments applied (Dr loans / Cr OBE)
 *  legacy_irrigation — unpaid old irrigation bills (Dr receivable / Cr OBE for what is still due)
 *  payments          — old paper receipts against invoices already in the system
 */
class FinanceImporter
{
    public function __construct(
        private LedgerService $ledger,
        private MemberFundService $funds,
        private LoanService $loans,
        private IrrigationService $irrigation,
        private ReceiptService $receipts,
    ) {}

    /** The books' cut-over date (System Preferences), today if not set. */
    public static function openingDate(): string
    {
        $d = SettingService::get('go_live_date');

        return $d && $d <= now()->toDateString() ? $d : now()->toDateString();
    }

    /** @return array{0: array, 1: array, 2: array} [resolved row, errors, warnings] */
    public function validate(string $type, array $r, array &$seen, int $line): array
    {
        return match ($type) {
            'savings_opening', 'share_opening' => $this->validateOpening($type === 'savings_opening' ? 'savings' : 'share', $r, $seen, $line),
            'loan_opening' => $this->validateLoan($r, $seen, $line),
            'legacy_irrigation' => $this->validateInvoice($r, $seen, $line),
            'payments' => $this->validatePayment($r, $seen, $line),
        };
    }

    /** Imports one row; returns the money amount it brought in. */
    public function import(string $type, array $r, ImportBatch $batch): float
    {
        return match ($type) {
            'savings_opening', 'share_opening' => $this->importOpening($r, $batch),
            'loan_opening' => $this->importLoan($r, $batch),
            'legacy_irrigation' => $this->importInvoice($r, $batch),
            'payments' => $this->importPayment($r, $batch),
        };
    }

    // ------------------------------------------------------ savings / share

    private function validateOpening(string $kind, array $r, array &$seen, int $line): array
    {
        $e = $w = [];
        [$member, $e] = $this->member($r['member_ref'] ?? '', $e);
        $amount = ImportValue::amount($r['amount'] ?? '');
        if ($amount === null || $amount <= 0) {
            $e[] = __('জের শূন্যের বেশি সংখ্যা হতে হবে');
        }
        $date = $this->dateOr($r['date'] ?? '', $e);

        $account = null;
        if ($member) {
            if (isset($seen['member'][$member->id])) {
                $e[] = __('একই সদস্য ফাইলের :p0 নং সারিতেও আছে', ['p0' => $seen['member'][$member->id]]);
            }
            $seen['member'][$member->id] ??= $line;
            $account = MemberAccount::where('kind', $kind)->where('member_id', $member->id)->first();
            if ($account && $account->status !== 'active') {
                $e[] = __('সদস্যের হিসাবটি বন্ধ');
            } elseif ($account && $account->transactions()->where('type', 'opening')->whereIn('status', ['pending', 'posted', 'cancel_pending'])->exists()) {
                $e[] = __('এই হিসাবের প্রারম্ভিক জের আগেই দেওয়া হয়েছে');
            } elseif ($account && $account->transactions()->whereIn('status', ['posted', 'cancel_pending'])->exists()) {
                $w[] = __('হিসাবে আগে থেকেই লেনদেন আছে (জের :p0) — প্রারম্ভিক জের যোগ হবে', ['p0' => number_format((float) $account->balance, 2)]);
            }
        }

        return [[
            'kind' => $kind, 'member_id' => $member?->id, 'member_no' => $member?->member_no, 'name' => $member?->farmer?->name_bn,
            'account_id' => $account?->id, 'account_no' => $account?->account_no ?? __('নতুন হিসাব'),
            'amount' => $amount, 'date' => $date, 'remarks' => ($r['remarks'] ?? '') ?: null,
        ], $e, $w];
    }

    private function importOpening(array $r, ImportBatch $batch): float
    {
        $kind = $r['kind'];
        $account = MemberAccount::where('kind', $kind)->where('member_id', $r['member_id'])->lockForUpdate()->first()
            ?? MemberAccount::create([
                'kind' => $kind, 'member_id' => $r['member_id'], 'account_no' => SequenceService::next(MemberAccount::CONFIG[$kind]['seq']),
                'opened_on' => $r['date'], 'status' => 'active', 'balance' => 0, 'remarks' => __('ইমপোর্টে খোলা (ব্যাচ #:id)', ['id' => $batch->id]),
                'created_by' => auth()->id(), 'import_batch_id' => $batch->id,
            ]);
        if ($account->transactions()->where('type', 'opening')->whereIn('status', ['pending', 'posted', 'cancel_pending'])->exists()) {
            throw ValidationException::withMessages(['amount' => __('এই হিসাবের প্রারম্ভিক জের আগেই দেওয়া হয়েছে')]);
        }
        $this->ledger->openPeriodFor($r['date']);
        $txn = MemberTransaction::create([
            'txn_no' => SequenceService::next(MemberAccount::CONFIG[$kind]['txn_seq']), 'member_account_id' => $account->id, 'kind' => $kind,
            'date' => $r['date'], 'type' => 'opening', 'direction' => 'in', 'amount' => $r['amount'], 'status' => 'pending',
            'remarks' => $r['remarks'] ?? __('ইমপোর্ট ব্যাচ #:id', ['id' => $batch->id]), 'created_by' => auth()->id(), 'import_batch_id' => $batch->id,
        ]);
        $this->funds->post($txn);

        return (float) $r['amount'];
    }

    // ---------------------------------------------------------------- loans

    private function validateLoan(array $r, array &$seen, int $line): array
    {
        $e = $w = [];
        [$member, $e] = $this->member($r['member_ref'] ?? '', $e);
        $productRef = trim($r['product'] ?? '');
        $product = $productRef === '' ? null
            : LoanProduct::where('code', strtoupper($productRef))->orWhere('name_bn', $productRef)->orWhere('name_en', $productRef)->first();
        if ($productRef !== '' && ! $product) {
            $e[] = __('ঋণের ধরন ":p0" পাওয়া যায়নি (কোড বা নাম দিন)', ['p0' => $productRef]);
        } elseif ($productRef === '') {
            $e[] = __('ঋণের ধরন খালি');
        }
        $amount = ImportValue::amount($r['amount'] ?? '');
        if ($amount === null || $amount <= 0) {
            $e[] = __('মূল ঋণের পরিমাণ শূন্যের বেশি হতে হবে');
        }
        $outstanding = ImportValue::amount($r['principal_outstanding'] ?? '');
        if ($outstanding === null || $outstanding <= 0) {
            $e[] = __('বকেয়া আসল শূন্যের বেশি হতে হবে (পরিশোধিত ঋণ ইমপোর্ট করার দরকার নেই)');
        } elseif ($amount && $outstanding > $amount) {
            $e[] = __('বকেয়া আসল মূল ঋণের চেয়ে বেশি হতে পারে না');
        }
        $interestOut = ($r['interest_outstanding'] ?? '') !== '' ? ImportValue::amount($r['interest_outstanding']) : null;
        if (($r['interest_outstanding'] ?? '') !== '' && ($interestOut === null || $interestOut < 0)) {
            $e[] = __('বকেয়া সুদ সঠিক নয়');
        }
        $disbursed = ImportValue::date($r['disbursed_on'] ?? '');
        if (! $disbursed) {
            $e[] = __('বিতরণের তারিখ (দিন/মাস/বছর) সঠিক নয়');
        }
        $firstDue = null;
        if (($r['first_due_on'] ?? '') !== '') {
            $firstDue = $this->futureOk($r['first_due_on']);
            if (! $firstDue) {
                $e[] = __('প্রথম কিস্তির তারিখ সঠিক নয়');
            } elseif ($disbursed && $firstDue <= $disbursed) {
                $e[] = __('প্রথম কিস্তির তারিখ বিতরণের পরে হতে হবে।');
            }
        }
        $legacyNo = trim($r['legacy_no'] ?? '') ?: null;

        if ($member) {
            if ($open = $this->loans->openLoan($member->id)) {
                $e[] = __('এই সদস্যের একটি ঋণ চলমান বা অপেক্ষমাণ আছে (:no)', ['no' => $open->loan_no]);
            }
            if (isset($seen['member'][$member->id])) {
                $e[] = __('একই সদস্য ফাইলের :p0 নং সারিতেও আছে', ['p0' => $seen['member'][$member->id]]);
            }
            $seen['member'][$member->id] ??= $line;
        }

        $schedule = null;
        if (! $e && $product) {
            $terms = $this->terms($product);
            $firstDue ??= $this->loans->defaultFirstDue($terms, $disbursed);
            $schedule = $this->loans->buildSchedule($terms, $amount, $firstDue);
            $totalInterest = round(array_sum(array_column($schedule, 'interest')), 2);
            if ($interestOut !== null && $interestOut > $totalInterest) {
                $e[] = __('বকেয়া সুদ মোট সুদের (:p0) চেয়ে বেশি', ['p0' => number_format($totalInterest, 2)]);
            }
        }

        return [[
            'member_id' => $member?->id, 'member_no' => $member?->member_no, 'name' => $member?->farmer?->name_bn,
            'product_id' => $product?->id, 'product' => $product?->name_bn, 'amount' => $amount, 'disbursed_on' => $disbursed,
            'first_due_on' => $firstDue, 'principal_outstanding' => $outstanding, 'interest_outstanding' => $interestOut,
            'legacy_no' => $legacyNo, 'installments' => $schedule ? count($schedule) : null,
        ], $e, $w];
    }

    private function importLoan(array $r, ImportBatch $batch): float
    {
        $product = LoanProduct::findOrFail($r['product_id']);
        $member = Member::with('farmer')->findOrFail($r['member_id']);
        if ($open = $this->loans->openLoan($member->id)) {
            throw ValidationException::withMessages(['member' => __('এই সদস্যের একটি ঋণ চলমান বা অপেক্ষমাণ আছে (:no)', ['no' => $open->loan_no])]);
        }
        $terms = $this->terms($product);
        $rows = $this->loans->buildSchedule($terms, (float) $r['amount'], $r['first_due_on']);
        $date = self::openingDate();
        $this->ledger->openPeriodFor($date);

        $loan = Loan::create([
            'loan_no' => SequenceService::next('loan'), 'member_id' => $member->id, 'product_id' => $product->id,
            'applied_on' => $r['disbursed_on'], 'amount' => $r['amount'], 'purpose' => null,
            'status' => 'active', 'disbursed_on' => $r['disbursed_on'], 'first_due_on' => $r['first_due_on'],
            'total_interest' => round(array_sum(array_column($rows, 'interest')), 2), 'reference' => $r['legacy_no'],
            'remarks' => __('পুরনো ঋণ ইমপোর্ট (ব্যাচ #:id)', ['id' => $batch->id]).($r['legacy_no'] ? ' — '.__('পুরনো নং').' '.$r['legacy_no'] : ''),
            'created_by' => auth()->id(), 'disbursed_by' => auth()->id(), 'import_batch_id' => $batch->id,
        ] + $terms);

        // What was already repaid on paper goes to the earliest instalments first.
        $principalPaid = (int) round(((float) $r['amount'] - (float) $r['principal_outstanding']) * 100);
        $totalInterest = (int) round(array_sum(array_column($rows, 'interest')) * 100);
        $interestPaid = $r['interest_outstanding'] !== null ? max(0, $totalInterest - (int) round((float) $r['interest_outstanding'] * 100)) : null;
        $installments = [];
        foreach ($rows as $row) {
            $p = min($principalPaid, (int) round($row['principal'] * 100));
            $principalPaid -= $p;
            $installments[] = $row + ['principal_paid' => $p / 100];
        }
        foreach ($installments as $i => $row) {
            // Without a figure, interest counts as paid on instalments whose principal is fully paid.
            if ($interestPaid === null) {
                $paid = round($row['principal_paid'], 2) >= round($row['principal'], 2) ? $row['interest'] : 0;
            } else {
                $paid = min($interestPaid, (int) round($row['interest'] * 100)) / 100;
                $interestPaid -= (int) round($paid * 100);
            }
            $installments[$i]['interest_paid'] = $paid;
        }
        foreach ($installments as $row) {
            $done = round($row['principal'] + $row['interest'] - $row['principal_paid'] - $row['interest_paid'], 2) <= 0;
            $loan->schedule()->create($row + ['paid_on' => $done ? $date : null]);
        }

        $principal = (float) $r['principal_outstanding'];
        $journal = $this->ledger->postNow('journal', $date,
            __('পুরনো ঋণের প্রারম্ভিক জের').' '.$loan->loan_no.' — '.$member->farmer?->name_bn.' ('.$member->member_no.')',
            [['account_id' => Account::byKey('loans_receivable')->id, 'debit' => $principal],
                ['account_id' => Account::byKey('opening_balance_equity')->id, 'credit' => $principal]],
            'loan', $loan);
        $loan->update(['journal_id' => $journal->id]);
        if (LoanInstallment::where('loan_id', $loan->id)->get()->every(fn ($i) => $i->outstanding() <= 0)) {
            $loan->update(['status' => 'closed', 'closed_on' => $date]);
        }

        return $principal;
    }

    private function terms(LoanProduct $product): array
    {
        return [
            'interest_rate' => $product->interest_rate, 'interest_method' => $product->interest_method, 'frequency' => $product->frequency,
            'installments' => $product->frequency === 'one_time' ? 1 : $product->installments, 'term_months' => $product->term_months,
            'penalty_type' => $product->penalty_type, 'penalty_rate' => $product->penalty_rate, 'grace_days' => $product->grace_days,
        ];
    }

    // ------------------------------------------------------ irrigation dues

    private function validateInvoice(array $r, array &$seen, int $line): array
    {
        $e = $w = [];
        $land = $this->land($r, $e);
        $seasonName = trim($r['season'] ?? '');
        $season = $seasonName !== '' ? Season::where('name_bn', $seasonName)->latest('start_date')->first() : null;
        if ($seasonName === '') {
            $e[] = __('মৌসুম খালি');
        } elseif (! $season) {
            $e[] = __('মৌসুম ":p0" পাওয়া যায়নি — আগে মৌসুম তৈরি করুন', ['p0' => $seasonName]);
        }
        $amount = ImportValue::amount($r['amount'] ?? '');
        if ($amount === null || $amount <= 0) {
            $e[] = __('বিলের টাকা শূন্যের বেশি হতে হবে');
        }
        $paid = ($r['paid'] ?? '') !== '' ? ImportValue::amount($r['paid']) : 0.0;
        if ($paid === null || $paid < 0 || ($amount && $paid > $amount)) {
            $e[] = __('আদায়কৃত টাকা ০ থেকে বিলের টাকার মধ্যে হতে হবে');
        } elseif ($amount && $paid >= $amount) {
            $w[] = __('পুরো বিল আদায় হয়ে গেছে — শুধু ইতিহাস হিসেবে থাকবে');
        }
        $date = $this->dateOr($r['invoice_date'] ?? '', $e);

        $farmer = null;
        if (($r['cultivator'] ?? '') !== '') {
            $farmer = ImportValue::farmer($r['cultivator']);
            if (! $farmer) {
                $e[] = __('চাষি ":p0" পাওয়া যায়নি', ['p0' => $r['cultivator']]);
            }
        } elseif ($land) {
            $farmer = $land->cultivation?->farmer;
            if (! $farmer) {
                $e[] = __('জমিতে বর্তমান চাষি নেই — চাষির কলাম দিন');
            }
        }
        $typeId = $land?->irrigation_type_id ?: IrrigationType::where('is_active', true)->orderBy('sort_order')->value('id');
        if ($land && ! $typeId) {
            $e[] = __('কোনো সেচের ধরন নেই — আগে সেচের ধরন তৈরি করুন');
        }

        if ($land && $season) {
            $key = $land->id.'|'.$season->id;
            if (isset($seen['invoice'][$key])) {
                $e[] = __('একই জমি ও মৌসুম ফাইলের :p0 নং সারিতেও আছে', ['p0' => $seen['invoice'][$key]]);
            } elseif (Invoice::where('land_id', $land->id)->where('season_id', $season->id)->where('status', '!=', 'cancelled')->exists()) {
                $e[] = __('এই জমির এই মৌসুমের ইনভয়েস আগে থেকেই আছে');
            }
            $seen['invoice'][$key] ??= $line;
        }

        return [[
            'land_id' => $land?->id, 'land_code' => $land?->land_code, 'dag_no' => $land?->dag_no, 'season_id' => $season?->id, 'season' => $season?->name_bn,
            'farmer_id' => $farmer?->id, 'name' => $farmer?->name_bn, 'irrigation_type_id' => $typeId,
            'amount' => $amount, 'paid' => $paid, 'due' => $amount !== null && $paid !== null ? round($amount - $paid, 2) : null, 'invoice_date' => $date,
        ], $e, $w];
    }

    private function importInvoice(array $r, ImportBatch $batch): float
    {
        $land = Land::findOrFail($r['land_id']);
        $season = Season::findOrFail($r['season_id']);
        if (Invoice::where('land_id', $land->id)->where('season_id', $season->id)->where('status', '!=', 'cancelled')->lockForUpdate()->exists()) {
            throw ValidationException::withMessages(['land' => __('এই জমির এই মৌসুমের ইনভয়েস আগে থেকেই আছে')]);
        }
        $c = $this->irrigation->candidate($land, $season, $r['invoice_date'], $r['irrigation_type_id'], null, true);
        $farmer = Farmer::find($r['farmer_id']);
        if ($farmer && ($c['snapshot']['cultivator']['id'] ?? null) !== $farmer->id) {
            $c['snapshot']['cultivator'] = ['id' => $farmer->id, 'farmer_code' => $farmer->farmer_code, 'name_bn' => $farmer->name_bn,
                'name_en' => $farmer->name_en, 'father_name' => $farmer->father_name, 'mobile' => $farmer->mobile];
        }
        $c['snapshot']['legacy'] = true;
        $area = (float) $c['area_decimal'];
        $amount = (float) $r['amount'];
        $paid = (float) $r['paid'];
        $due = round($amount - $paid, 2);

        $invoice = Invoice::create([
            'invoice_no' => SequenceService::next('irrigation_invoice'), 'season_id' => $season->id, 'land_id' => $land->id,
            'farmer_id' => $r['farmer_id'], 'cultivation_type' => $c['cultivation_type'] ?? 'own', 'land_type_id' => $land->land_type_id,
            'irrigation_type_id' => $r['irrigation_type_id'], 'rate_id' => null, 'invoice_date' => $r['invoice_date'],
            'due_date' => $season->due_date?->toDateString(), 'area_decimal' => $area, 'rate' => $area > 0 ? round($amount / $area, 4) : 0,
            'amount' => $amount, 'paid_amount' => $paid, 'status' => $due <= 0 ? 'paid' : ($paid > 0 ? 'partial' : 'unpaid'),
            'snapshot' => $c['snapshot'], 'remarks' => __('পুরনো বকেয়া ইমপোর্ট (ব্যাচ #:id)', ['id' => $batch->id]),
            'created_by' => auth()->id(), 'import_batch_id' => $batch->id,
        ]);
        if ($due > 0) {
            $date = self::openingDate();
            $journal = $this->ledger->postNow('journal', $date,
                __('পুরনো সেচ বকেয়া :no — :name, দাগ :dag', ['no' => $invoice->invoice_no, 'name' => $c['snapshot']['cultivator']['name_bn'] ?? '', 'dag' => $land->dag_no]),
                [['account_id' => Account::byKey('irrigation_receivable')->id, 'debit' => $due],
                    ['account_id' => Account::byKey('opening_balance_equity')->id, 'credit' => $due]],
                'irrigation', $invoice);
            $invoice->update(['journal_id' => $journal->id]);
        }

        return $due;
    }

    // ------------------------------------------------------------- payments

    private function validatePayment(array $r, array &$seen, int $line): array
    {
        $e = $w = [];
        $legacyNo = trim(Bn::toEnDigits($r['legacy_no'] ?? '') ?? '');
        if ($legacyNo === '') {
            $e[] = __('পুরনো রশিদ নং খালি');
        } elseif (isset($seen['legacy'][$legacyNo])) {
            $e[] = __('একই রশিদ নং ফাইলের :p0 নং সারিতেও আছে', ['p0' => $seen['legacy'][$legacyNo]]);
        } elseif (Receipt::where('legacy_no', $legacyNo)->exists()) {
            $e[] = __('রশিদ নং :p0 আগেই এন্ট্রি হয়েছে', ['p0' => $legacyNo]);
        }
        if ($legacyNo !== '') {
            $seen['legacy'][$legacyNo] ??= $line;
        }
        $date = ImportValue::date($r['date'] ?? '');
        if (! $date) {
            $e[] = __('তারিখ (দিন/মাস/বছর) সঠিক নয়');
        } else {
            $this->periodOpen($date, $e);
        }
        $amount = ImportValue::amount($r['amount'] ?? '');
        if ($amount === null || $amount <= 0) {
            $e[] = __('টাকার পরিমাণ শূন্যের বেশি হতে হবে');
        }
        $method = ImportValue::method($r['method'] ?? '');
        if ($method !== 'cash') {
            $e[] = __('পুরনো রশিদ শুধু নগদ হিসেবে ইমপোর্ট করা যায়');
        }

        $invoice = null;
        $invoiceNo = trim(Bn::toEnDigits($r['invoice_no'] ?? '') ?? '');
        if ($invoiceNo !== '') {
            $invoice = Invoice::where('invoice_no', strtoupper($invoiceNo))->first();
            if (! $invoice) {
                $e[] = __('ইনভয়েস :p0 পাওয়া যায়নি', ['p0' => $invoiceNo]);
            }
        } else {
            $land = ($r['land_code'] ?? '') !== '' ? Land::where('land_code', strtoupper(trim(Bn::toEnDigits($r['land_code']))))->first() : null;
            $season = ($r['season'] ?? '') !== '' ? Season::where('name_bn', trim($r['season']))->latest('start_date')->first() : null;
            $invoice = $land && $season ? Invoice::where('land_id', $land->id)->where('season_id', $season->id)->where('status', '!=', 'cancelled')->first() : null;
            if (! $invoice) {
                $e[] = __('ইনভয়েস খুঁজে পাওয়া যায়নি (ইনভয়েস নং, অথবা জমির কোড + মৌসুম দিন)');
            }
        }
        if ($invoice) {
            if ($invoice->status === 'cancelled') {
                $e[] = __('ইনভয়েস :no বাতিল করা হয়েছে।', ['no' => $invoice->invoice_no]);
            } elseif ($amount) {
                $taken = $seen['paid'][$invoice->id] ?? 0;
                if (round($amount + $taken, 2) > $invoice->dueAmount()) {
                    $e[] = __('ইনভয়েস :no-এর বকেয়া :due টাকা (ফাইলের আগের সারিসহ)', ['no' => $invoice->invoice_no, 'due' => number_format($invoice->dueAmount() - $taken, 2)]);
                } else {
                    $seen['paid'][$invoice->id] = round($taken + $amount, 2);
                }
            }
        }
        $farmer = $invoice?->farmer;
        $payer = trim($r['payer'] ?? '') ?: ($farmer?->name_bn ?? '');

        return [[
            'legacy_no' => $legacyNo, 'date' => $date, 'amount' => $amount, 'invoice_id' => $invoice?->id, 'invoice_no' => $invoice?->invoice_no,
            'farmer_id' => $farmer?->id, 'name' => $payer, 'remarks' => trim($r['remarks'] ?? '') ?: null,
        ], $e, $w];
    }

    private function importPayment(array $r, ImportBatch $batch): float
    {
        $invoice = Invoice::findOrFail($r['invoice_id']);
        $this->receipts->create([
            'module' => 'irrigation', 'farmer_id' => $r['farmer_id'], 'payer_name' => $r['name'] ?: '—', 'date' => $r['date'],
            'method' => 'cash', 'is_legacy' => true, 'legacy_no' => $r['legacy_no'],
            'remarks' => $r['remarks'] ?? __('পুরনো রশিদ ইমপোর্ট (ব্যাচ #:id)', ['id' => $batch->id]), 'import_batch_id' => $batch->id,
        ], [['payable' => $invoice, 'amount' => (float) $r['amount']]]);

        return (float) $r['amount'];
    }

    // -------------------------------------------------------------- helpers

    /** @return array{0: ?Member, 1: array} */
    private function member(string $ref, array $e): array
    {
        if (trim($ref) === '') {
            $e[] = __('সদস্য নং খালি');

            return [null, $e];
        }
        $farmer = ImportValue::farmer($ref);
        $member = $farmer?->member;
        if (! $member) {
            $e[] = __('সদস্য ":p0" পাওয়া যায়নি (সদস্য নং, Farmer ID বা NID দিন)', ['p0' => $ref]);
        } elseif ($member->status !== Member::ACTIVE) {
            $e[] = __('সদস্য :p0 সক্রিয় নন', ['p0' => $member->member_no]);
        }
        $member?->setRelation('farmer', $farmer);

        return [$member && $member->status === Member::ACTIVE ? $member : null, $e];
    }

    private function land(array $r, array &$e): ?Land
    {
        $code = trim(Bn::toEnDigits($r['land_code'] ?? '') ?? '');
        if ($code !== '') {
            $land = Land::with('cultivation.farmer')->where('land_code', strtoupper($code))->first();
            if (! $land) {
                $e[] = __('জমির কোড :p0 পাওয়া যায়নি', ['p0' => $code]);
            }

            return $land;
        }
        $jl = trim(Bn::toEnDigits($r['mouza_jl'] ?? '') ?? '');
        $khatian = trim(Bn::toEnDigits($r['khatian_no'] ?? '') ?? '');
        $dag = trim(Bn::toEnDigits($r['dag_no'] ?? '') ?? '');
        if ($jl === '' || $dag === '') {
            $e[] = __('জমির কোড, অথবা মৌজা JL + দাগ দিন');

            return null;
        }
        $upazilas = ($r['upazila'] ?? '') !== '' ? Upazila::where('name_bn', trim($r['upazila']))->pluck('id') : null;
        $mouzas = Mouza::where('jl_no', $jl)->when($upazilas, fn ($q) => $q->whereIn('upazila_id', $upazilas))->pluck('id');
        $lands = Land::with('cultivation.farmer')->whereIn('mouza_id', $mouzas)->where('dag_no', $dag)
            ->when($khatian !== '', fn ($q) => $q->where('khatian_no', $khatian))->get();
        if ($lands->count() !== 1) {
            $e[] = $lands->isEmpty() ? __('JL :p0, দাগ :p1-এর জমি পাওয়া যায়নি', ['p0' => $jl, 'p1' => $dag])
                : __('JL :p0, দাগ :p1-এ একাধিক জমি — জমির কোড দিন', ['p0' => $jl, 'p1' => $dag]);

            return null;
        }

        return $lands->first();
    }

    /** Empty → the go-live date; otherwise a valid past date in an open month. */
    private function dateOr(string $v, array &$e): ?string
    {
        $date = trim($v) === '' ? self::openingDate() : ImportValue::date($v);
        if (! $date) {
            $e[] = __('তারিখ (দিন/মাস/বছর) সঠিক নয়');

            return null;
        }
        $this->periodOpen($date, $e);

        return $date;
    }

    private function periodOpen(string $date, array &$e): void
    {
        try {
            $this->ledger->openPeriodFor($date);
        } catch (ValidationException $ex) {
            $e = array_merge($e, collect($ex->errors())->flatten()->all());
        }
    }

    /** Like ImportValue::date but the first instalment may lie in the future. */
    private function futureOk(string $v): ?string
    {
        $v = trim(Bn::toEnDigits($v) ?? '');
        foreach (['j/n/Y', 'd/m/Y', 'j-n-Y', 'd-m-Y', 'Y-m-d', 'j.n.Y'] as $fmt) {
            try {
                $d = Carbon::createFromFormat('!'.$fmt, $v);
                if ($d && $d->format($fmt) === $v) {
                    return $d->toDateString();
                }
            } catch (\Throwable) {
            }
        }

        return null;
    }
}
