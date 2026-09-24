<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\IrrigationType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class IrrigationTypeController extends Controller
{
    public function index(): JsonResponse
    {
        // Seeded names are Bangla keys; user-added names fall back to themselves.
        return response()->json(IrrigationType::withCount('lands')->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn ($t) => array_merge($t->toArray(), ['display_name' => __($t->name_bn)])));
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json(IrrigationType::create($this->validated($request)), 201);
    }

    public function update(Request $request, IrrigationType $irrigationType): JsonResponse
    {
        $irrigationType->update($this->validated($request, $irrigationType));

        return response()->json($irrigationType);
    }

    private function validated(Request $request, ?IrrigationType $type = null): array
    {
        return $request->validate([
            'name_bn' => ['required', 'string', 'max:100', Rule::unique('irrigation_types')->ignore($type)],
            'description' => ['nullable', 'string', 'max:500'],
            'is_active' => ['boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);
    }
}
