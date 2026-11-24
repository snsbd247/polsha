<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StatementHead;
use App\Services\AtAGlanceService;
use App\Services\ReceiptPaymentStatementService;
use App\Services\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** The receipts & payments statements (জমা-খরচ বিবরণী) of the three funds, and their heads. */
class ReceiptPaymentController extends Controller
{
    public function __construct(private ReceiptPaymentStatementService $statements) {}

    public function show(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fund' => ['required', Rule::in(array_keys(ReceiptPaymentStatementService::FUNDS))],
            'month' => ['required', 'date_format:Y-m'],
        ]);

        return response()->json($this->statements->build($data['fund'], $data['month']) + ['header' => $this->header($data['fund'])]);
    }

    /** The society's letterhead for the statement; the water supply prints under its own name when one is set. */
    private function header(string $fund): array
    {
        $name = SettingService::get('society_name_bn');
        if ($fund === 'water' && ($water = SettingService::get('water_statement_title'))) {
            $name = $water;
        }

        return [
            'name' => $name,
            'registration_no' => SettingService::get('registration_no'),
            'registration_date' => SettingService::get('registration_date'),
            'address' => SettingService::get('print_address') ?: SettingService::get('address'),
        ];
    }

    /** "এক নজরে": the society at a glance at the end of a reporting month (or on a day). */
    public function glance(Request $request): JsonResponse
    {
        $date = $request->validate(['date' => ['nullable', 'date']])['date'] ?? now()->toDateString();

        return response()->json(app(AtAGlanceService::class)->build($date) + ['labels' => collect(AtAGlanceService::INFO)->map(fn ($l) => __($l))]);
    }

    /** The facts kept by hand for "এক নজরে". */
    public function saveGlanceInfo(Request $request): JsonResponse
    {
        $rules = collect(AtAGlanceService::INFO)->map(fn () => ['nullable', 'string', 'max:1000'])->all();
        $data = $request->validate($rules);
        SettingService::setMany(['at_a_glance' => json_encode(array_merge(AtAGlanceService::info(), $data), JSON_UNESCAPED_UNICODE)]);

        return response()->json(['info' => AtAGlanceService::info(), 'message' => __('সংরক্ষণ হয়েছে।')]);
    }

    public function heads(Request $request): JsonResponse
    {
        $fund = $request->validate(['fund' => ['required', Rule::in(array_keys(ReceiptPaymentStatementService::FUNDS))]])['fund'];

        return response()->json([
            'heads' => StatementHead::with('accounts:id,code,name_bn')->where('fund', $fund)->orderBy('side')->orderBy('sort_order')->orderBy('id')->get(),
            'funds' => collect(ReceiptPaymentStatementService::FUNDS)->map(fn ($l) => __($l)),
            'sides' => collect(ReceiptPaymentStatementService::SIDES)->map(fn ($l) => __($l)),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $data['sort_order'] ??= (int) StatementHead::where('fund', $data['fund'])->where('side', $data['side'])->max('sort_order') + 1;

        $head = DB::transaction(function () use ($data) {
            $head = StatementHead::create(collect($data)->except('account_ids')->all());
            $this->syncAccounts($head, $data['account_ids'] ?? []);

            return $head;
        });

        return response()->json($head->load('accounts:id,code,name_bn'), 201);
    }

    public function update(Request $request, StatementHead $head): JsonResponse
    {
        $data = $this->validated($request, $head);
        DB::transaction(function () use ($head, $data) {
            $head->update(collect($data)->except(['account_ids', 'fund', 'side'])->all());
            if (array_key_exists('account_ids', $data)) {
                $this->syncAccounts($head, $data['account_ids'] ?? []);
            }
        });

        return response()->json($head->fresh()->load('accounts:id,code,name_bn'));
    }

    public function destroy(StatementHead $head): JsonResponse
    {
        $head->delete();

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    /** New order of one side's heads: the ids top to bottom. */
    public function reorder(Request $request): JsonResponse
    {
        $data = $request->validate(['ids' => ['required', 'array', 'min:1'], 'ids.*' => ['integer', 'exists:statement_heads,id']]);
        DB::transaction(function () use ($data) {
            foreach ($data['ids'] as $i => $id) {
                StatementHead::whereKey($id)->update(['sort_order' => $i + 1]);
            }
        });

        return response()->json(['message' => __('ক্রম সংরক্ষণ হয়েছে।')]);
    }

    /** An account's money in a fund and direction can show under one head only. */
    private function syncAccounts(StatementHead $head, array $ids): void
    {
        $taken = DB::table('statement_head_accounts')->join('statement_heads', 'statement_heads.id', '=', 'statement_head_accounts.statement_head_id')
            ->where('statement_head_accounts.fund', $head->fund)->where('statement_head_accounts.side', $head->side)
            ->where('statement_head_id', '!=', $head->id)->whereIn('account_id', $ids)->pluck('statement_heads.name_bn');
        if ($taken->isNotEmpty()) {
            throw ValidationException::withMessages(['account_ids' => __('এই হিসাব আগে থেকেই ":p0" খাতে আছে।', ['p0' => $taken->first()])]);
        }
        $head->accounts()->sync(collect($ids)->unique()->mapWithKeys(fn ($id) => [$id => ['fund' => $head->fund, 'side' => $head->side]])->all());
    }

    private function validated(Request $request, ?StatementHead $head = null): array
    {
        $fund = $head?->fund ?? $request->input('fund');
        $side = $head?->side ?? $request->input('side');

        return $request->validate([
            'fund' => [$head ? 'sometimes' : 'required', Rule::in(array_keys(ReceiptPaymentStatementService::FUNDS))],
            'side' => [$head ? 'sometimes' : 'required', Rule::in(array_keys(ReceiptPaymentStatementService::SIDES))],
            'name_bn' => ['required', 'string', 'max:150', Rule::unique('statement_heads')->where('fund', $fund)->where('side', $side)->ignore($head)],
            'name_en' => ['nullable', 'string', 'max:150'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_active' => ['boolean'],
            'account_ids' => ['nullable', 'array'],
            'account_ids.*' => ['integer', 'exists:chart_of_accounts,id'],
        ]);
    }
}
