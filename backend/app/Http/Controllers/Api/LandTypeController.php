<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LandType;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class LandTypeController extends Controller
{
    public function index(): JsonResponse
    {
        // Seeded names are Bangla keys; user-added names simply fall back to themselves.
        return response()->json(LandType::withCount('lands')->withSum('lands as land_decimal', 'area_decimal')->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn ($t) => array_merge($t->toArray(), ['display_name' => __($t->name_bn),
                'display_category' => $t->category ? __(LandType::CATEGORIES[$t->category] ?? $t->category) : null,
                'land_decimal' => round((float) $t->land_decimal, 2), 'in_use' => $this->inUse($t)])));
    }

    public function meta(): JsonResponse
    {
        return response()->json(['categories' => Tr::map(LandType::CATEGORIES)]);
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

    /** Only a type nothing uses may go; one in use is made inactive instead. */
    public function destroy(LandType $landType): JsonResponse
    {
        if ($this->inUse($landType)) {
            throw ValidationException::withMessages(['land_type' => __('এই ধরন জমি, সেচ বিল বা রেটে ব্যবহৃত হয়েছে; মুছে না ফেলে নিষ্ক্রিয় করুন।')]);
        }
        $landType->delete();

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    private function inUse(LandType $t): bool
    {
        return DB::table('lands')->where('land_type_id', $t->id)->exists()
            || DB::table('invoices')->where('land_type_id', $t->id)->exists()
            || DB::table('irrigation_rates')->where('land_type_id', $t->id)->exists();
    }

    private function validated(Request $request, ?LandType $type = null): array
    {
        $request->merge(['code' => strtoupper(trim((string) $request->input('code')))]);

        return $request->validate([
            'name_bn' => ['required', 'string', 'max:100', Rule::unique('land_types')->ignore($type)],
            'code' => ['required', 'regex:/^[A-Z0-9]{2,5}$/', Rule::unique('land_types')->ignore($type)],
            'category' => ['required', Rule::in(array_keys(LandType::CATEGORIES))],
            'description' => ['nullable', 'string', 'max:500'],
            'default_rate' => ['nullable', 'numeric', 'min:0'],
            'is_active' => ['boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ], ['code.regex' => __('কোড ২–৫টি ইংরেজি বড় হাতের অক্ষর বা সংখ্যা হবে।')]);
    }
}
