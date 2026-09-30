<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Asset;
use App\Models\AssetCategory;
use App\Models\AssetDepreciation;
use App\Models\AssetMaintenance;
use App\Models\AssetMovement;
use App\Models\Receipt;
use App\Services\AssetService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AssetController extends Controller
{
    public function __construct(private AssetService $assets) {}

    public function meta(): JsonResponse
    {
        return response()->json([
            'statuses' => Tr::map(Asset::STATUSES), 'conditions' => Tr::map(Asset::CONDITIONS), 'acquisitions' => Tr::map(Asset::ACQUISITIONS),
            'movement_types' => Tr::map(AssetMovement::TYPES), 'maintenance_kinds' => Tr::map(AssetMaintenance::KINDS),
            'maintenance_statuses' => Tr::map(AssetMaintenance::STATUSES), 'methods' => Tr::map(Receipt::METHODS),
            'categories' => AssetCategory::orderBy('code')->get(),
        ]);
    }

    /** The asset register (with totals); ?export=csv for the spreadsheet. */
    public function index(Request $request)
    {
        $q = $this->filtered($request);
        if ($request->query('export') === 'csv') {
            $statuses = Tr::map(Asset::STATUSES);
            $conditions = Tr::map(Asset::CONDITIONS);

            return CsvExport::download('asset-register-'.now()->format('Ymd').'.csv',
                [__('সম্পদ কোড'), __('নাম'), __('শ্রেণি'), __('ক্রয়ের তারিখ'), __('ক্রয়মূল্য'), __('অবশিষ্ট মূল্য'), __('আয়ুষ্কাল (মাস)'),
                    __('পুঞ্জীভূত অবচয়'), __('বর্তমান মূল্য'), __('অবস্থান'), __('দায়িত্বপ্রাপ্ত'), __('অবস্থা'), __('স্ট্যাটাস')],
                $q->with('category')->orderBy('asset_code')->lazy()->map(fn (Asset $a) => [$a->asset_code, $a->name_bn, $a->category?->name_bn,
                    $a->purchase_date, $a->cost, $a->salvage_value, $a->life_months, $a->accumulated_depreciation, $a->book_value,
                    $a->location, $a->custodian, $conditions[$a->condition] ?? $a->condition, $statuses[$a->status] ?? $a->status]));
        }
        $totals = (clone $q)->reorder()->whereNotIn('status', Asset::GONE)
            ->selectRaw('COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(accumulated_depreciation),0) acc')->first();

        return response()->json($q->with(['category:id,code,name_bn,name_en', 'mouza:id,name_bn,name_en'])->orderByDesc('id')
            ->paginate($this->perPage($request))->toArray() + ['totals' => [
                'count' => (int) $totals->n, 'cost' => round((float) $totals->cost, 2), 'accumulated' => round((float) $totals->acc, 2),
                'book_value' => round((float) $totals->cost - (float) $totals->acc, 2),
            ],
            // every asset by status, whatever the filters (the Stock / Sales cards)
            'status_counts' => Asset::query()->selectRaw('status, COUNT(*) n')->groupBy('status')->pluck('n', 'status'),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules() + [
            'purchase_date' => ['required', 'date', 'before_or_equal:today'],
            'cost' => ['required', 'numeric', 'gt:0', 'max:9999999999999'],
            'salvage_value' => ['nullable', 'numeric', 'min:0'],
            'life_months' => ['nullable', 'integer', 'min:1', 'max:1200'],
            'acquisition' => ['required', Rule::in(array_keys(Asset::ACQUISITIONS))],
            'method' => ['nullable', Rule::in([...array_keys(Receipt::METHODS), 'credit'])],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'opening_depreciation' => ['nullable', 'numeric', 'min:0'],
            'opening_date' => ['nullable', 'date', 'before_or_equal:today'],
        ]);
        $asset = $this->assets->create($data);

        return response()->json(['id' => $asset->id, 'asset_code' => $asset->asset_code], 201);
    }

    public function show(Asset $asset): JsonResponse
    {
        $asset->load(['category', 'mouza:id,name_bn,name_en', 'fund:id,code,name_bn,name_en', 'journal:id,voucher_no', 'creator:id,name_bn,name_en',
            'movements' => fn ($q) => $q->with('creator:id,name_bn,name_en', 'journal:id,voucher_no')->orderByDesc('date')->orderByDesc('id'),
            'maintenances' => fn ($q) => $q->with('journal:id,voucher_no')->orderByRaw("status = 'scheduled' desc")->orderBy('due_on')->orderByDesc('id'),
            'depreciations' => fn ($q) => $q->with('journal:id,voucher_no')->orderByDesc('period')]);

        return response()->json($asset->toArray() + [
            'monthly_charge' => $asset->monthlyCharge(), 'remaining' => $asset->depreciable(),
            'months_left' => $asset->monthlyCharge() > 0 ? (int) ceil($asset->depreciable() / $asset->monthlyCharge()) : 0,
        ]);
    }

    /** Descriptive fields only — money and dates of a booked asset change through their own actions. */
    public function update(Request $request, Asset $asset): JsonResponse
    {
        $data = $request->validate($this->rules());
        if ((int) $data['category_id'] !== $asset->category_id && $asset->depreciations()->exists()) {
            throw ValidationException::withMessages(['category_id' => __('অবচয় শুরু হওয়ার পর শ্রেণি পরিবর্তন করা যায় না।')]);
        }
        unset($data['location'], $data['custodian'], $data['condition']);
        $asset->update($data);

        return response()->json($asset->fresh());
    }

    public function movement(Request $request, Asset $asset): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(['transfer', 'install', 'uninstall', 'condition', 'repair', 'repaired'])],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'to_location' => ['nullable', 'required_if:type,transfer', 'string', 'max:200'],
            'custodian' => ['nullable', 'string', 'max:150'],
            'condition' => ['nullable', 'required_if:type,condition', Rule::in(array_keys(Asset::CONDITIONS))],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json($this->assets->movement($asset, $data['type'], $data));
    }

    public function schedule(Request $request, Asset $asset): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', Rule::in(array_keys(AssetMaintenance::KINDS))],
            'title' => ['required', 'string', 'max:200'],
            'due_on' => ['nullable', 'date'],
            'repeat_months' => ['nullable', 'integer', 'min:1', 'max:120'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json($this->assets->schedule($asset, $data), 201);
    }

    public function complete(Request $request, AssetMaintenance $maintenance): JsonResponse
    {
        $data = $request->validate([
            'done_on' => ['required', 'date', 'before_or_equal:today'],
            'cost' => ['nullable', 'numeric', 'min:0', 'max:9999999999999'],
            'vendor' => ['nullable', 'string', 'max:150'],
            'method' => ['nullable', Rule::in([...array_keys(Receipt::METHODS), 'credit'])],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json($this->assets->complete($maintenance, $data));
    }

    public function cancelMaintenance(AssetMaintenance $maintenance): JsonResponse
    {
        if ($maintenance->status !== 'scheduled') {
            throw ValidationException::withMessages(['status' => __('শুধু নির্ধারিত কাজ বাতিল করা যায়।')]);
        }
        $maintenance->update(['status' => 'cancelled']);

        return response()->json($maintenance);
    }

    /** Service/repair jobs across all assets (due list). */
    public function maintenances(Request $request): JsonResponse
    {
        $today = now()->toDateString();
        $q = AssetMaintenance::with('asset:id,asset_code,name_bn,name_en,location');
        $q->where('status', $request->query('status', 'scheduled'));
        if ($request->boolean('overdue')) {
            $q->whereDate('due_on', '<', $today);
        }
        if ($request->filled('within_days')) {
            $q->whereDate('due_on', '<=', now()->addDays((int) $request->query('within_days'))->toDateString());
        }
        if ($request->filled('kind')) {
            $q->where('kind', $request->query('kind'));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('title', 'like', "%$search%")->orWhere('vendor', 'like', "%$search%")
                ->orWhereHas('asset', fn ($a) => $a->where('asset_code', 'like', "%$en%")->orWhere('name_bn', 'like', "%$search%")));
        }
        $scheduled = fn () => AssetMaintenance::where('status', 'scheduled');

        return response()->json($q->orderByRaw('due_on is null')->orderBy('due_on')->orderByDesc('done_on')
            ->paginate($this->perPage($request))->toArray() + [
                // the schedule cards: open jobs, late ones, due within 30 days, and what was done this year (with its cost)
                'counts' => [
                    'scheduled' => $scheduled()->count(),
                    'overdue' => $scheduled()->whereDate('due_on', '<', $today)->count(),
                    'due_30' => $scheduled()->whereDate('due_on', '>=', $today)->whereDate('due_on', '<=', now()->addDays(30)->toDateString())->count(),
                    'done_year' => AssetMaintenance::where('status', 'done')->whereYear('done_on', now()->year)->count(),
                    'cost_year' => round((float) AssetMaintenance::where('status', 'done')->whereYear('done_on', now()->year)->sum('cost'), 2),
                    'done' => AssetMaintenance::where('status', 'done')->count(),
                    'cancelled' => AssetMaintenance::where('status', 'cancelled')->count(),
                ],
            ]);
    }

    /** Asset dashboard: register totals by status/category/condition, due maintenance, latest movements. */
    public function dashboard(): JsonResponse
    {
        $today = now()->toDateString();
        $byStatus = Asset::query()->selectRaw('status, COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(accumulated_depreciation),0) acc')
            ->groupBy('status')->get()->keyBy('status');
        $live = Asset::query()->whereNotIn('status', Asset::GONE);
        $byCategory = (clone $live)->selectRaw('category_id, COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(accumulated_depreciation),0) acc')
            ->groupBy('category_id')->get();
        $cats = AssetCategory::whereIn('id', $byCategory->pluck('category_id'))->get(['id', 'code', 'name_bn', 'name_en'])->keyBy('id');
        $money = fn ($r) => ['count' => (int) $r->n, 'cost' => round((float) $r->cost, 2), 'book_value' => round((float) $r->cost - (float) $r->acc, 2)];

        return response()->json([
            'totals' => $money((clone $live)->selectRaw('COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(accumulated_depreciation),0) acc')->first())
                + ['accumulated' => round((float) (clone $live)->sum('accumulated_depreciation'), 2)],
            'by_status' => collect(Asset::STATUSES)->keys()->map(fn ($s) => ['status' => $s] + ($byStatus->has($s) ? $money($byStatus[$s]) : ['count' => 0, 'cost' => 0, 'book_value' => 0]))->values(),
            'by_category' => $byCategory->map(fn ($r) => ['category' => $cats[$r->category_id] ?? null] + $money($r))->sortByDesc('cost')->values(),
            'by_condition' => (clone $live)->selectRaw('`condition`, COUNT(*) n')->groupBy('condition')->pluck('n', 'condition'),
            'maintenance' => [
                'overdue' => AssetMaintenance::where('status', 'scheduled')->whereDate('due_on', '<', $today)->count(),
                'due_30' => AssetMaintenance::where('status', 'scheduled')->whereDate('due_on', '>=', $today)->whereDate('due_on', '<=', now()->addDays(30)->toDateString())->count(),
                'upcoming' => AssetMaintenance::with('asset:id,asset_code,name_bn,name_en')->where('status', 'scheduled')->whereNotNull('due_on')
                    ->orderBy('due_on')->limit(8)->get(),
            ],
            'last_depreciation' => AssetDepreciation::max('period'),
            'movements' => AssetMovement::with('asset:id,asset_code,name_bn,name_en')->orderByDesc('date')->orderByDesc('id')->limit(10)->get(),
            'statuses' => Tr::map(Asset::STATUSES), 'conditions' => Tr::map(Asset::CONDITIONS), 'movement_types' => Tr::map(AssetMovement::TYPES),
        ]);
    }

    /** Movement log across all assets (transfer / install / repair screens). */
    public function movements(Request $request): JsonResponse
    {
        $q = AssetMovement::with(['asset:id,asset_code,name_bn,name_en,status,location', 'creator:id,name_bn,name_en', 'journal:id,voucher_no']);
        $types = $request->filled('types') ? explode(',', (string) $request->query('types')) : array_keys(AssetMovement::TYPES);
        $q->whereIn('type', $request->filled('type') ? [(string) $request->query('type')] : $types);
        if ($request->filled('from')) {
            $q->whereDate('date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->whereDate('date', '<=', $request->query('to'));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->whereHas('asset', fn ($a) => $a->where('asset_code', 'like', "%$en%")->orWhere('name_bn', 'like', "%$search%"))
                ->orWhere('to_location', 'like', "%$search%")->orWhere('from_location', 'like', "%$search%")->orWhere('custodian', 'like', "%$search%"));
        }

        $all = fn () => AssetMovement::whereIn('type', $types);

        return response()->json($q->orderByDesc('date')->orderByDesc('id')->paginate($this->perPage($request))->toArray() + [
            'types' => Tr::map(AssetMovement::TYPES),
            // the cards: entries of these types (all, per type, this month, assets involved) and where assets stand now
            'counts' => [
                'total' => $all()->count(),
                'month' => $all()->whereDate('date', '>=', now()->startOfMonth()->toDateString())->count(),
                'assets' => $all()->distinct()->count('asset_id'),
                'by_type' => $all()->selectRaw('type, COUNT(*) n')->groupBy('type')->pluck('n', 'type'),
                'by_status' => Asset::query()->selectRaw('status, COUNT(*) n')->groupBy('status')->pluck('n', 'status'),
            ],
        ]);
    }

    public function depreciationPreview(Request $request): JsonResponse
    {
        $data = $request->validate(['period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/']]);

        return response()->json($this->assets->depreciationPreview($data['period']));
    }

    public function depreciate(Request $request): JsonResponse
    {
        $data = $request->validate(['period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/']]);

        return response()->json(['runs' => $this->assets->depreciate($data['period'])]);
    }

    /** Posted depreciation, one row per month. */
    public function depreciationHistory(Request $request): JsonResponse
    {
        return response()->json(AssetDepreciation::query()
            ->select('period', 'journal_id', DB::raw('COUNT(*) assets'), DB::raw('SUM(amount) amount'))
            ->groupBy('period', 'journal_id')->with('journal:id,voucher_no,date')->orderByDesc('period')
            ->paginate($this->perPage($request))->toArray());
    }

    public function dispose(Request $request, Asset $asset): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(['sale', 'writeoff'])],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'price' => ['nullable', 'required_if:type,sale', 'numeric', 'min:0'],
            'buyer' => ['nullable', 'string', 'max:150'],
            'method' => ['nullable', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'reason' => ['required', 'string', 'max:300'],
        ]);

        return response()->json($this->assets->requestDisposal($asset, $data), 201);
    }

    private function rules(): array
    {
        return [
            'name_bn' => ['required', 'string', 'max:200'],
            'name_en' => ['nullable', 'string', 'max:200'],
            'category_id' => ['required', 'exists:asset_categories,id'],
            'brand_model' => ['nullable', 'string', 'max:150'],
            'serial_no' => ['nullable', 'string', 'max:100'],
            'supplier' => ['nullable', 'string', 'max:150'],
            'location' => ['nullable', 'string', 'max:200'],
            'mouza_id' => ['nullable', 'exists:mouzas,id'],
            'custodian' => ['nullable', 'string', 'max:150'],
            'condition' => ['nullable', Rule::in(array_keys(Asset::CONDITIONS))],
            'remarks' => ['nullable', 'string', 'max:500'],
        ];
    }

    private function filtered(Request $request): Builder
    {
        $q = Asset::query();
        foreach (['category_id', 'condition', 'mouza_id', 'acquisition'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        match ($request->query('status')) {
            null, '' => null,
            'active' => $q->whereNotIn('status', Asset::GONE),
            'disposal' => $q->whereIn('status', [...Asset::GONE, 'disposal_pending']),
            default => $q->where('status', $request->query('status')),
        };
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('asset_code', 'like', "%$en%")->orWhere('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                ->orWhere('serial_no', 'like', "%$en%")->orWhere('location', 'like', "%$search%")->orWhere('custodian', 'like', "%$search%"));
        }

        return $q;
    }
}
