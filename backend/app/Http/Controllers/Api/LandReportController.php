<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ExportLog;
use App\Models\Land;
use App\Services\ReportService;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The land reports page: headline figures and three charts for the chosen
 * area and period, and the list of land reports people have generated
 * (taken from the export log, which records every report saved or printed).
 */
class LandReportController extends Controller
{
    /** Report type on the page → the server report that produces it. */
    public const TYPES = [
        'summary' => ['key' => 'land_by_mouza', 'label' => 'সারসংক্ষেপ', 'title' => 'জমির সারসংক্ষেপ রিপোর্ট'],
        'type' => ['key' => 'land_by_type', 'label' => 'ধরনভিত্তিক', 'title' => 'ধরনভিত্তিক জমি রিপোর্ট'],
        'ownership' => ['key' => 'land_owners', 'label' => 'মালিকানা', 'title' => 'মালিকানা রিপোর্ট'],
        'cultivation' => ['key' => 'land_cultivators', 'label' => 'চাষাবাদ', 'title' => 'চাষাবাদ রিপোর্ট'],
        'borga' => ['key' => 'borga', 'label' => 'বর্গা', 'title' => 'বর্গা / লিজ চাষ রিপোর্ট'],
        'transfer' => ['key' => 'land_history', 'label' => 'হস্তান্তর', 'title' => 'জমি হস্তান্তর রিপোর্ট'],
        'irrigation' => ['key' => 'invoices', 'label' => 'সেচ', 'title' => 'সেচ রিপোর্ট'],
        'detailed' => ['key' => 'lands', 'label' => 'বিস্তারিত', 'title' => 'বিস্তারিত জমি রিপোর্ট'],
    ];

    public function __construct(private ReportService $reports) {}

    public function meta(Request $request): JsonResponse
    {
        $user = $request->user();
        $types = collect(self::TYPES)->filter(fn ($t) => $this->reports->allowedFor($user, $t['key']))
            ->map(fn ($t, $k) => ['value' => $k, 'key' => $t['key'], 'label' => __($t['label']), 'title' => __($t['title'])])->values();

        return response()->json(['types' => $types]);
    }

    public function summary(Request $request): JsonResponse
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $lands = fn () => $this->lands($request);
        $landIds = $lands()->select('lands.id');

        $area = (float) $lands()->sum('lands.area_decimal');
        $owners = DB::table('land_owners')->whereIn('land_id', $landIds)->whereNull('end_date')->distinct()->count('farmer_id');
        $cultivated = (float) $lands()->where('lands.status', 'cultivated')->sum('lands.area_decimal');
        $transferred = (float) DB::table('land_transfers')->join('lands', 'lands.id', '=', 'land_transfers.land_id')->where('land_transfers.status', 'approved')
            ->whereIn('land_transfers.land_id', $landIds)
            ->when($request->filled('from'), fn ($q) => $q->where('land_transfers.transfer_date', '>=', $request->date('from')->toDateString()))
            ->when($request->filled('to'), fn ($q) => $q->where('land_transfers.transfer_date', '<=', $request->date('to')->toDateString()))
            ->sum(DB::raw('lands.area_decimal * land_transfers.share_percent / 100'));
        $irrigated = (float) $lands()->whereIn('lands.id', DB::table('invoices')->whereNull('cancelled_at')->whereNotNull('land_id')
            ->when($request->filled('from'), fn ($q) => $q->where('invoice_date', '>=', $request->date('from')->toDateString()))
            ->when($request->filled('to'), fn ($q) => $q->where('invoice_date', '<=', $request->date('to')->toDateString()))
            ->select('land_id'))->sum('lands.area_decimal');

        $byType = $lands()->leftJoin('land_types', 'land_types.id', '=', 'lands.land_type_id')
            ->groupBy('land_types.id', 'land_types.name_bn')->orderByDesc(DB::raw('sum(lands.area_decimal)'))
            ->selectRaw('land_types.id, land_types.name_bn, count(*) as lands, sum(lands.area_decimal) as area')->get()
            ->map(fn ($r) => ['id' => $r->id, 'name' => $r->name_bn ? Tr::label($r->name_bn) : __('ধরন নেই'), 'lands' => (int) $r->lands, 'area_decimal' => round((float) $r->area, 2)]);

        // a plot with more than one current owner is jointly owned
        $ownerCount = DB::table('land_owners')->whereNull('end_date')->groupBy('land_id')->selectRaw('land_id, count(*) as n');
        $ownership = $lands()->leftJoinSub($ownerCount, 'oc', 'oc.land_id', '=', 'lands.id')
            ->selectRaw("case when oc.n > 1 then 'joint' when oc.n = 1 then 'single' else 'none' end as kind, count(*) as lands, sum(lands.area_decimal) as area")
            ->groupBy('kind')->get()
            ->map(fn ($r) => ['key' => $r->kind, 'label' => __(['single' => 'একক মালিকানা', 'joint' => 'যৌথ মালিকানা', 'none' => 'মালিক নেই'][$r->kind]),
                'lands' => (int) $r->lands, 'area_decimal' => round((float) $r->area, 2)])->sortByDesc('area_decimal')->values();

        $byStatus = $lands()->groupBy('lands.status')->selectRaw('lands.status, count(*) as lands, sum(lands.area_decimal) as area')->get()
            ->map(fn ($r) => ['key' => $r->status, 'label' => __(Land::STATUSES[$r->status] ?? $r->status), 'lands' => (int) $r->lands, 'area_decimal' => round((float) $r->area, 2)])
            ->sortByDesc('area_decimal')->values();

        return response()->json([
            'lands' => $lands()->count(),
            'area_decimal' => round($area, 2),
            'owners' => $owners,
            'cultivated_decimal' => round($cultivated, 2),
            'transferred_decimal' => round($transferred, 2),
            'irrigated_decimal' => round($irrigated, 2),
            'by_type' => $byType,
            'ownership' => $ownership,
            'by_status' => $byStatus,
        ]);
    }

    /** Land reports generated so far — saved as Excel/CSV or printed — newest first. */
    public function generated(Request $request): JsonResponse
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $keys = collect(self::TYPES)->pluck('key')->all();
        $typeOf = collect(self::TYPES)->mapWithKeys(fn ($t, $k) => [$t['key'] => $k])->all();
        $q = ExportLog::with('user:id,name_bn,name_en')->whereIn('report_key', $keys)->whereNull('dismissed_at')->latest('id');
        if ($request->filled('type') && isset(self::TYPES[$request->query('type')])) {
            $q->where('report_key', self::TYPES[$request->query('type')]['key']);
        }
        if ($request->filled('from')) {
            $q->where('created_at', '>=', $request->date('from')->startOfDay());
        }
        if ($request->filled('to')) {
            $q->where('created_at', '<=', $request->date('to')->endOfDay());
        }
        $mouzas = DB::table('mouzas')->pluck('name_bn', 'id');
        // a report made for one mouza shows under that mouza's area too
        if ($request->filled('mouza_id')) {
            $q->where(fn ($w) => $w->where('filters->mouza_id', $request->integer('mouza_id'))->orWhere('filters->mouza_id', (string) $request->integer('mouza_id')));
        }

        $page = $q->paginate($this->perPage($request))->through(function (ExportLog $l) use ($typeOf, $mouzas) {
            $f = $l->filters ?? [];
            $type = $typeOf[$l->report_key] ?? null;

            return [
                'id' => $l->id,
                'type' => $type,
                'report_key' => $l->report_key,
                'title' => $type ? __(self::TYPES[$type]['title']) : $l->title,
                'type_label' => $type ? __(self::TYPES[$type]['label']) : null,
                'generated_for' => ! empty($f['mouza_id']) ? ($mouzas[$f['mouza_id']] ?? '—') : __('সব মৌজা'),
                'from' => $f['from'] ?? null,
                'to' => $f['to'] ?? null,
                'filters' => $f,
                'format' => $l->format,
                'rows' => (int) $l->row_count,
                'created_at' => $l->created_at,
                'user' => $l->user ? ['id' => $l->user->id, 'name_bn' => $l->user->name_bn, 'name_en' => $l->user->name_en] : null,
                'can_remove' => $l->user_id === request()->user()->id || request()->user()->hasRole('super_admin'),
            ];
        });

        return response()->json($page);
    }

    /** Take a report off the list; the export log keeps it. */
    public function dismiss(Request $request, ExportLog $exportLog): JsonResponse
    {
        abort_unless(in_array($exportLog->report_key, collect(self::TYPES)->pluck('key')->all(), true), 404);
        abort_unless($exportLog->user_id === $request->user()->id || $request->user()->hasRole('super_admin'), 403, __('শুধু যিনি রিপোর্ট তৈরি করেছেন তিনি এটি সরাতে পারেন।'));
        $exportLog->update(['dismissed_at' => now()]);

        return response()->json(['message' => __('রিপোর্ট তালিকা থেকে সরানো হয়েছে।')]);
    }

    private function lands(Request $request)
    {
        return DB::table('lands')->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')->whereNull('lands.deleted_at')
            ->when($request->filled('mouza_id'), fn ($q) => $q->where('lands.mouza_id', $request->integer('mouza_id')))
            ->when($request->filled('upazila_id'), fn ($q) => $q->where('mouzas.upazila_id', $request->integer('upazila_id')))
            ->when($request->filled('district_id'), fn ($q) => $q->whereIn('mouzas.upazila_id', DB::table('upazilas')->where('district_id', $request->integer('district_id'))->select('id')));
    }
}
