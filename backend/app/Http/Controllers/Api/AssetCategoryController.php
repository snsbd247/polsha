<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AssetCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AssetCategoryController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(AssetCategory::withCount('assets')->orderBy('code')->get());
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json(AssetCategory::create($this->validated($request)), 201);
    }

    /** Life/salvage apply to assets added later; assets already booked keep their own figures. */
    public function update(Request $request, AssetCategory $assetCategory): JsonResponse
    {
        $assetCategory->update($this->validated($request, $assetCategory));

        return response()->json($assetCategory);
    }

    private function validated(Request $request, ?AssetCategory $cat = null): array
    {
        return $request->validate([
            'code' => ['required', 'string', 'max:20', Rule::unique('asset_categories', 'code')->ignore($cat)],
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'life_months' => ['required', 'integer', 'min:1', 'max:1200'],
            'salvage_percent' => ['required', 'numeric', 'min:0', 'max:100'],
            'is_active' => ['boolean'],
        ]);
    }
}
