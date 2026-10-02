<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\IrrigationRate;
use App\Models\IrrigationType;
use App\Models\Season;
use App\Services\IrrigationService;
use App\Support\Bn;
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

    /**
     * Every rate row across seasons, each with when it ends (the next approved
     * change of the same season, source and land type, else the season end),
     * its state today, the rate it replaced and how it changed it. Serves the
     * rate list, the category rates and the rate change history.
     */
    public function all(Request $request): JsonResponse
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $today = now()->toDateString();
        $rows = IrrigationRate::with(['season:id,name_bn,end_date', 'irrigationType:id,name_bn,code', 'landType:id,name_bn', 'creator:id,name_bn,name_en', 'approver:id,name_bn,name_en'])
            ->withCount(['invoices' => fn ($q) => $q->where('status', '!=', 'cancelled')])
            ->orderBy('effective_from')->orderBy('id')->get();

        $out = collect();
        foreach ($rows->groupBy(fn ($r) => $r->season_id.'-'.$r->irrigation_type_id.'-'.($r->land_type_id ?? 0)) as $group) {
            $approved = $group->where('status', 'approved')->values();
            foreach ($group as $r) {
                $prev = $approved->filter(fn ($a) => $a->id !== $r->id && ($a->effective_from < $r->effective_from || ($a->effective_from == $r->effective_from && $a->id < $r->id)))->last();
                $next = $r->status === 'approved' ? $approved->first(fn ($a) => $a->effective_from > $r->effective_from || ($a->effective_from == $r->effective_from && $a->id > $r->id)) : null;
                $to = $next ? $next->effective_from->copy()->subDay()->toDateString() : $r->season?->end_date?->toDateString();
                $state = match (true) {
                    $r->status !== 'approved' => $r->status,
                    $r->effective_from->toDateString() > $today => 'upcoming',
                    $to !== null && $to < $today => 'expired',
                    default => 'active',
                };
                $out->push([
                    'id' => $r->id,
                    'season_id' => $r->season_id,
                    'season' => $r->season?->name_bn,
                    'irrigation_type_id' => $r->irrigation_type_id,
                    'irrigation_type' => Tr::label($r->irrigationType?->name_bn),
                    'irrigation_code' => $r->irrigationType?->code,
                    'land_type_id' => $r->land_type_id,
                    'land_type' => $r->landType ? Tr::label($r->landType->name_bn) : __('সব ধরনের জমি'),
                    'rate' => (float) $r->rate,
                    'old_rate' => $prev ? (float) $prev->rate : null,
                    'change' => $prev === null ? 'created' : ((float) $prev->rate === (float) $r->rate ? 'no_change' : 'updated'),
                    'effective_from' => $r->effective_from->toDateString(),
                    'effective_to' => $to,
                    'status' => $r->status,
                    'state' => $state,
                    'reason' => $r->reason,
                    'invoices' => $r->invoices_count,
                    'approval_request_id' => $r->approval_request_id,
                    'created_at' => $r->created_at,
                    'creator' => $r->creator ? ['name_bn' => $r->creator->name_bn, 'name_en' => $r->creator->name_en] : null,
                    'approver' => $r->approver ? ['name_bn' => $r->approver->name_bn, 'name_en' => $r->approver->name_en] : null,
                ]);
            }
        }

        $f = $out;
        foreach (['season_id', 'irrigation_type_id', 'land_type_id'] as $k) {
            if ($request->filled($k)) {
                $f = $f->where($k, (int) $request->query($k));
            }
        }
        if ($request->filled('state')) {
            $states = explode(',', (string) $request->query('state'));
            $f = $f->filter(fn ($r) => in_array($r['state'], $states, true));
        }
        if ($request->filled('change')) {
            $f = $f->where('change', $request->query('change'));
        }
        if ($request->filled('from')) {
            $f = $f->filter(fn ($r) => substr((string) $r['created_at'], 0, 10) >= $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $f = $f->filter(fn ($r) => substr((string) $r['created_at'], 0, 10) <= $request->date('to')->toDateString());
        }
        if ($s = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($s);
            $f = $f->filter(fn ($r) => str_contains(mb_strtolower($r['season'].' '.$r['irrigation_type'].' '.$r['land_type'].' '.$r['irrigation_code'].' '.$r['reason'].' '.($r['creator']['name_bn'] ?? '').' '.($r['creator']['name_en'] ?? '')), mb_strtolower($s))
                || (string) $r['rate'] === $en || (string) $r['old_rate'] === $en);
        }
        // newest change first for history; list pages sort themselves
        $f = $request->query('sort') === 'history' ? $f->sortByDesc(fn ($r) => (string) $r['created_at'].sprintf('%09d', $r['id']))->values()
            : $f->sortBy([['season_id', 'desc'], ['irrigation_type', 'asc'], ['land_type', 'asc'], ['effective_from', 'desc']])->values();

        $perPage = $this->perPage($request);
        $page = max(1, $request->integer('page', 1));

        return response()->json([
            'data' => $f->forPage($page, $perPage)->values(),
            'total' => $f->count(),
            'current_page' => $page,
            'per_page' => $perPage,
            'summary' => [
                'total' => $out->count(),
                'active' => $out->where('state', 'active')->count(),
                'inactive' => $out->whereIn('state', ['expired', 'rejected'])->count(),
                'pending' => $out->where('state', 'pending')->count(),
                'expired' => $out->where('state', 'expired')->count(),
                'created' => $out->where('change', 'created')->count(),
                'updated' => $out->where('change', 'updated')->count(),
                'rejected' => $out->where('status', 'rejected')->count(),
                'combinations' => $out->where('state', 'active')->map(fn ($r) => $r['irrigation_type_id'].'-'.$r['land_type_id'])->unique()->count(),
                'sources' => IrrigationType::where('is_active', true)->count(),
            ],
            'states' => Tr::map(self::STATES),
        ]);
    }

    public const STATES = ['active' => 'সক্রিয়', 'upcoming' => 'আসন্ন', 'expired' => 'মেয়াদ শেষ', 'pending' => 'অনুমোদনের অপেক্ষায়', 'rejected' => 'প্রত্যাখ্যাত'];

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

    /** What copying one season's rates into another would bring over. Without ?from, the season before the target is used. */
    public function copyPreview(Request $request): JsonResponse
    {
        $data = $request->validate(['to' => ['required', 'exists:seasons,id'], 'from' => ['nullable', 'exists:seasons,id']]);
        $to = Season::findOrFail($data['to']);
        $from = isset($data['from']) ? Season::findOrFail($data['from'])
            : Season::whereKeyNot($to->id)->whereHas('rates', fn ($q) => $q->where('status', 'approved'))
                ->where('start_date', '<=', $to->start_date)->orderByDesc('start_date')->first();

        return response()->json([
            'from' => $from?->only(['id', 'name_bn', 'name_en', 'code']),
            'to' => $to->only(['id', 'name_bn', 'name_en', 'code', 'start_date', 'status']),
            'rows' => $from ? $this->irrigation->copyPreview($from, $to) : [],
        ]);
    }

    /** Copy rates (with changes) into a season; one approval for all of them. */
    public function copy(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from_season_id' => ['required', 'exists:seasons,id', 'different:to_season_id'],
            'to_season_id' => ['required', 'exists:seasons,id'],
            'effective_from' => ['required', 'date'],
            'rows' => ['required', 'array', 'min:1', 'max:200'],
            'rows.*.irrigation_type_id' => ['required', 'integer'],
            'rows.*.land_type_id' => ['nullable', 'integer'],
            'rows.*.rate' => ['required', 'numeric', 'gt:0', 'max:99999999'],
        ]);
        $rates = $this->irrigation->copyRates(Season::findOrFail($data['from_season_id']), Season::findOrFail($data['to_season_id']), $data['rows'], $data['effective_from']);
        $live = collect($rates)->every(fn ($r) => $r->status === 'approved');

        return response()->json([
            'count' => count($rates),
            'message' => $live ? __(':n টি রেট চালু হয়েছে।', ['n' => count($rates)]) : __(':n টি রেট একসাথে অনুমোদনের জন্য পাঠানো হয়েছে।', ['n' => count($rates)]),
        ], 201);
    }
}
