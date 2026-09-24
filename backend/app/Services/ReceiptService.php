<?php

namespace App\Services;

use App\Contracts\Payable;
use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\Receipt;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The money-receipt engine shared by every module. A receipt pays off one
 * or more Payables, and books Dr fund (cash stream / bank) / Cr each
 * payable's account in the same transaction. Receipts are never edited:
 * a mistake is cancelled (with approval) and the voucher reversed.
 */
class ReceiptService
{
    public function __construct(private LedgerService $ledger, private ApprovalService $approvals) {}

    /**
     * @param  array{module:string, farmer_id:?int, payer_name:string, date:string, method:string, fund_account_id?:?int, reference?:?string, remarks?:?string, is_legacy?:bool, legacy_no?:?string}  $data
     * @param  array<int, array{payable: Payable&Model, amount: float}>  $items
     */
    public function create(array $data, array $items): Receipt
    {
        $items = array_values(array_filter($items, fn ($i) => round((float) $i['amount'], 2) > 0));
        if (! $items) {
            throw ValidationException::withMessages(['items' => __('কমপক্ষে একটি বকেয়ায় টাকার পরিমাণ দিন।')]);
        }
        $fund = $this->fund($data['module'], $data['method'], $data['fund_account_id'] ?? null);
        if ($data['method'] !== 'cash' && empty($data['reference'])) {
            throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
        }

        return DB::transaction(function () use ($data, $items, $fund) {
            $total = round(array_sum(array_map(fn ($i) => (float) $i['amount'], $items)), 2);
            $receipt = Receipt::create([
                'receipt_no' => SequenceService::next('money_receipt'),
                'module' => $data['module'],
                'farmer_id' => $data['farmer_id'] ?? null,
                'payer_name' => $data['payer_name'],
                'date' => $data['date'],
                'amount' => $total,
                'method' => $data['method'],
                'fund_account_id' => $fund->id,
                'reference' => $data['reference'] ?? null,
                'is_legacy' => (bool) ($data['is_legacy'] ?? false),
                'legacy_no' => ($data['is_legacy'] ?? false) ? $data['legacy_no'] : null,
                'status' => 'active',
                'remarks' => $data['remarks'] ?? null,
                'verify_token' => Str::random(32),
                'created_by' => auth()->id(),
            ]);

            $credits = [];
            foreach ($items as $i) {
                /** @var Payable&Model $payable */
                $payable = $i['payable'];
                $amount = round((float) $i['amount'], 2);
                $payable->applyPayment($amount);
                $receipt->items()->create([
                    'payable_type' => $payable->getMorphClass(), 'payable_id' => $payable->getKey(),
                    'description' => $payable->payableLabel(), 'amount' => $amount, 'due_after' => $payable->fresh()->dueAmount(),
                ]);
                $acc = $payable->creditAccountId();
                $credits[$acc] = round(($credits[$acc] ?? 0) + $amount, 2);
            }

            $lines = [['account_id' => $fund->id, 'debit' => $total, 'remarks' => $data['reference'] ?? null]];
            foreach ($credits as $acc => $amount) {
                $lines[] = ['account_id' => $acc, 'credit' => $amount];
            }
            $journal = $this->ledger->postNow('receipt', $data['date'],
                __('রশিদ :no — :name', ['no' => $receipt->receipt_no, 'name' => $receipt->payer_name])
                    .($receipt->is_legacy ? ' '.__('(পুরনো রশিদ :no)', ['no' => $receipt->legacy_no]) : ''),
                $lines, $data['module'], $receipt);
            $receipt->update(['journal_id' => $journal->id]);

            return $receipt;
        });
    }

    public function requestCancel(Receipt $receipt, string $reason): ApprovalRequest
    {
        if ($receipt->status !== 'active') {
            throw ValidationException::withMessages(['receipt' => $receipt->status === 'cancelled'
                ? __('রশিদটি আগেই বাতিল হয়েছে।') : __('এই রশিদ বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় আছে।')]);
        }
        CombinedPaymentService::guardPart($receipt);

        return DB::transaction(function () use ($receipt, $reason) {
            $receipt->update(['status' => 'cancel_pending', 'cancel_reason' => $reason]);

            return $this->approvals->submit(
                'payment.receipt_cancel',
                __('রশিদ বাতিল: :no', ['no' => $receipt->receipt_no]),
                $receipt,
                ['রশিদ' => $receipt->receipt_no, 'প্রদানকারী' => $receipt->payer_name, 'তারিখ' => $receipt->date->format('d/m/Y'),
                    'পরিমাণ' => (float) $receipt->amount, 'কারণ' => $reason],
                null,
                (float) $receipt->amount,
            );
        });
    }

    /** Approval handler: reverse the voucher, give the dues back, void the receipt. */
    public function cancel(Receipt $receipt): void
    {
        DB::transaction(function () use ($receipt) {
            $receipt = Receipt::whereKey($receipt->id)->lockForUpdate()->firstOrFail();
            if ($receipt->status === 'cancelled') {
                return;
            }
            foreach ($receipt->items as $item) {
                $item->payable?->revertPayment((float) $item->amount);
            }
            if ($receipt->journal && $receipt->journal->status === 'posted') {
                $this->ledger->reverse($receipt->journal, __('রশিদ বাতিল').($receipt->cancel_reason ? ': '.$receipt->cancel_reason : ''));
            }
            $receipt->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancelled_by' => auth()->id()]);
        });
    }

    /** Cancel request turned down: the receipt stands. */
    public function keep(Receipt $receipt): void
    {
        Receipt::whereKey($receipt->id)->where('status', 'cancel_pending')->update(['status' => 'active', 'cancel_reason' => null]);
    }

    /** Cash goes to the module's own cash stream; bank/other to the chosen bank or cash fund. */
    public function fund(string $module, string $method, ?int $fundId): Account
    {
        if ($method === 'cash') {
            return Account::byKey(Receipt::CASH_ACCOUNT[$module] ?? 'cash_misc');
        }
        $fund = $fundId ? Account::with('bankAccount')->where('is_postable', true)->where('is_active', true)->find($fundId) : null;
        $isBank = $fund?->bankAccount && $fund->bankAccount->is_active;
        $isCash = $fund && in_array($fund->key, Account::CASH_STREAMS, true);
        if (! $fund || ($method === 'bank' ? ! $isBank : ! ($isBank || $isCash))) {
            throw ValidationException::withMessages(['fund_account_id' => $method === 'bank'
                ? __('সক্রিয় ব্যাংক হিসাব নির্বাচন করুন।') : __('নগদ বা ব্যাংক হিসাব নির্বাচন করুন।')]);
        }

        return $fund;
    }
}
