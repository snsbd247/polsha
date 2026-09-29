<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\IrrigationType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class IrrigationTypeController extends Controller
{
    public function index(): JsonResponse
    {
        // Seeded names are Bangla keys; user-added names fall back to themselves.
        return response()->json(IrrigationType::withCount(['lands', 'rates'])->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn ($t) => array_merge($t->toArray(), ['display_name' => __($t->name_bn), 'in_use' => $this->inUse($t)])));
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

    /** Only a type nothing uses may go; one in use is made inactive instead. */
    public function destroy(IrrigationType $irrigationType): JsonResponse
    {
        if ($this->inUse($irrigationType)) {
            throw ValidationException::withMessages(['irrigation_type' => __('এই সেচের ধরন জমি, রেট বা ইনভয়েসে ব্যবহৃত হয়েছে; মুছে না ফেলে নিষ্ক্রিয় করুন।')]);
        }
        $irrigationType->delete();

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    private function inUse(IrrigationType $t): bool
    {
        return DB::table('lands')->where('irrigation_type_id', $t->id)->exists()
            || DB::table('irrigation_rates')->where('irrigation_type_id', $t->id)->exists()
            || DB::table('invoices')->where('irrigation_type_id', $t->id)->exists();
    }

    private function validated(Request $request, ?IrrigationType $type = null): array
    {
        $request->merge(['code' => strtoupper(trim((string) $request->input('code')))]);

        return $request->validate([
            'name_bn' => ['required', 'string', 'max:100', Rule::unique('irrigation_types')->ignore($type)],
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,12}$/', Rule::unique('irrigation_types')->ignore($type)],
            'description' => ['nullable', 'string', 'max:500'],
            'is_active' => ['boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ], ['code.regex' => __('কোড ২–১২টি ইংরেজি বড় হাতের অক্ষর, সংখ্যা বা হাইফেন হবে।')]);
    }
}
