<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Season;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SeasonController extends Controller
{
    public function index(): JsonResponse
    {
        $totals = DB::table('invoices')->where('status', '!=', 'cancelled')->groupBy('season_id')
            ->selectRaw('season_id, COUNT(*) c, SUM(amount) a, SUM(paid_amount) p')->get()->keyBy('season_id');

        $seasons = Season::orderByDesc('start_date')->orderByDesc('id')->get()->map(fn (Season $s) => $s->toArray() + [
            'invoice_count' => (int) ($totals[$s->id]->c ?? 0),
            'billed' => round((float) ($totals[$s->id]->a ?? 0), 2),
            'collected' => round((float) ($totals[$s->id]->p ?? 0), 2),
        ]);
        // the season in use now: open, and the latest to have started
        $current = Season::where('status', 'open')->orderByDesc('start_date')->first(['id', 'name_bn']);

        return response()->json(['data' => $seasons, 'statuses' => Tr::map(Season::STATUSES), 'types' => Tr::map(Season::TYPES), 'current' => $current]);
    }

    /** One season with what happened in it: plots billed, area, farmers, invoices and money. */
    public function show(Season $season): JsonResponse
    {
        $inv = DB::table('invoices')->where('season_id', $season->id)->where('status', '!=', 'cancelled');
        $updated = AuditLog::with('user:id,name_bn,name_en')->where('auditable_type', 'Season')->where('auditable_id', $season->id)->latest('id')->first();

        return response()->json($season->load('creator:id,name_bn,name_en')->toArray() + [
            'lands' => (clone $inv)->distinct()->count('land_id'),
            'area_decimal' => round((float) (clone $inv)->sum('area_decimal'), 2),
            'farmers' => (clone $inv)->distinct()->count('farmer_id'),
            'invoice_count' => (clone $inv)->count(),
            'billed' => round((float) (clone $inv)->sum('amount'), 2),
            'collected' => round((float) (clone $inv)->sum('paid_amount'), 2),
            'rates' => $season->rates()->count(),
            'updated_by' => $updated?->user ? ['name_bn' => $updated->user->name_bn, 'name_en' => $updated->user->name_en] : null,
            'can_delete' => ! $this->inUse($season),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json(Season::create($this->validated($request) + ['created_by' => $request->user()->id]), 201);
    }

    public function update(Request $request, Season $season): JsonResponse
    {
        $season->update($this->validated($request, $season));

        return response()->json($season);
    }

    /** Only a season with no bills and no rates may go; one in use is closed instead. */
    public function destroy(Season $season): JsonResponse
    {
        if ($this->inUse($season)) {
            throw ValidationException::withMessages(['season' => __('এই মৌসুমে ইনভয়েস বা রেট আছে; মুছে না ফেলে বন্ধ করুন।')]);
        }
        $season->delete();

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    private function inUse(Season $s): bool
    {
        return DB::table('invoices')->where('season_id', $s->id)->exists() || DB::table('irrigation_rates')->where('season_id', $s->id)->exists();
    }

    private function validated(Request $request, ?Season $season = null): array
    {
        $request->merge(['code' => strtoupper(trim((string) $request->input('code')))]);

        return $request->validate([
            'name_bn' => ['required', 'string', 'max:100', Rule::unique('seasons')->ignore($season)],
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,20}$/', Rule::unique('seasons')->ignore($season)],
            'type' => ['required', Rule::in(array_keys(Season::TYPES))],
            'crop' => ['nullable', 'string', 'max:100'],
            'start_date' => ['required', 'date'],
            'end_date' => ['required', 'date', 'after_or_equal:start_date'],
            'due_date' => ['nullable', 'date', 'after_or_equal:start_date'],
            'status' => ['required', Rule::in(array_keys(Season::STATUSES))],
            'remarks' => ['nullable', 'string', 'max:500'],
        ], ['code.regex' => __('কোড ২–২০টি ইংরেজি বড় হাতের অক্ষর, সংখ্যা বা হাইফেন হবে।')]);
    }
}
