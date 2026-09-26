<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LandType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LandTypeController extends Controller
{
    public function index(): JsonResponse
    {
        // Seeded names are Bangla keys; user-added names simply fall back to themselves.
        return response()->json(LandType::withCount('lands')->withSum('lands as land_decimal', 'area_decimal')->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn ($t) => array_merge($t->toArray(), ['display_name' => __($t->name_bn), 'display_category' => $t->category ? __($t->category) : null,
                'land_decimal' => round((float) $t->land_decimal, 2)])));
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json(LandType::create($this->validated($request)), 201);
    }

    public function update(Request $request, LandType $landType): JsonResponse
    {
        $landType->update($this->validated($request, $landType));

        return response()->json($landType);
    }

    private function validated(Request $request, ?LandType $type = null): array
    {
        return $request->validate([
            'name_bn' => ['required', 'string', 'max:100', Rule::unique('land_types')->ignore($type)],
            'category' => ['nullable', 'string', 'max:50'],
            'description' => ['nullable', 'string', 'max:500'],
            'is_active' => ['boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);
    }
}
