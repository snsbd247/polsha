<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Services\LedgerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Cash and bank movements. A "fund" is one of the three cash streams or a
 * bank account; each movement is a two-line voucher posted immediately.
 */
class FundController extends Controller
{
    public function __construct(private LedgerService $ledger) {}

    /** Every fund with its balance on a date — the daily cash/bank position. */
    public function index(Request $request): JsonResponse
    {
        $date = $request->query('date', now()->toDateString());

        return response()->json($this->funds()->map(function (Account $a) use ($date) {
            $opening = $this->ledger->balance($a->id, $date, true);
            $closing = $this->ledger->balance($a->id, $date);
            $day = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
                ->where('account_id', $a->id)->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', $date)
                ->selectRaw('COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c')->first();

            return [
                'id' => $a->id, 'key' => $a->key, 'code' => $a->code, 'name_bn' => $a->name_bn, 'name_en' => $a->name_en,
                'kind' => $a->bankAccount ? 'bank' : 'cash',
                'bank' => $a->bankAccount?->only(['id', 'bank_name', 'branch_name', 'account_no', 'account_type', 'is_active']),
                'opening' => $opening, 'receipts' => round((float) $day->d, 2), 'payments' => round((float) $day->c, 2), 'closing' => $closing,
            ];
        })->values());
    }

    /** Money in: Dr fund, Cr source account (income, receivable …). */
    public function receipt(Request $request): JsonResponse
    {
        $data = $this->validated($request, 'counter_account_id');
        $fund = $this->fund($data['fund_account_id']);
        $this->authorizeFund($request, $fund);

        return response()->json($this->ledger->postNow('receipt', $data['date'], $data['narration'] ?? null, [
            ['account_id' => $fund->id, 'debit' => $data['amount']],
            ['account_id' => $data['counter_account_id'], 'credit' => $data['amount'], 'remarks' => $data['reference'] ?? null],
        ], $fund->bankAccount ? 'bank' : 'cash'), 201);
    }

    /** Money out: Dr expense/payable, Cr fund. */
    public function payment(Request $request): JsonResponse
    {
        $data = $this->validated($request, 'counter_account_id');
        $fund = $this->fund($data['fund_account_id']);
        $this->authorizeFund($request, $fund);

        return response()->json($this->ledger->postNow('payment', $data['date'], $data['narration'] ?? null, [
            ['account_id' => $data['counter_account_id'], 'debit' => $data['amount'], 'remarks' => $data['reference'] ?? null],
            ['account_id' => $fund->id, 'credit' => $data['amount']],
        ], $fund->bankAccount ? 'bank' : 'cash'), 201);
    }

    /** Between funds: cash→cash, cash→bank (deposit), bank→cash (withdrawal), bank→bank / FDR. */
    public function transfer(Request $request): JsonResponse
    {
        $data = $this->validated($request, 'to_account_id');
        $from = $this->fund($data['fund_account_id']);
        $to = $this->fund($data['to_account_id']);
        if ($from->id === $to->id) {
            throw ValidationException::withMessages(['to_account_id' => __('একই হিসাবে স্থানান্তর করা যায় না।')]);
        }
        $this->authorizeFund($request, $from);
        $this->authorizeFund($request, $to);

        return response()->json($this->ledger->postNow('contra', $data['date'], $data['narration'] ?? null, [
            ['account_id' => $to->id, 'debit' => $data['amount']],
            ['account_id' => $from->id, 'credit' => $data['amount'], 'remarks' => $data['reference'] ?? null],
        ], ($from->bankAccount || $to->bankAccount) ? 'bank' : 'cash'), 201);
    }

    private function funds()
    {
        return Account::with('bankAccount')->where('is_postable', true)
            ->where(fn ($q) => $q->whereIn('key', Account::CASH_STREAMS)->orWhereHas('bankAccount'))
            ->orderBy('code')->get();
    }

    private function fund(int $id): Account
    {
        $fund = Account::with('bankAccount')->where('is_postable', true)->where('is_active', true)->find($id);
        if (! $fund || (! in_array($fund->key, Account::CASH_STREAMS, true) && ! $fund->bankAccount)) {
            throw ValidationException::withMessages(['fund_account_id' => __('নগদ বা ব্যাংক হিসাব নির্বাচন করুন।')]);
        }
        if ($fund->bankAccount && ! $fund->bankAccount->is_active) {
            throw ValidationException::withMessages(['fund_account_id' => __('ব্যাংক হিসাবটি নিষ্ক্রিয়।')]);
        }

        return $fund;
    }

    /** A cashier (cash.create) may not move bank money and vice versa. */
    private function authorizeFund(Request $request, Account $fund): void
    {
        abort_unless($request->user()->can($fund->bankAccount ? 'bank.create' : 'cash.create'), 403, __('এই হিসাবে লেনদেনের অনুমতি নেই।'));
    }

    private function validated(Request $request, string $counter): array
    {
        $data = $request->validate([
            'fund_account_id' => ['required', 'integer'],
            $counter => ['required', 'integer', 'exists:chart_of_accounts,id'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:9999999999999'],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'narration' => ['nullable', 'string', 'max:500'],
            'reference' => ['nullable', 'string', 'max:255'],
        ]);
        // Moving money between two funds must be a transfer so both sides stay visible as such.
        if ($counter === 'counter_account_id') {
            $isFund = Account::whereKey($data[$counter])->where(fn ($q) => $q->whereIn('key', Account::CASH_STREAMS)->orWhereHas('bankAccount'))->exists();
            if ($isFund) {
                throw ValidationException::withMessages([$counter => __('নগদ/ব্যাংক হিসাবের মধ্যে লেনদেনের জন্য স্থানান্তর ব্যবহার করুন।')]);
            }
        }

        return $data;
    }
}
