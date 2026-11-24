<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\IrrigationLift;
use App\Models\Land;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** The lift list (Irrigation → Categories → Lifts) and setting the lift of many plots at once. */
class IrrigationLiftController extends Controller
{
    public function index(): JsonResponse
    {
        $area = Land::whereNotNull('lift_id')->groupBy('lift_id')->selectRaw('lift_id, SUM(area_decimal) as area')->pluck('area', 'lift_id');

        return response()->json([
            'data' => IrrigationLift::withCount(['lands', 'rates'])->orderBy('sort_order')->orderBy('id')->get()
                ->map(fn ($l) => array_merge($l->toArray(), [
                    'display_name' => app()->getLocale() === 'en' && $l->name_en ? $l->name_en : $l->name_bn,
                    'area_decimal' => round((float) ($area[$l->id] ?? 0), 4),
                    'in_use' => $this->inUse($l),
                ])),
            'without_lift' => Land::whereNull('lift_id')->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json(IrrigationLift::create($this->validated($request)), 201);
    }

    /**
     * Turning a lift off (fewer lifts) moves its plots to another active lift
     * in the same step, so no plot is left on a lift that no longer exists.
     */
    public function update(Request $request, IrrigationLift $lift): JsonResponse
    {
        $data = $this->validated($request, $lift);
        $closing = $lift->is_active && array_key_exists('is_active', $data) && ! $data['is_active'];
        $lands = $closing ? Land::where('lift_id', $lift->id)->count() : 0;
        $moveTo = null;
        if ($lands) {
            $target = $request->validate([
                'move_to_lift_id' => ['required', Rule::exists('irrigation_lifts', 'id')->where('is_active', true), Rule::notIn([$lift->id])],
            ], ['move_to_lift_id.required' => __('এই লিফটে :n টি জমি আছে — জমিগুলো কোন লিফটে যাবে বাছাই করুন।', ['n' => $lands])]);
            $moveTo = (int) $target['move_to_lift_id'];
        }

        $moved = DB::transaction(function () use ($lift, $data, $moveTo) {
            $n = 0;
            if ($moveTo) {
                // one by one so every plot's history records the move
                foreach (Land::where('lift_id', $lift->id)->get() as $land) {
                    $land->update(['lift_id' => $moveTo]);
                    $n++;
                }
            }
            $lift->update($data);

            return $n;
        });

        return response()->json($lift->fresh()->toArray() + [
            'moved' => $moved,
            'message' => $moved ? __(':n টি জমি অন্য লিফটে সরানো হয়েছে।', ['n' => $moved]) : __('সংরক্ষণ হয়েছে।'),
        ]);
    }

    /** Only a lift nothing uses may go; one in use is made inactive instead. */
    public function destroy(IrrigationLift $lift): JsonResponse
    {
        if ($this->inUse($lift)) {
            throw ValidationException::withMessages(['lift' => __('এই লিফট জমি, রেট বা ইনভয়েসে ব্যবহৃত হয়েছে; মুছে না ফেলে নিষ্ক্রিয় করুন।')]);
        }
        $lift->delete();

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    /** Put many plots on one lift (or take them off it) — each change is audited on the land. */
    public function assign(Request $request): JsonResponse
    {
        $data = $request->validate([
            'land_ids' => ['required', 'array', 'min:1', 'max:1000'],
            'land_ids.*' => ['integer', 'exists:lands,id'],
            'lift_id' => ['nullable', Rule::exists('irrigation_lifts', 'id')->where('is_active', true)],
        ]);
        $count = DB::transaction(function () use ($data) {
            $n = 0;
            foreach (Land::whereIn('id', $data['land_ids'])->get() as $land) {
                if ($land->lift_id !== ($data['lift_id'] ?? null)) {
                    $land->update(['lift_id' => $data['lift_id'] ?? null]);
                    $n++;
                }
            }

            return $n;
        });

        return response()->json(['count' => $count, 'message' => __(':n টি জমির লিফট বদলানো হয়েছে।', ['n' => $count])]);
    }

    private function inUse(IrrigationLift $l): bool
    {
        return DB::table('lands')->where('lift_id', $l->id)->exists()
            || DB::table('irrigation_rates')->where('lift_id', $l->id)->exists()
            || DB::table('invoices')->where('lift_id', $l->id)->exists();
    }

    private function validated(Request $request, ?IrrigationLift $lift = null): array
    {
        $request->merge(['code' => strtoupper(trim((string) $request->input('code')))]);

        return $request->validate([
            'name_bn' => ['required', 'string', 'max:100', Rule::unique('irrigation_lifts')->ignore($lift)],
            'name_en' => ['nullable', 'string', 'max:100'],
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,12}$/', Rule::unique('irrigation_lifts')->ignore($lift)],
            'description' => ['nullable', 'string', 'max:500'],
            'is_active' => ['boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ], ['code.regex' => __('কোড ২–১২টি ইংরেজি বড় হাতের অক্ষর, সংখ্যা বা হাইফেন হবে।')]);
    }
}
