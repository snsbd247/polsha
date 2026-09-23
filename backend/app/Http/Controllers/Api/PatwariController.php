<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Patwari;
use App\Models\PatwariMouzaAssignment;
use App\Services\AuditLogger;
use App\Support\Bn;
use App\Support\CsvExport;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PatwariController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        // Lands a patwari is responsible for = live lands in their current mouzas.
        $landsCount = DB::table('lands')->whereNull('lands.deleted_at')
            ->whereIn('lands.mouza_id', DB::table('patwari_mouza_assignments')->whereColumn('patwari_id', 'patwaris.id')->whereNull('end_date')->select('mouza_id'))
            ->selectRaw('count(*)');

        return response()->json($this->filtered($request)
            ->with(['currentAssignments.mouza:id,name_bn,jl_no', 'farmer:id,farmer_code,name_bn'])
            ->select('patwaris.*')->selectSub($landsCount, 'lands_count')
            ->orderBy('name')->paginate($this->perPage($request)));
    }

    public function export(Request $request)
    {
        $rows = $this->filtered($request)->with('currentAssignments.mouza:id,name_bn')->orderBy('name')->get()
            ->map(fn (Patwari $p) => [$p->name, $p->father_name, $p->mobile, $p->nid,
                $p->currentAssignments->pluck('mouza.name_bn')->implode(', '), $p->is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়']);

        return CsvExport::download('patwaris.csv', ['নাম', 'পিতা', 'মোবাইল', 'NID', 'দায়িত্বাধীন মৌজা', 'অবস্থা'], $rows);
    }

    public function show(Patwari $patwari): JsonResponse
    {
        return response()->json($patwari->load(['assignments.mouza:id,name_bn,jl_no', 'farmer:id,farmer_code,name_bn']));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);

        $patwari = DB::transaction(function () use ($data) {
            $p = Patwari::create(collect($data)->except(['mouza_ids', 'start_date'])->all());
            foreach ($data['mouza_ids'] as $mouzaId) {
                $p->assignments()->create(['mouza_id' => $mouzaId, 'start_date' => $data['start_date']]);
            }

            return $p;
        });

        return response()->json($patwari->load('currentAssignments.mouza:id,name_bn'), 201);
    }

    /**
     * Mouzas removed from the selection get their assignment closed (end_date)
     * rather than deleted, so responsibility history is kept.
     */
    public function update(Request $request, Patwari $patwari): JsonResponse
    {
        $data = $this->validated($request);

        DB::transaction(function () use ($patwari, $data) {
            $patwari->update(collect($data)->except(['mouza_ids', 'start_date'])->all());

            $current = $patwari->currentAssignments()->pluck('mouza_id')->all();
            $removed = array_diff($current, $data['mouza_ids']);
            $added = array_diff($data['mouza_ids'], $current);

            PatwariMouzaAssignment::where('patwari_id', $patwari->id)->whereNull('end_date')
                ->whereIn('mouza_id', $removed)->update(['end_date' => $data['start_date']]);
            foreach ($added as $mouzaId) {
                $patwari->assignments()->create(['mouza_id' => $mouzaId, 'start_date' => $data['start_date']]);
            }
            if ($removed || $added) {
                AuditLogger::log('patwari', 'mouza_change', $patwari, ['mouza_ids' => array_values($removed)], ['mouza_ids' => array_values($added)]);
            }
        });

        return response()->json($patwari->fresh(['currentAssignments.mouza:id,name_bn']));
    }

    private function filtered(Request $request): Builder
    {
        $q = Patwari::query();
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('name', 'like', "%$search%")->orWhere('mobile', 'like', "%$en%"));
        }
        if ($request->filled('mouza_id')) {
            $q->whereHas('currentAssignments', fn ($a) => $a->where('mouza_id', $request->query('mouza_id')));
        }
        if ($request->filled('is_active')) {
            $q->where('is_active', $request->boolean('is_active'));
        }

        return $q;
    }

    private function validated(Request $request): array
    {
        $request->merge(['mobile' => Bn::toEnDigits($request->input('mobile')), 'nid' => Bn::toEnDigits($request->input('nid')) ?: null]);

        return $request->validate([
            'name' => ['required', 'string', 'max:150'],
            'father_name' => ['required', 'string', 'max:150'],
            'mobile' => ['required', 'regex:/^01[3-9]\d{8}$/'],
            'nid' => ['nullable', 'regex:/^(\d{10}|\d{13}|\d{17})$/'],
            'farmer_id' => ['nullable', 'exists:farmers,id'],
            'mouza_ids' => ['required', 'array', 'min:1'],
            'mouza_ids.*' => ['integer', 'exists:mouzas,id'],
            'start_date' => ['required', 'date'],
            'is_active' => ['boolean'],
        ], ['mouza_ids.required' => 'কমপক্ষে একটি মৌজা দিন।', 'mobile.regex' => 'সঠিক মোবাইল নম্বর দিন।']);
    }
}
