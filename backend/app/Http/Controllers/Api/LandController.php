<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Farmer;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\LandCultivation;
use App\Models\LandDocument;
use App\Models\LandNote;
use App\Models\LandOwner;
use App\Models\LandType;
use App\Models\Sequence;
use App\Services\LandService;
use App\Services\SequenceService;
use App\Support\AreaUnit;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class LandController extends Controller
{
    public function __construct(private LandService $lands) {}

    public function meta(): JsonResponse
    {
        return response()->json([
            'surveys' => Tr::map(Land::SURVEYS),
            'statuses' => Tr::map(Land::STATUSES),
            'cultivation_types' => Tr::map(Land::CULTIVATION_TYPES),
            'document_types' => Tr::map(Land::DOCUMENT_TYPES),
            'units' => Tr::map(AreaUnit::LABELS),
            'unit_factors' => AreaUnit::factors(),
            'irrigation_types' => IrrigationType::where('is_active', true)->orderBy('sort_order')->get(['id', 'name_bn'])->map(fn ($t) => ['id' => $t->id, 'name_bn' => __($t->name_bn)]),
            'land_types' => LandType::where('is_active', true)->orderBy('sort_order')->get(['id', 'name_bn', 'category'])->map(fn ($t) => ['id' => $t->id, 'name_bn' => __($t->name_bn), 'category' => Tr::label($t->category)]),
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
                __(Land::STATUSES[$l->status] ?? $l->status),
                collect($r['owners'])->map(fn ($o) => "{$o['name_bn']} ({$o['share_percent']}%)")->implode(', '),
                collect($r['owners'])->pluck('father_name')->implode(', '),
                $r['cultivation']['name_bn'] ?? '', $r['cultivation'] ? __(Land::CULTIVATION_TYPES[$r['cultivation']['type']]) : ''];
        });

        return CsvExport::download('lands-'.now()->format('Ymd').'.csv',
            ['Land ID', __('মৌজা'), __('জরিপ'), __('খতিয়ান'), __('দাগ'), __('পরিমাণ (শতক)'), __('জমির ধরন'), __('অবস্থা'), __('মালিক'), __('মালিকের পিতা'), __('চাষি'), __('চাষের ধরন')], $rows);
    }

    public function show(Land $land): JsonResponse
    {
        $land->load([
            'mouza.union.upazila.district', 'mouza.villages:id,name_bn', 'landType:id,name_bn', 'irrigationType:id,name_bn',
            'ownerHistory.farmer:id,farmer_code,name_bn,father_name',
            'cultivationHistory.farmer:id,farmer_code,name_bn,father_name',
            'documents.uploader:id,name_bn,name_en', 'notes.creator:id,name_bn,name_en',
        ]);
        $patwari = LandOwner::query()->getConnection()->table('patwari_mouza_assignments as a')
            ->join('patwaris as p', 'p.id', '=', 'a.patwari_id')
            ->where('a.mouza_id', $land->mouza_id)->whereNull('a.end_date')
            ->get(['p.id', 'p.name', 'p.mobile']);

        // irrigation: bills raised on this plot; "irrigated" = area billed in the latest season with a bill
        $invoices = $land->invoices()->with('season:id,name_bn')->where('status', '!=', 'cancelled')
            ->latest('invoice_date')->latest('id')->limit(50)
            ->get(['id', 'invoice_no', 'season_id', 'farmer_id', 'cultivation_type', 'invoice_date', 'area_decimal', 'amount', 'paid_amount', 'status']);
        $irrigated = $invoices->isEmpty() ? 0.0 : (float) $invoices->where('season_id', $invoices->first()->season_id)->sum('area_decimal');

        // everyone who has owned or farmed it, with the details the owner/cultivator cards show
        $people = Farmer::withTrashed()->with(['member:id,farmer_id,member_no,status', 'village:id,name_bn'])
            ->whereIn('id', $land->ownerHistory->pluck('farmer_id')->merge($land->cultivationHistory->pluck('farmer_id'))->unique())
            ->get()->keyBy('id');
        $card = fn (?Farmer $f) => $f ? [
            'id' => $f->id, 'farmer_code' => $f->farmer_code, 'name_bn' => $f->name_bn, 'name_en' => $f->name_en, 'father_name' => $f->father_name,
            'mobile' => $f->mobile, 'nid' => $f->nid, 'member_no' => $f->member?->member_no,
            'address' => implode(', ', array_filter([$f->village?->name_bn, $f->para, $f->post_office])),
            'photo_url' => $f->photo ? url("api/farmers/{$f->id}/photo") : null,
        ] : null;
        $current = $land->owners->pluck('farmer_id')->all();
        $related = $people->map(fn (Farmer $f) => $card($f) + [
            'roles' => array_values(array_filter([
                in_array($f->id, $current, true) ? 'owner' : ($land->ownerHistory->contains('farmer_id', $f->id) ? 'former_owner' : null),
                $land->cultivation?->farmer_id === $f->id ? 'cultivator' : ($land->cultivationHistory->contains('farmer_id', $f->id) ? 'former_cultivator' : null),
            ])),
        ])->values();

        $upazila = $land->mouza->union?->upazila;

        return response()->json($this->row($land) + [
            'mouza_id' => $land->mouza_id,
            'land_type_id' => $land->land_type_id,
            'remarks' => $land->remarks,
            'village_id' => $land->village_id,
            'latitude' => $land->latitude,
            'longitude' => $land->longitude,
            'location_note' => $land->location_note,
            'irrigable_decimal' => $land->irrigable_decimal !== null ? (float) $land->irrigable_decimal : null,
            'location' => implode(', ', array_filter([$land->mouza->union?->name_bn, $upazila?->name_bn])),
            'district' => $upazila?->district?->name_bn,
            'upazila' => $upazila?->name_bn,
            'union' => $land->mouza->union?->name_bn,
            'villages' => $land->mouza->villages->pluck('name_bn')->implode(', '),
            'owner_history' => $land->ownerHistory,
            'cultivation_history' => $land->cultivationHistory,
            'patwaris' => $patwari,
            'owner_cards' => $land->owners->map(fn ($o) => $card($people[$o->farmer_id] ?? null) + ['share_percent' => (float) $o->share_percent])->values(),
            'cultivator_card' => $land->cultivation ? $card($people[$land->cultivation->farmer_id] ?? null) : null,
            'related_farmers' => $related,
            'irrigation' => [
                'irrigated_decimal' => $irrigated,
                'season' => $invoices->first()?->season?->name_bn,
                'invoices' => $invoices->map(fn ($i) => $i->only(['id', 'invoice_no', 'invoice_date', 'area_decimal', 'amount', 'paid_amount', 'status', 'cultivation_type'])
                    + ['season' => $i->season?->name_bn, 'payer' => $people[$i->farmer_id]->name_bn ?? null]),
            ],
            'documents' => $land->documents,
            'notes' => $land->notes,
            'created_at' => $land->created_at,
        ]);
    }

    public function storeDocument(Request $request, Land $land): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(array_keys(Land::DOCUMENT_TYPES))],
            'title' => ['nullable', 'string', 'max:150'],
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
        ]);
        $file = $request->file('file');
        $doc = $land->documents()->create([
            'type' => $data['type'], 'title' => $data['title'] ?? null,
            // private disk: only reachable through the authenticated download route
            'path' => $file->store("land-docs/{$land->id}", 'local'),
            'original_name' => mb_substr($file->getClientOriginalName(), 0, 250),
            'mime' => $file->getMimeType(), 'size' => $file->getSize(), 'uploaded_by' => $request->user()->id,
        ]);

        return response()->json($doc->load('uploader:id,name_bn,name_en'), 201);
    }

    public function downloadDocument(Land $land, LandDocument $document)
    {
        abort_unless($document->land_id === $land->id && Storage::disk('local')->exists($document->path), 404);

        return Storage::disk('local')->response($document->path, $document->original_name);
    }

    public function destroyDocument(Land $land, LandDocument $document): JsonResponse
    {
        abort_unless($document->land_id === $land->id, 404);
        Storage::disk('local')->delete($document->path);
        $document->delete();

        return response()->json(['message' => __('ডকুমেন্ট মুছে ফেলা হয়েছে।')]);
    }

    public function storeNote(Request $request, Land $land): JsonResponse
    {
        $data = $request->validate(['note' => ['required', 'string', 'max:500']]);

        return response()->json($land->notes()->create(['note' => $data['note'], 'created_by' => $request->user()->id])->load('creator:id,name_bn,name_en'), 201);
    }

    public function destroyNote(Land $land, LandNote $note): JsonResponse
    {
        abort_unless($note->land_id === $land->id, 404);
        $note->delete();

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
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
        ], ['owners.required' => __('কমপক্ষে একজন মালিক দিন।')]);

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

        return response()->json(['message' => __('জমির রেকর্ড মুছে ফেলা হয়েছে।')]);
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
            'mouza:id,name_bn,jl_no', 'landType:id,name_bn', 'irrigationType:id,name_bn',
            'owners.farmer:id,farmer_code,name_bn,name_en,father_name,photo',
            'cultivation.farmer:id,farmer_code,name_bn,name_en,father_name,photo',
        ];
    }

    /** Header figures for the land list. */
    public function summary(): JsonResponse
    {
        $current = LandOwner::whereNull('end_date')->whereHas('land');

        return response()->json([
            'lands' => Land::count(),
            'owners' => (clone $current)->distinct()->count('farmer_id'),
            'area_decimal' => round((float) Land::sum('area_decimal'), 2),
            'mouzas' => Land::distinct()->count('mouza_id'),
            'cultivators' => LandCultivation::whereNull('end_date')->whereHas('land')->distinct()->count('farmer_id'),
            'borga' => LandCultivation::whereNull('end_date')->whereIn('type', ['borga', 'lease'])->whereHas('land')->count(),
            // shown (greyed) on the new-land form; the real number is taken when the land is saved
            'next_code' => ($seq = Sequence::where('key', 'land')->first()) ? SequenceService::preview($seq) : null,
        ]);
    }

    private function filtered(Request $request): Builder
    {
        $q = Land::query();
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('land_code', 'like', "%$en%")
                ->orWhere('dag_no', $en)->orWhere('khatian_no', $en)
                ->orWhereHas('owners.farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")->orWhere('farmer_code', $en)->orWhere('mobile', 'like', "%$en%")->orWhere('nid', $en))
                ->orWhereHas('cultivation.farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")->orWhere('farmer_code', $en)->orWhere('mobile', 'like', "%$en%")->orWhere('nid', $en)));
        }
        foreach (['mouza_id', 'land_type_id', 'irrigation_type_id', 'status', 'survey'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('upazila_id')) {
            $q->whereHas('mouza', fn ($m) => $m->where('upazila_id', $request->query('upazila_id')));
        }
        if ($request->filled('district_id')) {
            $q->whereHas('mouza.upazila', fn ($u) => $u->where('district_id', $request->integer('district_id')));
        }
        // single owner vs joint (two or more current owners)
        match ($request->query('ownership')) {
            'single' => $q->has('owners', '=', 1),
            'joint' => $q->has('owners', '>', 1),
            default => null,
        };
        // area range is asked in acres; plots are stored in decimals (100 per acre)
        if ($request->filled('area_min')) {
            $q->where('area_decimal', '>=', (float) Bn::toEnDigits((string) $request->query('area_min')) * 100);
        }
        if ($request->filled('area_max')) {
            $q->where('area_decimal', '<=', (float) Bn::toEnDigits((string) $request->query('area_max')) * 100);
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
            'irrigation_type_id' => ['nullable', Rule::exists('irrigation_types', 'id')],
            'status' => ['required', Rule::in(array_keys(Land::STATUSES))],
            'remarks' => ['nullable', 'string', 'max:2000'],
            // the village must be one the chosen mouza covers
            'village_id' => ['nullable', Rule::exists('mouza_village', 'village_id')->where('mouza_id', $request->integer('mouza_id'))],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'location_note' => ['nullable', 'string', 'max:300'],
            'irrigable_area' => ['nullable', 'numeric', 'min:0'],
        ], ['area.gt' => __('জমির পরিমাণ শূন্যের বেশি হতে হবে।'), 'village_id.exists' => __('গ্রামটি এই মৌজার মধ্যে নেই।')]);

        $data['area_decimal'] = AreaUnit::toDecimal((float) $data['area'], $data['area_unit']);
        // irrigable area is entered in the same unit as the total and cannot exceed it
        if (isset($data['irrigable_area'])) {
            $data['irrigable_decimal'] = min($data['area_decimal'], AreaUnit::toDecimal((float) $data['irrigable_area'], $data['area_unit']));
        } elseif ($request->has('irrigable_area')) {
            $data['irrigable_decimal'] = null;
        }
        unset($data['area'], $data['area_unit'], $data['irrigable_area']);

        return $data;
    }

    private function guardDuplicate(Request $request, array $data, ?int $ignoreId = null): void
    {
        $matches = $this->lands->similar($data['mouza_id'], $data['survey'], $data['khatian_no'], $data['dag_no'], $ignoreId);
        if ($matches->isNotEmpty() && ! $request->boolean('confirm_duplicate')) {
            abort(response()->json([
                'message' => __('একই মৌজা, খতিয়ান ও দাগে আগে থেকেই জমি আছে।'),
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
            'land_type' => Tr::label($l->landType?->name_bn),
            'irrigation_type_id' => $l->irrigation_type_id,
            'irrigation_type' => Tr::label($l->irrigationType?->name_bn),
            'status' => $l->status,
            'owners' => $l->owners->map(fn ($o) => [
                'id' => $o->id, 'farmer_id' => $o->farmer_id, 'farmer_code' => $o->farmer?->farmer_code,
                'name_bn' => $o->farmer?->name_bn, 'name_en' => $o->farmer?->name_en, 'father_name' => $o->farmer?->father_name,
                'photo_url' => $o->farmer?->photo ? url("api/farmers/{$o->farmer_id}/photo") : null,
                'share_percent' => (float) $o->share_percent, 'start_date' => $o->start_date?->toDateString(),
            ])->values(),
            'cultivation' => $l->cultivation ? [
                'id' => $l->cultivation->id, 'farmer_id' => $l->cultivation->farmer_id,
                'farmer_code' => $l->cultivation->farmer?->farmer_code, 'name_bn' => $l->cultivation->farmer?->name_bn, 'name_en' => $l->cultivation->farmer?->name_en,
                'father_name' => $l->cultivation->farmer?->father_name, 'type' => $l->cultivation->type,
                'terms' => $l->cultivation->terms, 'start_date' => $l->cultivation->start_date?->toDateString(),
                'photo_url' => $l->cultivation->farmer?->photo ? url("api/farmers/{$l->cultivation->farmer_id}/photo") : null,
            ] : null,
        ];
    }
}
