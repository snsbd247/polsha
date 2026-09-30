<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BankAccount;
use App\Models\BankReconciliation;
use App\Models\BankStatementLine;
use App\Services\BankReconciliationService;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BankReconciliationController extends Controller
{
    public function __construct(private BankReconciliationService $recs) {}

    public function index(Request $request): JsonResponse
    {
        $q = BankReconciliation::with(['bankAccount:id,bank_name,branch_name,account_no,account_id', 'creator:id,name_bn,name_en', 'finalizer:id,name_bn,name_en'])
            ->withCount(['lines', 'lines as unmatched_count' => fn ($l) => $l->whereNull('journal_line_id')]);
        if ($request->filled('bank_account_id')) {
            $q->where('bank_account_id', $request->query('bank_account_id'));
        }
        if ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }

        $lastMonth = now()->subMonthNoOverflow()->format('Y-m');
        $banks = BankAccount::where('is_active', true)->count();

        return response()->json($q->orderByDesc('period')->orderBy('bank_account_id')->paginate($this->perPage($request))->toArray() + [
            'statuses' => Tr::map(BankReconciliation::STATUSES),
            // the cards: all, finished, still open, and how many active bank accounts have last month done
            'counts' => [
                'total' => BankReconciliation::count(),
                'finalized' => BankReconciliation::where('status', 'finalized')->count(),
                'draft' => BankReconciliation::where('status', 'draft')->count(),
                'last_month' => $lastMonth,
                'last_month_done' => BankReconciliation::where('period', $lastMonth)->where('status', 'finalized')->distinct()->count('bank_account_id'),
                'banks' => $banks,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'bank_account_id' => ['required', 'exists:bank_accounts,id'],
            'period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
            'statement_opening' => ['nullable', 'numeric'],
            'statement_closing' => ['required', 'numeric'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json($this->recs->start(BankAccount::findOrFail($data['bank_account_id']), $data), 201);
    }

    public function show(BankReconciliation $bankReconciliation): JsonResponse
    {
        return response()->json($this->recs->view($bankReconciliation) + ['statuses' => Tr::map(BankReconciliation::STATUSES)]);
    }

    public function update(Request $request, BankReconciliation $bankReconciliation): JsonResponse
    {
        $data = $request->validate([
            'statement_opening' => ['sometimes', 'numeric'],
            'statement_closing' => ['sometimes', 'numeric'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $this->recs->update($bankReconciliation, $data);

        return $this->show($bankReconciliation);
    }

    public function destroy(BankReconciliation $bankReconciliation): JsonResponse
    {
        $this->recs->destroy($bankReconciliation);

        return response()->json(null, 204);
    }

    public function addLines(Request $request, BankReconciliation $bankReconciliation): JsonResponse
    {
        $data = $request->validate([
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.date' => ['required', 'date'],
            'lines.*.description' => ['nullable', 'string', 'max:255'],
            'lines.*.reference' => ['nullable', 'string', 'max:100'],
            'lines.*.amount' => ['required', 'numeric', 'between:-9999999999999,9999999999999'],
        ]);
        $this->recs->addLines($bankReconciliation, $data['lines']);

        return $this->show($bankReconciliation);
    }

    public function deleteLine(BankReconciliation $bankReconciliation, BankStatementLine $line): JsonResponse
    {
        abort_unless($line->reconciliation_id === $bankReconciliation->id, 404);
        $this->recs->deleteLine($bankReconciliation, $line);

        return $this->show($bankReconciliation);
    }

    public function autoMatch(BankReconciliation $bankReconciliation): JsonResponse
    {
        $n = $this->recs->autoMatch($bankReconciliation);

        return response()->json(['matched' => $n] + $this->recs->view($bankReconciliation));
    }

    public function match(Request $request, BankReconciliation $bankReconciliation, BankStatementLine $line): JsonResponse
    {
        abort_unless($line->reconciliation_id === $bankReconciliation->id, 404);
        $data = $request->validate(['journal_line_id' => ['required', 'integer']]);
        $this->recs->match($bankReconciliation, $line, $data['journal_line_id']);

        return $this->show($bankReconciliation);
    }

    public function unmatch(BankReconciliation $bankReconciliation, BankStatementLine $line): JsonResponse
    {
        abort_unless($line->reconciliation_id === $bankReconciliation->id, 404);
        $this->recs->unmatch($bankReconciliation, $line);

        return $this->show($bankReconciliation);
    }

    public function book(Request $request, BankReconciliation $bankReconciliation, BankStatementLine $line): JsonResponse
    {
        abort_unless($line->reconciliation_id === $bankReconciliation->id, 404);
        $data = $request->validate(['account_id' => ['required', 'exists:chart_of_accounts,id']]);
        $this->recs->book($bankReconciliation, $line, $data['account_id']);

        return $this->show($bankReconciliation);
    }

    public function finalize(BankReconciliation $bankReconciliation): JsonResponse
    {
        $this->recs->finalize($bankReconciliation);

        return $this->show($bankReconciliation);
    }
}
