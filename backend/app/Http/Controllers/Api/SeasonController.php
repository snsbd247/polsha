<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Season;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

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

        return response()->json(['data' => $seasons, 'statuses' => Tr::map(Season::STATUSES)]);
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

    private function validated(Request $request, ?Season $season = null): array
    {
        return $request->validate([
            'name_bn' => ['required', 'string', 'max:100', Rule::unique('seasons')->ignore($season)],
            'crop' => ['nullable', 'string', 'max:100'],
            'start_date' => ['required', 'date'],
            'end_date' => ['required', 'date', 'after_or_equal:start_date'],
            'due_date' => ['nullable', 'date', 'after_or_equal:start_date'],
            'status' => ['required', Rule::in(array_keys(Season::STATUSES))],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
    }
}
