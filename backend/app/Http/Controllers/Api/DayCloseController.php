<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DayClose;
use App\Services\DayCloseService;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DayCloseController extends Controller
{
    public function __construct(private DayCloseService $days) {}

    /** Closed days register. */
    public function index(Request $request): JsonResponse
    {
        $q = DayClose::with(['closer:id,name_bn,name_en', 'reopener:id,name_bn,name_en']);
        if ($request->filled('from')) {
            $q->whereDate('date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->whereDate('date', '<=', $request->query('to'));
        }
        if ($request->boolean('with_difference')) {
            $q->where('difference', '!=', 0);
        }

        return response()->json($q->orderByDesc('date')->paginate($this->perPage($request))->toArray()
            + ['statuses' => Tr::map(DayClose::STATUSES), 'unclosed' => $this->days->unclosedDays()]);
    }

    public function summary(Request $request): JsonResponse
    {
        $data = $request->validate(['date' => ['nullable', 'date']]);

        return response()->json($this->days->summary($data['date'] ?? now()->toDateString()) + ['unclosed' => $this->days->unclosedDays()]);
    }

    public function close(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date' => ['required', 'date', 'before_or_equal:today'],
            'actual' => ['required', 'array'],
            'actual.*' => ['required', 'numeric', 'min:0'],
            'note' => ['nullable', 'string', 'max:500'],
            'denominations' => ['nullable', 'array'],
            'denominations.*' => ['nullable', 'integer', 'min:0'],
        ]);

        return response()->json($this->days->close($data['date'], $data['actual'], $data['note'] ?? null, $data['denominations'] ?? null), 201);
    }

    public function reopen(Request $request, DayClose $dayClose): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);

        return response()->json($this->days->requestReopen($dayClose, $data['reason']), 201);
    }
}
