<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Models\Land;
use App\Models\Mouza;
use App\Models\Patwari;
use App\Models\PatwariMouzaAssignment;
use App\Models\Union;
use App\Support\Bn;
use App\Support\CsvExport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MouzaController extends Controller
{
    public function index(Request $request)
    {
        $q = Mouza::query()->with(['union:id,name_bn,upazila_id', 'upazila:id,name_bn', 'villages:id,name_bn']);

        if ($search = $request->query('search')) {
            $q->where(fn ($w) => $w->where('name_bn', 'like', "%$search%")
                ->orWhere('name_en', 'like', "%$search%")
                ->orWhere('jl_no', 'like', "%$search%"));
        }
        foreach (['union_id', 'upazila_id'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('village_id')) {
            $q->whereHas('villages', fn ($w) => $w->where('villages.id', $request->query('village_id')));
        }
        if ($request->filled('is_active')) {
            $q->where('is_active', $request->boolean('is_active'));
        }
        if ($request->filled('district_id')) {
            $q->whereHas('upazila', fn ($u) => $u->where('district_id', $request->integer('district_id')));
        }
        if ($request->filled('patwari_id')) {
            $q->whereIn('id', PatwariMouzaAssignment::where('patwari_id', $request->integer('patwari_id'))->whereNull('end_date')->select('mouza_id'));
        }

        // Lightweight list for dropdowns.
        if ($request->boolean('all')) {
            return response()->json($q->where('is_active', true)->orderBy('name_bn')->get(['id', 'name_bn', 'jl_no', 'union_id', 'upazila_id']));
        }

        // The management list: who looks after each mouza, and how many farmers and lands it holds.
        $q->with('upazila.district:id,name_bn')
            ->withCount(['farmers' => fn ($f) => $f->whereNull('merged_into_id'), 'lands'])
            ->withSum('lands as land_decimal', 'area_decimal')
            ->orderByRaw('CAST(jl_no AS UNSIGNED)')->orderBy('name_bn');
        $patwaris = fn ($ids) => PatwariMouzaAssignment::whereIn('mouza_id', $ids)->whereNull('end_date')
            ->join('patwaris', 'patwaris.id', '=', 'patwari_mouza_assignments.patwari_id')->orderBy('patwaris.name')
            ->get(['mouza_id', 'patwaris.name'])->groupBy('mouza_id')->map(fn ($g) => $g->pluck('name')->implode(', '));
        $row = fn (Mouza $m, $names) => $m->toArray() + [
            'district' => $m->upazila?->district?->name_bn,
            'patwari' => $names[$m->id] ?? null,
            'land_acre' => round((float) $m->land_decimal / 100, 2),
        ];

        if ($request->query('export') === 'csv') {
            $all = $q->get();
            $names = $patwaris($all->pluck('id'));

            return CsvExport::download('mouzas.csv',
                [__('মৌজা কোড'), __('মৌজা'), __('জেলা'), __('উপজেলা'), __('পাটোয়ারী'), __('মোট কৃষক'), __('মোট জমির রেকর্ড'), __('মোট জমির পরিমাণ (একর)'), __('অবস্থা')],
                $all->map(fn (Mouza $m) => [$m->jl_no, $m->name_bn, $m->upazila?->district?->name_bn, $m->upazila?->name_bn, $names[$m->id] ?? '',
                    $m->farmers_count, $m->lands_count, round((float) $m->land_decimal / 100, 2), $m->is_active ? __('সক্রিয়') : __('নিষ্ক্রিয়')]));
        }

        $page = $q->paginate($this->perPage($request));
        $names = $patwaris($page->getCollection()->pluck('id'));

        return response()->json($page->through(fn (Mouza $m) => $row($m, $names)));
    }

    /** Header figures, and the districts/upazilas/patwaris present (for the filters). */
    public function summary(): JsonResponse
    {
        $upazilas = DB::table('upazilas')->whereIn('id', Mouza::query()->select('upazila_id'))->orderBy('name_bn')->get(['id', 'name_bn', 'district_id']);

        return response()->json([
            'mouzas' => Mouza::count(),
            'farmers' => Farmer::whereNotNull('mouza_id')->whereNull('merged_into_id')->count(),
            'lands' => Land::count(),
            'land_acre' => round((float) Land::sum('area_decimal') / 100, 2),
            'districts' => DB::table('districts')->whereIn('id', $upazilas->pluck('district_id'))->orderBy('name_bn')->get(['id', 'name_bn']),
            'upazilas' => $upazilas,
            'patwaris' => Patwari::orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function show(Mouza $mouza): JsonResponse
    {
        return response()->json($mouza->load(['union.upazila.district.division', 'villages:id,name_bn'])->toArray() + [
            // who currently keeps this mouza's land records
            'patwaris' => Patwari::whereIn('id', PatwariMouzaAssignment::where('mouza_id', $mouza->id)->whereNull('end_date')->select('patwari_id'))
                ->orderBy('name')->get(['id', 'name', 'mobile']),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        [$data, $villages] = $this->validated($request);

        $mouza = DB::transaction(function () use ($data, $villages) {
            $mouza = Mouza::create($data);
            $mouza->villages()->sync($villages);

            return $mouza;
        });

        return response()->json($mouza->load('villages:id,name_bn'), 201);
    }

    public function update(Request $request, Mouza $mouza): JsonResponse
    {
        [$data, $villages] = $this->validated($request, $mouza);

        DB::transaction(function () use ($mouza, $data, $villages) {
            $mouza->update($data);
            $mouza->villages()->sync($villages);
        });

        return response()->json($mouza->fresh('villages:id,name_bn'));
    }

    private function validated(Request $request, ?Mouza $mouza = null): array
    {
        $request->merge(['jl_no' => Bn::toEnDigits($request->input('jl_no'))]);
        $union = Union::find($request->input('union_id'));

        $data = $request->validate([
            'union_id' => ['required', 'exists:unions,id'],
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'jl_no' => ['required', 'string', 'max:20',
                Rule::unique('mouzas')->where('upazila_id', $union?->upazila_id)->ignore($mouza)],
            'village_ids' => ['array'],
            'village_ids.*' => [Rule::exists('villages', 'id')->where('union_id', $union?->id)],
            'is_active' => ['boolean'],
        ], ['jl_no.unique' => __('এই উপজেলায় একই JL নম্বরের মৌজা আগে থেকেই আছে।')]);

        $villages = $data['village_ids'] ?? [];
        unset($data['village_ids']);
        $data['upazila_id'] = $union->upazila_id;

        return [$data, $villages];
    }
}
