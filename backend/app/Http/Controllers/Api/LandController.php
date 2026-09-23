<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Farmer;
use App\Models\Land;
use App\Models\LandCultivation;
use App\Models\LandOwner;
use App\Models\LandType;
use App\Services\LandService;
use App\Support\AreaUnit;
use App\Support\Bn;
use App\Support\CsvExport;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LandController extends Controller
{
    public function __construct(private LandService $lands) {}

    public function meta(): JsonResponse
    {
        return response()->json([
            'surveys' => Land::SURVEYS,
            'statuses' => Land::STATUSES,
            'cultivation_types' => Land::CULTIVATION_TYPES,
            'units' => AreaUnit::LABELS,
            'unit_factors' => AreaUnit::factors(),
            'land_types' => LandType::where('is_active', true)->orderBy('sort_order')->get(['id', 'name_bn', 'category']),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $q = $this->filtered($request)->with($this->listRelations());
        $sort = in_array($request->query('sort'), ['land_code', 'dag_no', 'khatian_no', 'area_decimal'], true) ? $request->query('sort') : 'id';
        $q->orderBy($sort, $request->query('order') === 'asc' ? 'asc' : 'desc');

        $totals = (clone $this->filtered($request))->selectRaw('count(*) as c, coalesce(sum(area_decimal),0) as a')->first();

        return response()->json($q->paginate($this->perPage($request))->through(fn ($l) => $this->row($l))->toArray()
            + ['total_area' => (float) $totals->a]);
    }

    public function export(Request $request)
    {
        $rows = $this->filtered($request)->with($this->listRelations())->orderBy('land_code')->lazy()->map(function (Land $l) {
            $r = $this->row($l);

            return [$r['land_code'], $r['mouza'], $l->survey, $l->khatian_no, $l->dag_no, $r['area_decimal'], $r['land_type'],
                Land::STATUSES[$l->status] ?? $l->status,
                collect($r['owners'])->map(fn ($o) => "{$o['name_bn']} ({$o['share_percent']}%)")->implode(', '),
                collect($r['owners'])->pluck('father_name')->implode(', '),
                $r['cultivation']['name_bn'] ?? '', $r['cultivation'] ? Land::CULTIVATION_TYPES[$r['cultivation']['type']] : ''];
        });

        return CsvExport::download('lands-'.now()->format('Ymd').'.csv',
            ['Land ID', 'মৌজা', 'জরিপ', 'খতিয়ান', 'দাগ', 'পরিমাণ (শতক)', 'জমির ধরন', 'অবস্থা', 'মালিক', 'মালিকের পিতা', 'চাষি', 'চাষের ধরন'], $rows);
    }

    public function show(Land $land): JsonResponse
    {
        $land->load([
            'mouza.union.upazila', 'landType:id,name_bn',
            'ownerHistory.farmer:id,farmer_code,name_bn,father_name',
            'cultivationHistory.farmer:id,farmer_code,name_bn,father_name',
        ]);
        $patwari = LandOwner::query()->getConnection()->table('patwari_mouza_assignments as a')
            ->join('patwaris as p', 'p.id', '=', 'a.patwari_id')
            ->where('a.mouza_id', $land->mouza_id)->whereNull('a.end_date')
            ->get(['p.id', 'p.name', 'p.mobile']);

        return response()->json($this->row($land) + [
            'mouza_id' => $land->mouza_id,
            'land_type_id' => $land->land_type_id,
            'remarks' => $land->remarks,
            'location' => implode(', ', array_filter([$land->mouza->union?->name_bn, $land->mouza->union?->upazila?->name_bn])),
            'owner_history' => $land->ownerHistory,
            'cultivation_history' => $land->cultivationHistory,
            'patwaris' => $patwari,
            'created_at' => $land->created_at,
        ]);
    }

    public function checkDuplicate(Request $request): JsonResponse
    {
        $data = $request->validate(['mouza_id' => 'required|integer', 'survey' => 'required|string', 'khatian_no' => 'required|string', 'dag_no' => 'required|string']);

        return response()->json($this->lands->similar($data['mouza_id'], $data['survey'], $this->digits($data['khatian_no']), $this->digits($data['dag_no']), $request->integer('ignore_id') ?: null));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $extra = $request->validate([
            'owners' => ['required', 'array', 'min:1'],
            'owners.*.farmer_id' => ['required', 'exists:farmers,id'],
            'owners.*.share_percent' => ['required', 'numeric', 'min:0.01', 'max:100'],
            'owned_since' => ['required', 'date', 'before_or_equal:today'],
            'cultivation' => ['nullable', 'array'],
            'cultivation.farmer_id' => ['required_with:cultivation', 'exists:farmers,id'],
            'cultivation.type' => ['required_with:cultivation', Rule::in(array_keys(Land::CULTIVATION_TYPES))],
            'cultivation.terms' => ['nullable', 'string', 'max:500'],
            'cultivation.start_date' => ['required_with:cultivation', 'date', 'before_or_equal:today'],
        ], ['owners.required' => 'কমপক্ষে একজন মালিক দিন।']);

        $this->guardDuplicate($request, $data);
        $land = $this->lands->create($data, $extra['owners'], $extra['owned_since'], $extra['cultivation'] ?? null, $request->user()->id);

        return response()->json(['id' => $land->id, 'land_code' => $land->land_code], 201);
    }

    public function update(Request $request, Land $land): JsonResponse
    {
        $data = $this->validated($request);
        $this->guardDuplicate($request, $data, $land->id);
        $land->update($data);

        return response()->json(['id' => $land->id]);
    }

    public function destroy(Land $land): JsonResponse
    {
        $land->delete();

        return response()->json(['message' => 'জমির রেকর্ড মুছে ফেলা হয়েছে।']);
    }

    public function transfer(Request $request, Land $land): JsonResponse
    {
        $data = $request->validate([
            'owners' => ['required', 'array', 'min:1'],
            'owners.*.farmer_id' => ['required', 'exists:farmers,id'],
            'owners.*.share_percent' => ['required', 'numeric', 'min:0.01', 'max:100'],
            'effective_date' => ['required', 'date', 'before_or_equal:today'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $this->lands->transferOwnership($land, $data['owners'], $data['effective_date'], $data['remarks'] ?? null, $request->user()->id);

        return $this->show($land->fresh());
    }

    public function changeCultivation(Request $request, Land $land): JsonResponse
    {
        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'type' => ['required', Rule::in(array_keys(Land::CULTIVATION_TYPES))],
            'terms' => ['nullable', 'string', 'max:500'],
            'start_date' => ['required', 'date', 'before_or_equal:today'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $this->lands->changeCultivation($land, $data, $request->user()->id);

        return $this->show($land->fresh());
    }

    public function endCultivation(Request $request, Land $land): JsonResponse
    {
        $data = $request->validate(['end_date' => ['required', 'date', 'before_or_equal:today'], 'remarks' => ['nullable', 'string', 'max:500']]);
        $this->lands->endCultivation($land, $data['end_date'], $data['remarks'] ?? null, $request->user()->id);

        return $this->show($land->fresh());
    }

    public function history(Request $request, Land $land): JsonResponse
    {
        return response()->json(AuditLog::with('user:id,name_bn')->where('auditable_type', 'Land')->where('auditable_id', $land->id)
            ->latest('id')->paginate($this->perPage($request)));
    }

    /** Lands a farmer owns or cultivates — current and past. */
    public function forFarmer(Farmer $farmer): JsonResponse
    {
        $withLand = ['land' => fn ($q) => $q->withTrashed()->with(['mouza:id,name_bn', 'landType:id,name_bn'])];

        return response()->json([
            'owned' => LandOwner::with($withLand)->where('farmer_id', $farmer->id)->orderByRaw('end_date is not null')->orderByDesc('start_date')->get(),
            'cultivated' => LandCultivation::with($withLand + ['land.owners.farmer:id,name_bn,father_name'])->where('farmer_id', $farmer->id)
                ->orderByRaw('end_date is not null')->orderByDesc('start_date')->get(),
        ]);
    }

    private function listRelations(): array
    {
        return [
            'mouza:id,name_bn,jl_no', 'landType:id,name_bn',
            'owners.farmer:id,farmer_code,name_bn,father_name',
            'cultivation.farmer:id,farmer_code,name_bn,father_name',
        ];
    }

    private function filtered(Request $request): Builder
    {
        $q = Land::query();
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('land_code', 'like', "%$en%")
                ->orWhere('dag_no', $en)->orWhere('khatian_no', $en)
                ->orWhereHas('owners.farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('farmer_code', $en))
                ->orWhereHas('cultivation.farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('farmer_code', $en)));
        }
        foreach (['mouza_id', 'land_type_id', 'status', 'survey'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('upazila_id')) {
            $q->whereHas('mouza', fn ($m) => $m->where('upazila_id', $request->query('upazila_id')));
        }
        match ($request->query('cultivation')) {
            'none' => $q->whereDoesntHave('cultivation'),
            'own', 'borga', 'lease' => $q->whereHas('cultivation', fn ($c) => $c->where('type', $request->query('cultivation'))),
            default => null,
        };
        if ($request->filled('owner_id')) {
            $q->whereHas('owners', fn ($o) => $o->where('farmer_id', $request->query('owner_id')));
        }
        if ($request->filled('cultivator_id')) {
            $q->whereHas('cultivation', fn ($c) => $c->where('farmer_id', $request->query('cultivator_id')));
        }

        return $q;
    }

    private function digits(string $v): string
    {
        return trim(Bn::toEnDigits($v) ?? '');
    }

    private function validated(Request $request): array
    {
        $request->merge([
            'khatian_no' => $this->digits((string) $request->input('khatian_no')),
            'dag_no' => $this->digits((string) $request->input('dag_no')),
        ]);
        $data = $request->validate([
            'mouza_id' => ['required', 'exists:mouzas,id'],
            'survey' => ['required', Rule::in(array_keys(Land::SURVEYS))],
            'khatian_no' => ['required', 'string', 'max:30'],
            'dag_no' => ['required', 'string', 'max:30'],
            'area' => ['required', 'numeric', 'gt:0'],
            'area_unit' => ['required', Rule::in(array_keys(AreaUnit::LABELS))],
            'land_type_id' => ['required', Rule::exists('land_types', 'id')],
            'status' => ['required', Rule::in(array_keys(Land::STATUSES))],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ], ['area.gt' => 'জমির পরিমাণ শূন্যের বেশি হতে হবে।']);

        $data['area_decimal'] = AreaUnit::toDecimal((float) $data['area'], $data['area_unit']);
        unset($data['area'], $data['area_unit']);

        return $data;
    }

    private function guardDuplicate(Request $request, array $data, ?int $ignoreId = null): void
    {
        $matches = $this->lands->similar($data['mouza_id'], $data['survey'], $data['khatian_no'], $data['dag_no'], $ignoreId);
        if ($matches->isNotEmpty() && ! $request->boolean('confirm_duplicate')) {
            abort(response()->json([
                'message' => 'একই মৌজা, খতিয়ান ও দাগে আগে থেকেই জমি আছে।',
                'code' => 'possible_duplicate',
                'matches' => $matches,
            ], 409));
        }
    }

    private function row(Land $l): array
    {
        return [
            'id' => $l->id,
            'land_code' => $l->land_code,
            'mouza' => $l->mouza?->name_bn,
            'jl_no' => $l->mouza?->jl_no,
            'survey' => $l->survey,
            'khatian_no' => $l->khatian_no,
            'dag_no' => $l->dag_no,
            'area_decimal' => (float) $l->area_decimal,
            'land_type' => $l->landType?->name_bn,
            'status' => $l->status,
            'owners' => $l->owners->map(fn ($o) => [
                'id' => $o->id, 'farmer_id' => $o->farmer_id, 'farmer_code' => $o->farmer?->farmer_code,
                'name_bn' => $o->farmer?->name_bn, 'father_name' => $o->farmer?->father_name,
                'share_percent' => (float) $o->share_percent, 'start_date' => $o->start_date?->toDateString(),
            ])->values(),
            'cultivation' => $l->cultivation ? [
                'id' => $l->cultivation->id, 'farmer_id' => $l->cultivation->farmer_id,
                'farmer_code' => $l->cultivation->farmer?->farmer_code, 'name_bn' => $l->cultivation->farmer?->name_bn,
                'father_name' => $l->cultivation->farmer?->father_name, 'type' => $l->cultivation->type,
                'terms' => $l->cultivation->terms, 'start_date' => $l->cultivation->start_date?->toDateString(),
            ] : null,
        ];
    }
}
