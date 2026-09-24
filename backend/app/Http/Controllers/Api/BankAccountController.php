<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\BankAccount;
use App\Models\JournalLine;
use App\Services\AccountingReportService;
use App\Services\LedgerService;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class BankAccountController extends Controller
{
    public function __construct(private LedgerService $ledger) {}

    public function index(): JsonResponse
    {
        $rows = BankAccount::with('account:id,code,name_bn,name_en,is_active')->orderByDesc('is_active')->orderBy('bank_name')->get()
            ->map(fn ($b) => $b->toArray() + ['balance' => $this->ledger->balance($b->account_id)]);

        return response()->json(['data' => $rows, 'types' => Tr::map(BankAccount::TYPES)]);
    }

    /** A bank account is also a ledger account under "Bank Accounts" (1200). */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);

        $bank = DB::transaction(function () use ($data, $request) {
            $group = Account::byKey('bank_group');
            $last = Account::where('parent_id', $group->id)->lockForUpdate()->max('code');
            $label = $data['bank_name'].' — '.$data['account_no'];
            $account = Account::create([
                'code' => $last ? (string) ((int) $last + 1) : '1201',
                'name_bn' => $label, 'name_en' => $label, 'type' => 'asset', 'parent_id' => $group->id,
                'is_postable' => true, 'is_system' => false, 'is_active' => true,
            ]);

            return BankAccount::create($data + ['account_id' => $account->id, 'created_by' => $request->user()->id]);
        });

        return response()->json($bank->load('account'), 201);
    }

    public function update(Request $request, BankAccount $bankAccount): JsonResponse
    {
        $data = $this->validated($request, $bankAccount);
        DB::transaction(function () use ($bankAccount, $data) {
            $bankAccount->update($data);
            $label = $data['bank_name'].' — '.$data['account_no'];
            $bankAccount->account->update(['name_bn' => $label, 'name_en' => $label, 'is_active' => $data['is_active'] ?? true]);
        });

        return response()->json($bankAccount->load('account'));
    }

    /** Bank statement: the account's ledger with reconciliation marks. */
    public function statement(Request $request, BankAccount $bankAccount): JsonResponse
    {
        $from = $request->query('from', now()->startOfMonth()->toDateString());
        $to = $request->query('to', now()->toDateString());
        $report = app(AccountingReportService::class)->ledger($bankAccount->account, $from, $to);
        $report['bank'] = $bankAccount->toArray();
        $report['unreconciled'] = JournalLine::where('account_id', $bankAccount->account_id)->whereNull('reconciled_at')
            ->whereHas('journal', fn ($q) => $q->whereIn('status', LedgerService::EFFECTIVE))
            ->selectRaw('COUNT(*) n, COALESCE(SUM(debit - credit),0) amount')->first();

        return response()->json($report);
    }

    /** Tick/untick a line once it appears on the bank's own statement. */
    public function reconcile(Request $request, BankAccount $bankAccount, JournalLine $line): JsonResponse
    {
        abort_unless($line->account_id === $bankAccount->account_id, 404);
        $data = $request->validate(['reconciled' => ['required', 'boolean']]);
        $line->update($data['reconciled']
            ? ['reconciled_at' => now(), 'reconciled_by' => $request->user()->id]
            : ['reconciled_at' => null, 'reconciled_by' => null]);

        return response()->json($line);
    }

    private function validated(Request $request, ?BankAccount $bank = null): array
    {
        return $request->validate([
            'bank_name' => ['required', 'string', 'max:150'],
            'branch_name' => ['nullable', 'string', 'max:150'],
            'account_no' => ['required', 'string', 'max:50', Rule::unique('bank_accounts')->where('bank_name', $request->input('bank_name'))->ignore($bank)],
            'account_type' => ['required', Rule::in(array_keys(BankAccount::TYPES))],
            'opened_on' => ['nullable', 'date'],
            'fdr_maturity_date' => ['nullable', 'required_if:account_type,fdr', 'date'],
            'fdr_interest_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'is_active' => ['boolean'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
    }
}
