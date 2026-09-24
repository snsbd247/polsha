<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Services\LedgerService;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AccountController extends Controller
{
    /** Flat list ordered by code, with posted balances; the client builds the tree. */
    public function index(): JsonResponse
    {
        $balances = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)
            ->groupBy('journal_lines.account_id')
            ->selectRaw('journal_lines.account_id, SUM(journal_lines.debit - journal_lines.credit) AS net')
            ->pluck('net', 'account_id');

        $accounts = Account::withCount('lines')->with('bankAccount:id,account_id')->orderBy('code')->get()
            ->map(fn (Account $a) => array_merge($a->toArray(), [
                'balance' => round((float) ($balances[$a->id] ?? 0) * ($a->isDebitNature() ? 1 : -1), 2),
                'is_fund' => in_array($a->key, Account::CASH_STREAMS, true) || $a->bankAccount !== null,
            ]));

        return response()->json(['data' => $accounts, 'types' => Tr::map(Account::TYPES)]);
    }

    /** Postable active accounts for voucher line pickers. */
    public function options(): JsonResponse
    {
        return response()->json(Account::where('is_postable', true)->where('is_active', true)->with('bankAccount:id,account_id')
            ->orderBy('code')->get(['id', 'key', 'code', 'name_bn', 'name_en', 'type'])
            ->map(fn ($a) => $a->only(['id', 'key', 'code', 'name_bn', 'name_en', 'type']) + [
                'is_fund' => in_array($a->key, Account::CASH_STREAMS, true) || $a->bankAccount !== null,
                'is_cash' => in_array($a->key, Account::CASH_STREAMS, true),
            ]));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $this->checkParent($data);

        return response()->json(Account::create($data), 201);
    }

    public function update(Request $request, Account $account): JsonResponse
    {
        $data = $this->validated($request, $account);
        $this->checkParent($data, $account);
        if ($account->is_system) {
            // Code keeps posting to system accounts; their type and shape are fixed.
            unset($data['type'], $data['parent_id'], $data['is_postable']);
            $data['is_active'] = true;
        } elseif ($account->lines()->exists() && ($data['type'] !== $account->type || ! $data['is_postable'])) {
            throw ValidationException::withMessages(['type' => __('লেনদেন আছে এমন হিসাবের ধরন বা লেনদেনযোগ্যতা বদলানো যাবে না।')]);
        }
        $account->update($data);

        return response()->json($account);
    }

    public function destroy(Account $account): JsonResponse
    {
        if ($account->is_system || $account->lines()->exists() || $account->children()->exists() || $account->bankAccount()->exists()) {
            throw ValidationException::withMessages(['account' => __('এই হিসাব মুছা যাবে না (সিস্টেম হিসাব, লেনদেন বা উপ-হিসাব আছে)।')]);
        }
        $account->delete();

        return response()->json(['ok' => true]);
    }

    private function validated(Request $request, ?Account $account = null): array
    {
        return $request->validate([
            'code' => ['required', 'string', 'max:20', 'regex:/^[0-9A-Za-z.\-]+$/', Rule::unique('chart_of_accounts')->ignore($account)],
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'type' => ['required', Rule::in(array_keys(Account::TYPES))],
            'parent_id' => ['nullable', 'exists:chart_of_accounts,id'],
            'is_postable' => ['required', 'boolean'],
            'is_active' => ['boolean'],
            'description' => ['nullable', 'string', 'max:500'],
        ]);
    }

    private function checkParent(array $data, ?Account $account = null): void
    {
        if (empty($data['parent_id'])) {
            return;
        }
        $parent = Account::find($data['parent_id']);
        if ($parent->is_postable || $parent->type !== ($account?->is_system ? $account->type : $data['type']) || $parent->id === $account?->id) {
            throw ValidationException::withMessages(['parent_id' => __('মূল হিসাব অবশ্যই একই ধরনের গ্রুপ হিসাব হতে হবে।')]);
        }
    }
}
