<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Farmer;
use App\Models\Land;
use App\Models\User;
use App\Support\Bn;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The land-management overview screens: who owns and farms land, borga/lease
 * arrangements, ownership transfers and the change log across all plots.
 */
class LandRegisterController extends Controller
{
    /** Current owner or cultivator rows joined to live lands and their farmers. */
    private function current(string $table): Builder
    {
        return DB::table($table)->join('lands', 'lands.id', '=', "$table.land_id")->join('farmers', 'farmers.id', '=', "$table.farmer_id")
            ->whereNull('lands.deleted_at')->whereNull("$table.end_date");
    }

    private function farmerSearch(Builder $q, Request $request): void
    {
        if ($s = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($s);
            $q->where(fn ($w) => $w->where('farmers.name_bn', 'like', "%$s%")->orWhere('farmers.name_en', 'like', "%$s%")
                ->orWhere('farmers.farmer_code', 'like', "%$en%")->orWhere('farmers.mobile', 'like', "%$en%")
                ->orWhere('lands.land_code', 'like', "%$en%")->orWhere('lands.dag_no', $en));
        }
        if ($request->filled('mouza_id')) {
            $q->where('lands.mouza_id', $request->integer('mouza_id'));
        }
    }

    /** Farmer details shown in every people table. */
    private function people(array $ids): array
    {
        return Farmer::withTrashed()->with(['member:id,farmer_id,member_no,status', 'mouza:id,name_bn'])->whereIn('id', $ids)->get()
            ->mapWithKeys(fn (Farmer $f) => [$f->id => [
                'id' => $f->id, 'farmer_code' => $f->farmer_code, 'name_bn' => $f->name_bn, 'name_en' => $f->name_en, 'father_name' => $f->father_name,
                'mobile' => $f->mobile, 'mouza' => $f->mouza?->name_bn, 'member_no' => $f->member?->member_no, 'member_status' => $f->member?->status,
                'photo_url' => $f->photo ? url("api/farmers/{$f->id}/photo") : null,
            ]])->all();
    }

    /** People who own or farm land now, one row per farmer with their totals. */
    public function parties(Request $request): JsonResponse
    {
        $request->validate(['role' => ['nullable', Rule::in(['owner', 'cultivator'])], 'type' => ['nullable', Rule::in(array_keys(Land::CULTIVATION_TYPES))],
            'membership' => ['nullable', Rule::in(['member', 'non_member'])]]);
        $role = $request->query('role', 'owner');
        $table = $role === 'owner' ? 'land_owners' : 'land_cultivations';

        $q = $this->current($table);
        $this->farmerSearch($q, $request);
        if ($role === 'cultivator' && $request->filled('type')) {
            $q->where('land_cultivations.type', $request->query('type'));
        }
        if ($request->filled('membership')) {
            $members = DB::table('members')->select('farmer_id');
            $request->query('membership') === 'member' ? $q->whereIn('farmers.id', $members) : $q->whereNotIn('farmers.id', $members);
        }
        $area = $role === 'owner' ? 'lands.area_decimal * land_owners.share_percent / 100' : 'lands.area_decimal';
        $page = $q->groupBy("$table.farmer_id")->orderByRaw('sum('.$area.') desc')->orderBy("$table.farmer_id")
            ->selectRaw("$table.farmer_id, count(*) as lands, sum($area) as area, min($table.start_date) as since")
            ->when($role === 'cultivator', fn ($x) => $x->selectRaw("sum(case when land_cultivations.type = 'own' then 1 else 0 end) as own_count,
                sum(case when land_cultivations.type <> 'own' then 1 else 0 end) as tenancy_count"))
            ->paginate($this->perPage($request));

        $ids = $page->getCollection()->pluck('farmer_id')->all();
        $people = $this->people($ids);
        // the other role, to show who both owns and farms
        $other = $this->current($role === 'owner' ? 'land_cultivations' : 'land_owners')->whereIn('farmers.id', $ids)->distinct()->pluck('farmers.id')->flip();
        $mouzas = $this->current($table)->join('mouzas', 'mouzas.id', '=', 'lands.mouza_id')->whereIn("$table.farmer_id", $ids)
            ->get(["$table.farmer_id", 'mouzas.name_bn'])->groupBy('farmer_id')->map(fn ($g) => $g->pluck('name_bn')->unique()->implode(', '));

        $page->setCollection($page->getCollection()->map(fn ($r) => ($people[$r->farmer_id] ?? []) + [
            'lands' => (int) $r->lands, 'area_decimal' => round((float) $r->area, 2), 'since' => $r->since,
            'land_mouzas' => $mouzas[$r->farmer_id] ?? null, 'also' => isset($other[$r->farmer_id]),
            'own_count' => (int) ($r->own_count ?? 0), 'tenancy_count' => (int) ($r->tenancy_count ?? 0),
        ]));

        return response()->json($page);
    }

    public function partiesSummary(): JsonResponse
    {
        $owners = $this->current('land_owners')->distinct()->pluck('farmers.id');
        $cultivators = $this->current('land_cultivations')->distinct()->pluck('farmers.id');
        $lands = DB::table('lands')->whereNull('deleted_at');

        return response()->json([
            'owners' => $owners->count(),
            'cultivators' => $cultivators->count(),
            'owner_cultivators' => $owners->intersect($cultivators)->count(),
            'tenants' => $this->current('land_cultivations')->where('land_cultivations.type', '!=', 'own')->distinct()->count('farmers.id'),
            'lands' => (clone $lands)->count(),
            'uncultivated' => (clone $lands)->whereNotIn('id', DB::table('land_cultivations')->whereNull('end_date')->select('land_id'))->count(),
        ]);
    }

    /**
     * Contract status of a borga/lease row: ended (farming stopped), expired
     * (still farming past the agreed end date) or active.
     */
    private function contractStatus(?string $end, ?string $contractEnd): string
    {
        return $end ? 'ended' : ($contractEnd && $contractEnd < now()->toDateString() ? 'expired' : 'active');
    }

    /** Borga and lease arrangements, current or ended. */
    public function cultivations(Request $request): JsonResponse
    {
        $request->validate(['type' => ['nullable', Rule::in(['borga', 'lease'])], 'status' => ['nullable', Rule::in(['current', 'ended', 'active', 'expired'])],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'owner_id' => ['nullable', 'integer'], 'cultivator_id' => ['nullable', 'integer'],
            'upazila_id' => ['nullable', 'integer'], 'district_id' => ['nullable', 'integer'], 'land_type_id' => ['nullable', 'integer']]);
        $q = DB::table('land_cultivations')->join('lands', 'lands.id', '=', 'land_cultivations.land_id')->join('farmers', 'farmers.id', '=', 'land_cultivations.farmer_id')
            ->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')->whereNull('lands.deleted_at')
            ->whereIn('land_cultivations.type', $request->filled('type') ? [$request->query('type')] : ['borga', 'lease']);
        // search: land no, dag, khatian, the cultivator (name, code, mobile) or a current owner's name
        if ($s = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($s);
            $q->where(fn ($w) => $w->where('lands.land_code', 'like', "%$en%")->orWhere('lands.dag_no', $en)->orWhere('lands.khatian_no', $en)
                ->orWhere('farmers.name_bn', 'like', "%$s%")->orWhere('farmers.name_en', 'like', "%$s%")
                ->orWhere('farmers.farmer_code', 'like', "%$en%")->orWhere('farmers.mobile', 'like', "%$en%")
                ->orWhereIn('lands.id', DB::table('land_owners')->join('farmers as of', 'of.id', '=', 'land_owners.farmer_id')->whereNull('land_owners.end_date')
                    ->where(fn ($n) => $n->where('of.name_bn', 'like', "%$s%")->orWhere('of.name_en', 'like', "%$s%"))->select('land_owners.land_id')));
        }
        if ($request->filled('mouza_id')) {
            $q->where('lands.mouza_id', $request->integer('mouza_id'));
        }
        $today = now()->toDateString();
        match ($request->query('status')) {
            'current' => $q->whereNull('land_cultivations.end_date'),
            'ended' => $q->whereNotNull('land_cultivations.end_date'),
            'active' => $q->whereNull('land_cultivations.end_date')->where(fn ($w) => $w->whereNull('land_cultivations.contract_end')->orWhere('land_cultivations.contract_end', '>=', $today)),
            'expired' => $q->whereNull('land_cultivations.end_date')->where('land_cultivations.contract_end', '<', $today),
            default => null,
        };
        if ($request->filled('cultivator_id')) {
            $q->where('land_cultivations.farmer_id', $request->integer('cultivator_id'));
        }
        if ($request->filled('owner_id')) {
            $q->whereIn('lands.id', DB::table('land_owners')->where('farmer_id', $request->integer('owner_id'))->whereNull('end_date')->select('land_id'));
        }
        if ($request->filled('land_type_id')) {
            $q->where('lands.land_type_id', $request->integer('land_type_id'));
        }
        if ($request->filled('upazila_id')) {
            $q->where('mouzas.upazila_id', $request->integer('upazila_id'));
        }
        if ($request->filled('district_id')) {
            $q->whereIn('mouzas.upazila_id', DB::table('upazilas')->where('district_id', $request->integer('district_id'))->select('id'));
        }
        if ($request->filled('from')) {
            $q->where('land_cultivations.start_date', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('land_cultivations.start_date', '<=', $request->date('to')->toDateString());
        }
        $page = $q->orderByRaw('land_cultivations.end_date is not null')->orderByDesc('land_cultivations.start_date')->orderByDesc('land_cultivations.id')
            ->select('land_cultivations.*', 'lands.land_code', 'lands.dag_no', 'lands.khatian_no', 'lands.area_decimal', 'mouzas.name_bn as mouza')
            ->paginate($this->perPage($request));

        $ownerRows = DB::table('land_owners')->whereIn('land_id', $page->getCollection()->pluck('land_id'))->whereNull('end_date')
            ->orderByDesc('share_percent')->get(['land_id', 'farmer_id', 'share_percent']);
        $people = $this->people($page->getCollection()->pluck('farmer_id')->merge($ownerRows->pluck('farmer_id'))->unique()->all());
        $owners = $ownerRows->groupBy('land_id');
        $page->setCollection($page->getCollection()->map(fn ($r) => [
            'id' => $r->id, 'land_id' => $r->land_id, 'land_code' => $r->land_code, 'dag_no' => $r->dag_no, 'khatian_no' => $r->khatian_no,
            'area_decimal' => (float) $r->area_decimal, 'mouza' => $r->mouza, 'type' => $r->type, 'terms' => $r->terms, 'remarks' => $r->remarks,
            'share_percent' => $r->share_percent !== null ? (float) $r->share_percent : null,
            'start_date' => $r->start_date, 'contract_end' => $r->contract_end, 'end_date' => $r->end_date,
            'status' => $this->contractStatus($r->end_date, $r->contract_end),
            'cultivator' => $people[$r->farmer_id] ?? null,
            'owners' => collect($owners[$r->land_id] ?? [])->map(fn ($o) => ($people[$o->farmer_id] ?? ['id' => $o->farmer_id]) + ['share_percent' => (float) $o->share_percent])->values(),
        ]));

        return response()->json($page);
    }

    public function cultivationsSummary(): JsonResponse
    {
        $current = $this->current('land_cultivations');
        $yearStart = now()->startOfYear()->toDateString();

        $tenancy = (clone $current)->where('land_cultivations.type', '!=', 'own');
        $today = now()->toDateString();

        return response()->json([
            'borga' => (clone $current)->where('land_cultivations.type', 'borga')->count(),
            'lease' => (clone $current)->where('land_cultivations.type', 'lease')->count(),
            'area_decimal' => round((float) (clone $tenancy)->sum('lands.area_decimal'), 2),
            'ended_this_year' => DB::table('land_cultivations')->whereIn('type', ['borga', 'lease'])->where('end_date', '>=', $yearStart)->count(),
            // every borga/lease record ever, and the farmers who farm on those terms now
            'records' => DB::table('land_cultivations')->join('lands', 'lands.id', '=', 'land_cultivations.land_id')->whereNull('lands.deleted_at')
                ->whereIn('land_cultivations.type', ['borga', 'lease'])->count(),
            'farmers' => (clone $tenancy)->distinct()->count('land_cultivations.farmer_id'),
            'active' => (clone $tenancy)->where(fn ($w) => $w->whereNull('land_cultivations.contract_end')->orWhere('land_cultivations.contract_end', '>=', $today))->count(),
            'expired' => (clone $tenancy)->where('land_cultivations.contract_end', '<', $today)->count(),
            // for the owner / cultivator filters
            'owners' => DB::table('land_owners')->join('farmers', 'farmers.id', '=', 'land_owners.farmer_id')->whereNull('land_owners.end_date')
                ->whereIn('land_owners.land_id', (clone $tenancy)->select('lands.id'))->distinct()->orderBy('farmers.name_bn')->get(['farmers.id', 'farmers.name_bn', 'farmers.name_en']),
            'cultivators' => DB::table('farmers')->whereIn('id', DB::table('land_cultivations')->whereIn('type', ['borga', 'lease'])->select('farmer_id'))
                ->orderBy('name_bn')->get(['id', 'name_bn', 'name_en']),
        ]);
    }

    /**
     * Ownership transfers: every date on which a plot's owners changed (the
     * old owners' period ends on the day the new owners' period starts).
     */
    public function transfers(Request $request): JsonResponse
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $q = DB::table('land_owners')->join('lands', 'lands.id', '=', 'land_owners.land_id')->join('farmers', 'farmers.id', '=', 'land_owners.farmer_id')
            ->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')->whereNull('lands.deleted_at')
            ->whereExists(fn ($e) => $e->from('land_owners as prev')->whereColumn('prev.land_id', 'land_owners.land_id')->whereColumn('prev.end_date', 'land_owners.start_date'));
        $this->farmerSearch($q, $request);
        if ($request->filled('from')) {
            $q->where('land_owners.start_date', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('land_owners.start_date', '<=', $request->date('to')->toDateString());
        }
        $page = $q->groupBy('land_owners.land_id', 'land_owners.start_date', 'lands.land_code', 'lands.dag_no', 'lands.area_decimal', 'mouzas.name_bn')
            ->orderByDesc('land_owners.start_date')->orderByDesc('land_owners.land_id')
            ->selectRaw('land_owners.land_id, land_owners.start_date as date, lands.land_code, lands.dag_no, lands.area_decimal, mouzas.name_bn as mouza')
            ->paginate($this->perPage($request));

        // who handed over and who received, for the rows on this page
        $landIds = $page->getCollection()->pluck('land_id')->unique();
        $rows = DB::table('land_owners')->join('farmers', 'farmers.id', '=', 'land_owners.farmer_id')->whereIn('land_owners.land_id', $landIds)
            ->get(['land_owners.land_id', 'land_owners.start_date', 'land_owners.end_date', 'land_owners.share_percent', 'land_owners.remarks', 'farmers.id', 'farmers.name_bn', 'farmers.farmer_code']);
        $party = fn ($o) => ['id' => $o->id, 'name_bn' => $o->name_bn, 'farmer_code' => $o->farmer_code, 'share_percent' => (float) $o->share_percent];
        $page->setCollection($page->getCollection()->map(function ($t) use ($rows, $party) {
            $to = $rows->where('land_id', $t->land_id)->filter(fn ($o) => (string) $o->start_date === (string) $t->date);

            return [
                'key' => $t->land_id.'-'.$t->date, 'land_id' => $t->land_id, 'date' => $t->date, 'land_code' => $t->land_code, 'dag_no' => $t->dag_no,
                'mouza' => $t->mouza, 'area_decimal' => (float) $t->area_decimal,
                'from' => $rows->where('land_id', $t->land_id)->filter(fn ($o) => (string) $o->end_date === (string) $t->date)->map($party)->values(),
                'to' => $to->map($party)->values(),
                'remarks' => $to->pluck('remarks')->filter()->first(),
            ];
        }));

        return response()->json($page);
    }

    public function transfersSummary(): JsonResponse
    {
        $events = DB::table('land_owners')->join('lands', 'lands.id', '=', 'land_owners.land_id')->whereNull('lands.deleted_at')
            ->whereExists(fn ($e) => $e->from('land_owners as prev')->whereColumn('prev.land_id', 'land_owners.land_id')->whereColumn('prev.end_date', 'land_owners.start_date'))
            ->select('land_owners.land_id', 'land_owners.start_date', 'lands.area_decimal')->distinct()->get();
        $year = $events->filter(fn ($e) => (string) $e->start_date >= now()->startOfYear()->toDateString());

        return response()->json([
            'total' => $events->count(),
            'this_year' => $year->count(),
            'this_month' => $events->filter(fn ($e) => (string) $e->start_date >= now()->startOfMonth()->toDateString())->count(),
            'area_this_year' => round((float) $year->sum('area_decimal'), 2),
        ]);
    }

    /** Headline figures for the land reports page, with area split by status, mouza and land type. */
    public function overview(): JsonResponse
    {
        $lands = DB::table('lands')->whereNull('lands.deleted_at');

        return response()->json([
            'lands' => (clone $lands)->count(),
            'area_decimal' => round((float) (clone $lands)->sum('area_decimal'), 2),
            'by_status' => (clone $lands)->groupBy('status')->selectRaw('status, count(*) as lands, sum(area_decimal) as area')->get()
                ->map(fn ($r) => ['status' => $r->status, 'lands' => (int) $r->lands, 'area_decimal' => round((float) $r->area, 2)]),
            'tenancy' => $this->current('land_cultivations')->where('land_cultivations.type', '!=', 'own')->count(),
            'by_mouza' => (clone $lands)->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')->groupBy('mouzas.id', 'mouzas.name_bn')
                ->selectRaw('mouzas.id, mouzas.name_bn, count(*) as lands, sum(lands.area_decimal) as area')->orderByDesc('area')->get()
                ->map(fn ($r) => ['id' => $r->id, 'name' => $r->name_bn, 'lands' => (int) $r->lands, 'area_decimal' => round((float) $r->area, 2)]),
            'by_type' => (clone $lands)->leftJoin('land_types', 'land_types.id', '=', 'lands.land_type_id')->groupBy('land_types.id', 'land_types.name_bn')
                ->selectRaw('land_types.id, land_types.name_bn, count(*) as lands, sum(lands.area_decimal) as area')->orderByDesc('area')->get()
                ->map(fn ($r) => ['id' => $r->id, 'name' => $r->name_bn ? __($r->name_bn) : __('ধরন নেই'), 'lands' => (int) $r->lands, 'area_decimal' => round((float) $r->area, 2)]),
        ]);
    }

    /** Every change to land records, newest first. */
    public function history(Request $request): JsonResponse
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'user_id' => ['nullable', 'integer']]);
        $q = $this->historyQuery();
        if ($request->filled('action')) {
            $q->where('action', $request->query('action'));
        }
        if ($request->filled('user_id')) {
            $q->where('user_id', $request->integer('user_id'));
        }
        if ($request->filled('from')) {
            $q->where('created_at', '>=', $request->date('from')->startOfDay());
        }
        if ($request->filled('to')) {
            $q->where('created_at', '<=', $request->date('to')->endOfDay());
        }
        if ($s = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($s);
            $landIds = Land::withTrashed()->where('land_code', 'like', "%$en%")->orWhere('dag_no', $en)->pluck('id');
            $q->where(fn ($w) => $w->where(fn ($l) => $l->where('auditable_type', 'Land')->whereIn('auditable_id', $landIds))
                ->orWhere(fn ($d) => $d->where('auditable_type', 'LandDocument')->whereIn('auditable_id', DB::table('land_documents')->whereIn('land_id', $landIds)->select('id')))
                ->orWhere(fn ($n) => $n->where('auditable_type', 'LandNote')->whereIn('auditable_id', DB::table('land_notes')->whereIn('land_id', $landIds)->select('id'))));
        }
        $page = $q->with('user:id,name_bn,name_en')->latest('id')->paginate($this->perPage($request));

        // documents and notes point at their own rows; find the plot they belong to (deleted rows keep it in the logged values)
        $landOf = [];
        foreach (['LandDocument' => 'land_documents', 'LandNote' => 'land_notes'] as $type => $table) {
            $ids = $page->getCollection()->where('auditable_type', $type)->pluck('auditable_id');
            $landOf[$type] = DB::table($table)->whereIn('id', $ids)->pluck('land_id', 'id');
        }
        $landIds = $page->getCollection()->map(fn (AuditLog $l) => $l->auditable_type === 'Land' ? $l->auditable_id
            : ($landOf[$l->auditable_type][$l->auditable_id] ?? ($l->old_values['land_id'] ?? $l->new_values['land_id'] ?? null)))->all();
        $codes = Land::withTrashed()->whereIn('id', array_filter($landIds))->pluck('land_code', 'id');

        $page->setCollection($page->getCollection()->values()->map(fn (AuditLog $l, $i) => [
            'id' => $l->id, 'created_at' => $l->created_at, 'action' => $l->action, 'type' => $l->auditable_type, 'description' => $l->description,
            'user' => $l->user ? ['id' => $l->user->id, 'name_bn' => $l->user->name_bn, 'name_en' => $l->user->name_en] : null,
            'land_id' => $landIds[$i], 'land_code' => $codes[$landIds[$i]] ?? null,
            'old_values' => $l->old_values, 'new_values' => $l->new_values,
        ]));

        return response()->json($page);
    }

    public function historySummary(): JsonResponse
    {
        $q = $this->historyQuery();

        return response()->json([
            'total' => (clone $q)->count(),
            'today' => (clone $q)->where('created_at', '>=', now()->startOfDay())->count(),
            'this_month' => (clone $q)->where('created_at', '>=', now()->startOfMonth())->count(),
            'transfers' => (clone $q)->where('action', 'ownership_transfer')->count(),
            'actions' => (clone $q)->distinct()->orderBy('action')->pluck('action'),
            'users' => User::withTrashed()->whereIn('id', (clone $q)->whereNotNull('user_id')->distinct()->pluck('user_id'))->get(['id', 'name_bn', 'name_en']),
        ]);
    }

    private function historyQuery()
    {
        return AuditLog::query()->where('module', 'land')->whereIn('auditable_type', ['Land', 'LandDocument', 'LandNote']);
    }
}
