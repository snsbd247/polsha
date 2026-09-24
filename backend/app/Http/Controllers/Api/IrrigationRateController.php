<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\IrrigationRate;
use App\Models\Season;
use App\Services\IrrigationService;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class IrrigationRateController extends Controller
{
    public function __construct(private IrrigationService $irrigation) {}

    /** Every rate row of a season (the history) plus the rate in force today for each combination. */
    public function index(Request $request): JsonResponse
    {
        $season = Season::findOrFail($request->query('season_id'));
        $date = $request->query('date', now()->toDateString());
        $rows = IrrigationRate::where('season_id', $season->id)
            ->with(['irrigationType:id,name_bn', 'landType:id,name_bn', 'creator:id,name_bn,name_en', 'approver:id,name_bn,name_en'])
            ->orderByDesc('effective_from')->orderByDesc('id')->get();

        $current = $rows->where('status', 'approved')
            ->groupBy(fn ($r) => $r->irrigation_type_id.'-'.($r->land_type_id ?? 0))
            ->map(function ($group) use ($date) {
                // Rows are newest-first, so the first one already started is the one in force.
                $first = $group->first();
                $live = $group->first(fn ($r) => $r->effective_from->toDateString() <= $date);
                $next = $group->filter(fn ($r) => $r->effective_from->toDateString() > $date)->sortBy('effective_from')->first();

                return [
                    'irrigation_type_id' => $first->irrigation_type_id,
                    'irrigation_type' => Tr::label($first->irrigationType?->name_bn),
                    'land_type_id' => $first->land_type_id,
                    'land_type' => Tr::label($first->landType?->name_bn),
                    'rate' => $live ? (float) $live->rate : null,
                    'effective_from' => $live?->effective_from?->toDateString(),
                    'next_rate' => $next ? (float) $next->rate : null,
                    'next_from' => $next?->effective_from?->toDateString(),
                    'changes' => $group->count(),
                ];
            })->sortBy(['irrigation_type', 'land_type'])->values();

        return response()->json([
            'season' => $season,
            'current' => $current,
            'history' => $rows->map(fn ($r) => $r->toArray() + [
                'irrigation_type_name' => Tr::label($r->irrigationType?->name_bn),
                'land_type_name' => Tr::label($r->landType?->name_bn),
            ]),
            'statuses' => Tr::map(IrrigationRate::STATUSES),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'season_id' => ['required', 'exists:seasons,id'],
            'irrigation_type_id' => ['required', Rule::exists('irrigation_types', 'id')],
            'land_type_id' => ['nullable', Rule::exists('land_types', 'id')],
            'rate' => ['required', 'numeric', 'gt:0', 'max:99999999'],
            'effective_from' => ['required', 'date'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json($this->irrigation->proposeRate($data), 201);
    }
}
