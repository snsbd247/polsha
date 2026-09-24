<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\CombinedPayment;
use App\Models\CombinedPaymentPart;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\Loan;
use App\Models\LoanPayment;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\Receipt;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * One payment at the counter, split across loan instalment, irrigation
 * dues, share and savings. Each part is booked by its own module's service
 * (so every module's book and ledger stay exactly as if it was paid there);
 * this record ties them together under one receipt number.
 */
class CombinedPaymentService
{
    /** Modules that have a "due" and are settled in the configured order; savings takes whatever is left. */
    public const DUE_MODULES = ['loan', 'irrigation', 'share'];

    public function __construct(
        private LoanService $loans,
        private ReceiptService $receipts,
        private MemberFundService $funds,
        private ApprovalService $approvals,
    ) {}

    public static function order(): array
    {
        $order = array_values(array_intersect((array) SettingService::get('combined_payment_order', self::DUE_MODULES), self::DUE_MODULES));

        return array_values(array_unique(array_merge($order, self::DUE_MODULES)));
    }

    /** Everything the payer owes (or can pay into) on a date. */
    public function dues(Farmer $farmer, string $date): array
    {
        $member = Member::where('farmer_id', $farmer->id)->first();
        $active = $member && $member->status === Member::ACTIVE;
        $loan = $member ? Loan::where('member_id', $member->id)->where('status', 'active')->first() : null;
        $position = $loan && $date >= $loan->disbursed_on->toDateString() ? $this->loans->position($loan, $date) : null;
        $invoices = Invoice::where('farmer_id', $farmer->id)->whereIn('status', ['unpaid', 'partial'])
            ->with('season:id,name_bn,name_en')->orderBy('invoice_date')->orderBy('id')->get();
        $accounts = $member ? MemberAccount::where('member_id', $member->id)->get()->keyBy('kind') : collect();
        $shareMin = (float) SettingService::get('share_min_amount', 0);
        $shareBalance = (float) ($accounts['share']->balance ?? 0);

        return [
            'farmer' => $farmer->only(['id', 'farmer_code', 'name_bn', 'name_en', 'father_name', 'mobile']),
            'member' => $member?->only(['id', 'member_no', 'status']),
            'member_active' => $active,
            'loan' => $loan ? [
                'id' => $loan->id, 'loan_no' => $loan->loan_no, 'due_now' => $position['due_now'] ?? 0.0, 'payoff' => $position['payoff'] ?? 0.0,
                'overdue' => $position['overdue_amount'] ?? 0.0, 'penalty' => $position['penalty_due'] ?? 0.0,
                'payable' => $position !== null,
            ] : null,
            'irrigation' => [
                'due' => round($invoices->sum(fn (Invoice $i) => $i->dueAmount()), 2),
                'invoices' => $invoices->map(fn (Invoice $i) => ['id' => $i->id, 'invoice_no' => $i->invoice_no,
                    'season' => $i->season ? ['name_bn' => $i->season->name_bn, 'name_en' => $i->season->name_en] : null, 'due' => $i->dueAmount()])->values(),
            ],
            'share' => [
                'account_no' => $accounts['share']->account_no ?? null, 'balance' => $shareBalance, 'min' => $shareMin,
                'due' => $active ? max(0.0, round($shareMin - $shareBalance, 2)) : 0.0,
            ],
            'savings' => ['account_no' => $accounts['savings']->account_no ?? null, 'balance' => (float) ($accounts['savings']->balance ?? 0)],
            'order' => self::order(),
        ];
    }

    /** The automatic split: dues in the configured order, the rest to savings. */
    public function allocate(array $dues, float $amount): array
    {
        $left = (int) round($amount * 100);
        $parts = ['loan' => 0.0, 'irrigation' => 0.0, 'share' => 0.0, 'savings' => 0.0];
        $due = [
            'loan' => ($dues['loan']['payable'] ?? false) ? (float) $dues['loan']['due_now'] : 0.0,
            'irrigation' => (float) $dues['irrigation']['due'],
            'share' => (float) $dues['share']['due'],
        ];
        foreach ($dues['order'] as $m) {
            $take = min($left, (int) round($due[$m] * 100));
            $parts[$m] = $take / 100;
            $left -= $take;
        }
        if ($left > 0 && $dues['member_active']) {
            $parts['savings'] = $left / 100;
            $left = 0;
        }

        return ['parts' => $parts, 'unallocated' => $left / 100];
    }

    /**
     * @param  array{farmer_id:int, date:string, amount:float, method:string, fund_account_id?:?int, reference?:?string, remarks?:?string, parts?:?array}  $data
     */
    public function create(array $data): CombinedPayment
    {
        $farmer = Farmer::findOrFail($data['farmer_id']);
        $amount = round((float) $data['amount'], 2);
        $dues = $this->dues($farmer, $data['date']);
        $auto = $this->allocate($dues, $amount);
        $parts = $this->checkParts($data['parts'] ?? null, $auto, $dues, $amount);
        if (($data['method'] ?? 'cash') !== 'cash' && empty($data['reference'])) {
            throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
        }

        return DB::transaction(function () use ($data, $farmer, $amount, $dues, $auto, $parts) {
            $member = $dues['member'] ? Member::find($dues['member']['id']) : null;
            $combined = CombinedPayment::create([
                'payment_no' => SequenceService::next('combined_payment'), 'farmer_id' => $farmer->id, 'member_id' => $member?->id,
                'payer_name' => $farmer->name_bn, 'date' => $data['date'], 'amount' => $amount, 'method' => $data['method'],
                'fund_account_id' => $data['method'] === 'cash' ? null : ($data['fund_account_id'] ?? null),
                'reference' => $data['reference'] ?? null, 'remarks' => $data['remarks'] ?? null,
                'allocation' => ['auto' => $auto['parts'], 'final' => $parts, 'order' => $dues['order']],
                'status' => 'posted', 'verify_token' => Str::random(32), 'created_by' => auth()->id(),
            ]);
            $money = ['date' => $data['date'], 'method' => $data['method'], 'fund_account_id' => $data['fund_account_id'] ?? null,
                'reference' => $data['reference'] ?? null, 'remarks' => __('সমন্বিত রশিদ :no', ['no' => $combined->payment_no])];

            foreach (array_merge($dues['order'], ['savings']) as $module) {
                $value = $parts[$module];
                if ($value <= 0) {
                    continue;
                }
                [$source, $label] = match ($module) {
                    'loan' => $this->payLoan($dues, $money + ['amount' => $value]),
                    'irrigation' => $this->payIrrigation($farmer, $money, $value),
                    default => $this->payFund($member, $module, $money + ['amount' => $value]),
                };
                $combined->parts()->create([
                    'module' => $module, 'amount' => $value, 'source_type' => $source->getMorphClass(), 'source_id' => $source->getKey(), 'description' => $label,
                ]);
            }

            return $combined->fresh('parts');
        });
    }

    public function requestCancel(CombinedPayment $payment, string $reason): ApprovalRequest
    {
        if ($payment->status !== 'posted') {
            throw ValidationException::withMessages(['payment' => $payment->status === 'cancelled'
                ? __('রশিদটি আগেই বাতিল হয়েছে।') : __('এই রশিদ বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় আছে।')]);
        }
        foreach ($payment->parts as $part) {
            $src = $part->source;
            if (! $src || ! in_array($src->status, ['posted', 'active'], true)) {
                throw ValidationException::withMessages(['payment' => __(':module অংশটি আর বৈধ অবস্থায় নেই।', ['module' => __(CombinedPayment::MODULES[$part->module])])]);
            }
            if ($src instanceof LoanPayment && LoanPayment::where('loan_id', $src->loan_id)->where('status', 'posted')->where('id', '>', $src->id)->exists()) {
                throw ValidationException::withMessages(['payment' => __('এই ঋণের পরে আরও কিস্তি জমা হয়েছে; সেগুলো আগে বাতিল করুন।')]);
            }
            if ($src instanceof MemberTransaction && round((float) $src->account->available() - (float) $src->amount, 2) < 0) {
                throw ValidationException::withMessages(['payment' => __('এই জমা বাতিল করলে হিসাবের জের ঋণাত্মক হবে।')]);
            }
        }

        return DB::transaction(function () use ($payment, $reason) {
            $payment->update(['status' => 'cancel_pending', 'cancel_reason' => $reason]);
            foreach ($payment->parts as $part) {
                $part->source->update(['status' => 'cancel_pending', 'cancel_reason' => $reason]);
            }
            $payload = ['রশিদ নং' => $payment->payment_no, 'প্রদানকারী' => $payment->payer_name, 'তারিখ' => $payment->date->format('d/m/Y'),
                'পরিমাণ' => (float) $payment->amount];
            foreach ($payment->parts as $part) {
                $payload[CombinedPayment::MODULES[$part->module]] = (float) $part->amount;
            }

            return $this->approvals->submit('payment.combined_cancel', __('সমন্বিত রশিদ বাতিল: :no', ['no' => $payment->payment_no]),
                $payment, $payload + ['কারণ' => $reason], null, (float) $payment->amount);
        });
    }

    /** Approval handler: cancel every part through its own module, newest booking first. */
    public function cancel(CombinedPayment $payment): void
    {
        DB::transaction(function () use ($payment) {
            $payment = CombinedPayment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            if ($payment->status === 'cancelled') {
                return;
            }
            foreach ($payment->parts()->orderByDesc('id')->get() as $part) {
                $src = $part->source;
                match (true) {
                    $src instanceof LoanPayment => $this->loans->cancelPayment($src),
                    $src instanceof Receipt => $this->receipts->cancel($src),
                    $src instanceof MemberTransaction => $this->funds->cancel($src),
                    default => null,
                };
            }
            $payment->update(['status' => 'cancelled', 'cancelled_at' => now()]);
        });
    }

    public function keep(CombinedPayment $payment): void
    {
        DB::transaction(function () use ($payment) {
            foreach ($payment->parts as $part) {
                $src = $part->source;
                $src?->newQuery()->whereKey($src->getKey())->where('status', 'cancel_pending')
                    ->update(['status' => $src instanceof Receipt ? 'active' : 'posted', 'cancel_reason' => null]);
            }
            CombinedPayment::whereKey($payment->id)->where('status', 'cancel_pending')->update(['status' => 'posted', 'cancel_reason' => null]);
        });
    }

    /** A part of a combined receipt is cancelled only together with the whole receipt. */
    public static function guardPart(Model $source): void
    {
        $part = CombinedPaymentPart::where('source_type', $source->getMorphClass())->where('source_id', $source->getKey())->with('combined:id,payment_no')->first();
        if ($part) {
            throw ValidationException::withMessages(['reason' => __('এটি সমন্বিত রশিদ :no এর অংশ; পুরো সমন্বিত রশিদটি বাতিল করুন।', ['no' => $part->combined?->payment_no])]);
        }
    }

    private function checkParts(?array $given, array $auto, array $dues, float $amount): array
    {
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => __('টাকার পরিমাণ শূন্যের বেশি হতে হবে।')]);
        }
        $parts = $auto['parts'];
        if ($given !== null) {
            foreach (array_keys($parts) as $m) {
                $parts[$m] = round(max(0, (float) ($given[$m] ?? 0)), 2);
            }
        } elseif ($auto['unallocated'] > 0) {
            throw ValidationException::withMessages(['amount' => __('বকেয়ার চেয়ে :amount টাকা বেশি; সদস্য না হওয়ায় বাড়তি টাকা সঞ্চয়ে রাখা যায় না।', ['amount' => number_format($auto['unallocated'], 2)])]);
        }
        $sum = round(array_sum($parts), 2);
        if ($sum !== $amount) {
            throw ValidationException::withMessages(['parts' => __('ভাগের যোগফল (:sum) মোট টাকার (:amount) সমান নয়।', ['sum' => number_format($sum, 2), 'amount' => number_format($amount, 2)])]);
        }
        if ($parts['loan'] > 0) {
            if (! ($dues['loan']['payable'] ?? false)) {
                throw ValidationException::withMessages(['parts.loan' => __('এই সদস্যের কোনো চলমান ঋণ নেই।')]);
            }
            if ($parts['loan'] > (float) $dues['loan']['payoff']) {
                throw ValidationException::withMessages(['parts.loan' => __('সর্বোচ্চ পরিশোধযোগ্য :amount টাকা (জরিমানাসহ পুরো ঋণ)।', ['amount' => number_format($dues['loan']['payoff'], 2)])]);
            }
        }
        if ($parts['irrigation'] > (float) $dues['irrigation']['due']) {
            throw ValidationException::withMessages(['parts.irrigation' => __('সেচের মোট বকেয়া :amount টাকা।', ['amount' => number_format($dues['irrigation']['due'], 2)])]);
        }
        foreach (['share', 'savings'] as $m) {
            if ($parts[$m] > 0 && ! $dues['member_active']) {
                throw ValidationException::withMessages(["parts.$m" => __('শুধু সক্রিয় সদস্যের শেয়ার/সঞ্চয়ে জমা নেওয়া যায়।')]);
            }
        }

        return $parts;
    }

    private function payLoan(array $dues, array $data): array
    {
        $payment = $this->loans->pay(Loan::findOrFail($dues['loan']['id']), $data);

        return [$payment, __('ঋণ :no — কিস্তি :pno', ['no' => $dues['loan']['loan_no'], 'pno' => $payment->payment_no])];
    }

    private function payIrrigation(Farmer $farmer, array $money, float $value): array
    {
        $left = (int) round($value * 100);
        $items = [];
        $invoices = Invoice::where('farmer_id', $farmer->id)->whereIn('status', ['unpaid', 'partial'])->orderBy('invoice_date')->orderBy('id')->lockForUpdate()->get();
        foreach ($invoices as $inv) {
            $take = min($left, (int) round($inv->dueAmount() * 100));
            if ($take > 0) {
                $items[] = ['payable' => $inv, 'amount' => $take / 100];
                $left -= $take;
            }
        }
        $receipt = $this->receipts->create(['module' => 'irrigation', 'farmer_id' => $farmer->id, 'payer_name' => $farmer->name_bn] + $money, $items);

        return [$receipt, __('সেচ চার্জ — রশিদ :no', ['no' => $receipt->receipt_no])];
    }

    private function payFund(Member $member, string $kind, array $data): array
    {
        $account = MemberAccount::where('member_id', $member->id)->where('kind', $kind)->first()
            ?? $this->funds->openAccount($member, $kind, $data['date'], __('সমন্বিত রশিদের মাধ্যমে খোলা'));
        $txn = $this->funds->moneyIn($account, $data);

        return [$txn, ($kind === 'share' ? __('শেয়ার') : __('সঞ্চয়')).' '.$account->account_no.' — '.$txn->txn_no];
    }
}
