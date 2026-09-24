<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LoanProduct;
use App\Services\LoanService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LoanProductController extends Controller
{
    public function __construct(private LoanService $loans) {}

    public function index(Request $request): JsonResponse
    {
        $rows = LoanProduct::withCount(['loans as running' => fn ($q) => $q->where('status', 'active')])
            ->when($request->boolean('active'), fn ($q) => $q->where('is_active', true))
            ->orderBy('code')->get();

        return response()->json($rows);
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json(LoanProduct::create($this->validated($request)), 201);
    }

    public function update(Request $request, LoanProduct $product): JsonResponse
    {
        // running loans keep the terms they were given, so edits only affect new applications
        $product->update($this->validated($request, $product));

        return response()->json($product);
    }

    /** Sample schedule for the product form: what a borrower would repay. */
    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:1'],
            'interest_rate' => ['required', 'numeric', 'min:0', 'max:100'],
            'interest_method' => ['required', Rule::in(array_keys(LoanProduct::METHODS))],
            'frequency' => ['required', Rule::in(array_keys(LoanProduct::FREQUENCIES))],
            'installments' => ['required', 'integer', 'min:1', 'max:520'],
            'term_months' => ['nullable', 'integer', 'min:1', 'max:120'],
            'date' => ['nullable', 'date'],
            'first_due_on' => ['nullable', 'date'],
        ]);
        $date = $data['date'] ?? now()->toDateString();
        $rows = $this->loans->buildSchedule($data, (float) $data['amount'], $data['first_due_on'] ?? $this->loans->defaultFirstDue($data, $date));

        return response()->json([
            'rows' => $rows,
            'total_principal' => round(array_sum(array_column($rows, 'principal')), 2),
            'total_interest' => round(array_sum(array_column($rows, 'interest')), 2),
        ]);
    }

    private function validated(Request $request, ?LoanProduct $product = null): array
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'max:20', Rule::unique('loan_products', 'code')->ignore($product?->id)],
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'category' => ['required', Rule::in(array_keys(LoanProduct::CATEGORIES))],
            'max_amount' => ['required', 'numeric', 'min:1', 'max:9999999999999'],
            'savings_multiplier' => ['nullable', 'numeric', 'min:0.1', 'max:1000'],
            'interest_rate' => ['required', 'numeric', 'min:0', 'max:100'],
            'interest_method' => ['required', Rule::in(array_keys(LoanProduct::METHODS))],
            'frequency' => ['required', Rule::in(array_keys(LoanProduct::FREQUENCIES))],
            'installments' => ['required_unless:frequency,one_time', 'nullable', 'integer', 'min:1', 'max:520'],
            'term_months' => ['required_if:frequency,one_time', 'nullable', 'integer', 'min:1', 'max:120'],
            'penalty_rate' => ['required', 'numeric', 'min:0', 'max:100'],
            'grace_days' => ['required', 'integer', 'min:0', 'max:365'],
            'guarantors_required' => ['required', 'integer', 'min:0', 'max:5'],
            'is_active' => ['boolean'],
            'description' => ['nullable', 'string', 'max:500'],
        ]);
        if ($data['frequency'] === 'one_time') {
            $data['installments'] = 1;
        } else {
            $data['term_months'] = null;
        }

        return $data;
    }
}
