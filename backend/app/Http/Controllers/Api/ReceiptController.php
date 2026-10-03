<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\Member;
use App\Models\PatwariMouzaAssignment;
use App\Models\Receipt;
use App\Models\Season;
use App\Services\ReceiptService;
use App\Services\SettingService;
use App\Services\SmsService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ReceiptController extends Controller
{
    public function __construct(private ReceiptService $receipts) {}

    public function index(Request $request)
    {
        $q = $this->filtered($request);
        if ($request->query('export') === 'csv') {
            $methods = Tr::map(Receipt::METHODS);
            $statuses = Tr::map(Receipt::STATUSES);

            return CsvExport::download('receipts-'.now()->format('Ymd').'.csv',
                [__('রশিদ নং'), __('তারিখ'), __('প্রদানকারী'), __('মাধ্যম'), __('রেফারেন্স'), __('পুরনো রশিদ নং'), __('টাকা'), __('অবস্থা')],
                $q->orderBy('receipt_no')->lazy()->map(fn (Receipt $r) => [$r->receipt_no, $r->date, $r->payer_name, $methods[$r->method] ?? $r->method,
                    $r->reference, $r->legacy_no, $r->amount, $statuses[$r->status] ?? $r->status]));
        }
        $total = (clone $q)->reorder()->where('status', '!=', 'cancelled')->sum('amount');

        $page = $q->with(['farmer:id,farmer_code', 'creator:id,name_bn,name_en'])->orderByDesc('date')->orderByDesc('id')
            ->paginate($this->perPage($request))->toArray();

        return response()->json(($request->boolean('with_invoices') ? $this->withInvoices($page) : $page)
            + ['total_amount' => round((float) $total, 2), 'methods' => Tr::map(Receipt::METHODS), 'statuses' => Tr::map(Receipt::STATUSES)]);
    }

    public function show(Receipt $receipt): JsonResponse
    {
        $receipt->load(['items', 'farmer:id,farmer_code,name_bn,name_en,father_name,mobile,village_id', 'farmer.village:id,name_bn,name_en', 'fund:id,code,name_bn,name_en',
            'journal:id,voucher_no,status,reversed_by_id', 'journal.reversedBy:id,voucher_no', 'creator:id,name_bn,name_en', 'canceller:id,name_bn,name_en']);
        $invoices = Invoice::whereIn('id', $receipt->items->where('payable_type', (new Invoice)->getMorphClass())->pluck('payable_id'))
            ->with('land:id,mouza_id')->get()->keyBy('id');
        // the season being billed now; any other season's bill paid here is an arrear
        $current = Season::orderByDesc('start_date')->orderByDesc('id')->value('id');
        // who on the receipt is a member: the farmer and each owner
        $people = collect([$receipt->farmer_id])->merge($invoices->flatMap(fn ($i) => collect($i->snapshot['owners'] ?? [])->pluck('id')))->filter()->unique();
        $members = Member::whereIn('farmer_id', $people)->where('status', Member::ACTIVE)->pluck('farmer_id')->flip();
        // the patwari now looking after each mouza on the receipt
        $patwaris = PatwariMouzaAssignment::whereNull('end_date')->whereIn('mouza_id', $invoices->pluck('land.mouza_id')->filter()->unique())
            ->with('patwari:id,name,mobile')->get()->keyBy('mouza_id');

        return response()->json([
            ...$receipt->toArray(),
            'farmer_is_member' => $receipt->farmer_id ? isset($members[$receipt->farmer_id]) : null,
            'items' => $receipt->items->map(fn ($it) => $it->toArray() + ['invoice' => ($inv = $invoices[$it->payable_id] ?? null) ? [
                'id' => $inv->id, 'invoice_no' => $inv->invoice_no, 'season' => $inv->snapshot['season'] ?? null,
                'mouza' => $inv->snapshot['mouza'] ?? null, 'mouza_en' => $inv->snapshot['mouza_en'] ?? null, 'dag_no' => $inv->snapshot['dag_no'] ?? null, 'khatian_no' => $inv->snapshot['khatian_no'] ?? null,
                'area_decimal' => (float) $inv->area_decimal, 'rate' => (float) $inv->rate, 'amount' => (float) $inv->amount,
                'due_after' => $it->due_after !== null ? (float) $it->due_after : $inv->dueAmount(), 'cultivation_type' => $inv->cultivation_type,
                'owners' => collect($inv->snapshot['owners'] ?? [])->map(fn ($o) => $o + ['is_member' => isset($members[$o['id'] ?? 0])])->all(),
                'land_type' => $inv->snapshot['land_type'] ?? null, 'is_current' => $inv->season_id === $current,
                'penalty' => round(collect($inv->charges ?? [])->sum('amount'), 2),
                'patwari' => ($pw = $patwaris[$inv->land?->mouza_id]->patwari ?? null) ? ['name' => $pw->name, 'mobile' => $pw->mobile] : null,
            ] : null])->values(),
            'verify_token' => $receipt->verify_token,
            'society' => SettingService::society(),
            'methods' => Tr::map(Receipt::METHODS),
            'statuses' => Tr::map(Receipt::STATUSES),
        ]);
    }

    /** A farmer's open irrigation bills, oldest first — what the collection screen offers. */
    public function dues(Request $request): JsonResponse
    {
        $farmer = Farmer::findOrFail($request->query('farmer_id'));
        $invoices = Invoice::where('farmer_id', $farmer->id)->whereIn('status', ['unpaid', 'partial'])
            ->with('season:id,name_bn')->orderBy('invoice_date')->orderBy('id')->get()
            ->map(fn (Invoice $i) => [
                'id' => $i->id, 'invoice_no' => $i->invoice_no, 'invoice_date' => $i->invoice_date->toDateString(),
                'due_date' => $i->due_date?->toDateString(), 'season' => $i->season?->name_bn,
                'mouza' => $i->snapshot['mouza'] ?? null, 'dag_no' => $i->snapshot['dag_no'] ?? null,
                'area_decimal' => (float) $i->area_decimal, 'amount' => (float) $i->amount, 'paid_amount' => (float) $i->paid_amount,
                'due' => $i->dueAmount(), 'cultivation_type' => $i->cultivation_type,
            ]);

        return response()->json([
            'farmer' => $farmer->only(['id', 'farmer_code', 'name_bn', 'name_en', 'father_name', 'mobile']),
            'invoices' => $invoices,
            'total_due' => round($invoices->sum('due'), 2),
        ]);
    }

    /** Accounts a receipt can go into: the cash streams and active bank accounts. */
    public function funds(): JsonResponse
    {
        return response()->json(Account::with('bankAccount')->where('is_postable', true)->where('is_active', true)
            ->where(fn ($q) => $q->whereIn('key', Account::CASH_STREAMS)->orWhereHas('bankAccount', fn ($b) => $b->where('is_active', true)))
            ->orderBy('code')->get()
            ->map(fn (Account $a) => ['id' => $a->id, 'key' => $a->key, 'code' => $a->code, 'name_bn' => $a->name_bn, 'name_en' => $a->name_en,
                'kind' => $a->bankAccount ? 'bank' : 'cash', 'account_no' => $a->bankAccount?->account_no]));
    }

    public function store(Request $request): JsonResponse
    {
        $legacy = $request->boolean('is_legacy');
        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'method' => ['required', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'remarks' => ['nullable', 'string', 'max:500'],
            'is_legacy' => ['boolean'],
            'legacy_no' => [$legacy ? 'required' : 'nullable', 'string', 'max:50', Rule::unique('receipts', 'legacy_no')],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.invoice_id' => ['required', 'integer', 'distinct'],
            'items.*.amount' => ['required', 'numeric', 'min:0', 'max:9999999999999'],
        ]);
        $farmer = Farmer::findOrFail($data['farmer_id']);
        $invoices = Invoice::whereIn('id', array_column($data['items'], 'invoice_id'))->get()->keyBy('id');
        $items = [];
        foreach ($data['items'] as $i => $it) {
            $inv = $invoices[$it['invoice_id']] ?? null;
            if (! $inv || $inv->farmer_id !== $farmer->id) {
                throw ValidationException::withMessages(["items.$i.invoice_id" => __('ইনভয়েসটি এই চাষির নয়।')]);
            }
            $items[] = ['payable' => $inv, 'amount' => (float) $it['amount']];
        }

        $receipt = $this->receipts->create([
            'module' => 'irrigation', 'farmer_id' => $farmer->id, 'payer_name' => $farmer->name_bn,
            'date' => $data['date'], 'method' => $data['method'], 'fund_account_id' => $data['fund_account_id'] ?? null,
            'reference' => $data['reference'] ?? null, 'remarks' => $data['remarks'] ?? null,
            'is_legacy' => $legacy, 'legacy_no' => $data['legacy_no'] ?? null,
        ], $items);
        $legacy || app(SmsService::class)->paymentConfirmation($farmer->mobile, $farmer->name_bn, (float) $receipt->amount, $receipt->receipt_no, $data['date'], $receipt);

        return response()->json(['id' => $receipt->id, 'receipt_no' => $receipt->receipt_no], 201);
    }

    /**
     * Collect against invoices of several farmers at once: one receipt per
     * farmer, all saved together or none.
     */
    public function storeBatch(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date' => ['required', 'date', 'before_or_equal:today'],
            'method' => ['required', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'remarks' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:300'],
            'items.*.invoice_id' => ['required', 'integer', 'distinct', 'exists:invoices,id'],
            'items.*.amount' => ['required', 'numeric', 'gt:0', 'max:9999999999999'],
        ]);
        $invoices = Invoice::whereIn('id', array_column($data['items'], 'invoice_id'))->get()->keyBy('id');
        $byFarmer = collect($data['items'])->groupBy(fn ($it) => $invoices[$it['invoice_id']]->farmer_id);
        $farmers = Farmer::whereIn('id', $byFarmer->keys())->get()->keyBy('id');

        $receipts = DB::transaction(fn () => $byFarmer->map(fn ($items, $farmerId) => $this->receipts->create([
            'module' => 'irrigation', 'farmer_id' => $farmerId, 'payer_name' => $farmers[$farmerId]->name_bn,
            'date' => $data['date'], 'method' => $data['method'], 'fund_account_id' => $data['fund_account_id'] ?? null,
            'reference' => $data['reference'] ?? null, 'remarks' => $data['remarks'] ?? null, 'is_legacy' => false, 'legacy_no' => null,
        ], $items->map(fn ($it) => ['payable' => $invoices[$it['invoice_id']], 'amount' => (float) $it['amount']])->all()))->values());

        foreach ($receipts as $r) {
            $f = $farmers[$r->farmer_id];
            app(SmsService::class)->paymentConfirmation($f->mobile, $f->name_bn, (float) $r->amount, $r->receipt_no, $data['date'], $r);
        }

        return response()->json([
            'receipts' => $receipts->map(fn ($r) => ['id' => $r->id, 'receipt_no' => $r->receipt_no, 'farmer_id' => $r->farmer_id, 'amount' => (float) $r->amount]),
            'total' => round($receipts->sum(fn ($r) => (float) $r->amount), 2),
        ], 201);
    }

    public function cancel(Request $request, Receipt $receipt): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);

        return response()->json($this->receipts->requestCancel($receipt, $data['reason']), 201);
    }

    /** Public QR check: proves a printed receipt is genuine without logging in. */
    public function verify(string $token): JsonResponse
    {
        $r = Receipt::where('verify_token', $token)->first();
        abort_unless($r, 404, __('রশিদ পাওয়া যায়নি।'));

        return response()->json([
            'receipt_no' => $r->receipt_no, 'date' => $r->date->toDateString(), 'payer_name' => $r->payer_name,
            'amount' => (float) $r->amount, 'status' => $r->status, 'status_label' => __(Receipt::STATUSES[$r->status]),
            'society' => SettingService::get('society_name_bn'),
        ]);
    }

    private function filtered(Request $request): Builder
    {
        $q = Receipt::query();
        foreach (['module', 'status', 'method', 'farmer_id'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('is_legacy')) {
            $q->where('is_legacy', $request->boolean('is_legacy'));
        }
        if ($request->filled('from')) {
            $q->whereDate('date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->whereDate('date', '<=', $request->query('to'));
        }
        // season and mouza come from the invoices a receipt paid
        $paid = fn ($invoices) => fn ($e) => $e->from('receipt_items')->whereColumn('receipt_items.receipt_id', 'receipts.id')
            ->where('payable_type', (new Invoice)->getMorphClass())->whereIn('payable_id', $invoices);
        if ($request->filled('season_id')) {
            $q->whereExists($paid(Invoice::where('season_id', $request->integer('season_id'))->select('id')));
        }
        if ($request->filled('mouza_id')) {
            $q->whereExists($paid(Invoice::whereHas('land', fn ($l) => $l->withTrashed()->where('mouza_id', $request->integer('mouza_id')))->select('id')));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('receipt_no', 'like', "%$en%")->orWhere('legacy_no', 'like', "%$en%")
                ->orWhere('payer_name', 'like', "%$search%")->orWhere('reference', 'like', "%$en%")
                ->orWhereIn('farmer_id', Farmer::where('mobile', 'like', "%$en%")->select('id')));
        }

        return $q;
    }

    /** Old (hand-written) receipts entered into the system: count, money, farmers and the dates they cover. */
    /** Card figures for the receipt list: valid receipts overall, today and this month, and cancellations. */
    public function summary(): JsonResponse
    {
        $valid = fn () => Receipt::where('status', '!=', 'cancelled');
        $today = now()->toDateString();

        return response()->json([
            'count' => $valid()->count(),
            'amount' => round((float) $valid()->sum('amount'), 2),
            'today_count' => $valid()->where('date', $today)->count(),
            'today_amount' => round((float) $valid()->where('date', $today)->sum('amount'), 2),
            'month_amount' => round((float) $valid()->whereBetween('date', [now()->startOfMonth()->toDateString(), $today])->sum('amount'), 2),
            'cancelled' => Receipt::where('status', 'cancelled')->count(),
            'cancel_pending' => Receipt::where('status', 'cancel_pending')->count(),
        ]);
    }

    public function legacySummary(): JsonResponse
    {
        $q = Receipt::where('is_legacy', true)->where('status', '!=', 'cancelled');

        return response()->json([
            'count' => (clone $q)->count(),
            'amount' => round((float) (clone $q)->sum('amount'), 2),
            'farmers' => (clone $q)->distinct()->count('farmer_id'),
            'from' => (clone $q)->min('date'),
            'to' => (clone $q)->max('date'),
        ]);
    }

    /** Invoices, seasons and the farmer's mobile for each receipt on a page of the list. */
    private function withInvoices(array $page): array
    {
        $ids = array_column($page['data'], 'id');
        $items = DB::table('receipt_items')->join('invoices', 'invoices.id', '=', 'receipt_items.payable_id')->leftJoin('seasons', 'seasons.id', '=', 'invoices.season_id')
            ->where('receipt_items.payable_type', (new Invoice)->getMorphClass())->whereIn('receipt_items.receipt_id', $ids)
            ->get(['receipt_items.receipt_id', 'invoices.id', 'invoices.invoice_no', 'seasons.name_bn as season'])->groupBy('receipt_id');
        $mobiles = Farmer::whereIn('id', array_filter(array_column($page['data'], 'farmer_id')))->pluck('mobile', 'id');
        $page['data'] = array_map(fn ($r) => $r + [
            'invoices' => ($items[$r['id']] ?? collect())->map(fn ($i) => ['id' => $i->id, 'invoice_no' => $i->invoice_no])->values(),
            'seasons' => ($items[$r['id']] ?? collect())->pluck('season')->filter()->unique()->values(),
            'mobile' => $mobiles[$r['farmer_id']] ?? null,
        ], $page['data']);

        return $page;
    }
}
