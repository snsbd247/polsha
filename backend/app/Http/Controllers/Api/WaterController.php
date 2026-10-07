<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Receipt;
use App\Models\ReceiptItem;
use App\Models\WaterBill;
use App\Models\WaterBillPenalty;
use App\Models\WaterConnection;
use App\Models\WaterConnectionDocument;
use App\Models\WaterConnectionType;
use App\Services\ImageService;
use App\Services\ReceiptService;
use App\Services\SettingService;
use App\Services\SmsService;
use App\Services\WaterService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/** Household water supply: connection types, connections, monthly bills, collection, dues. */
class WaterController extends Controller
{
    public function __construct(private WaterService $water) {}

    public function meta(): JsonResponse
    {
        return response()->json([
            'types' => WaterConnectionType::orderBy('sort_order')->orderBy('id')->get(),
            'statuses' => Tr::map(WaterConnection::STATUSES),
            'bill_statuses' => Tr::map(WaterBill::STATUSES),
            'kinds' => Tr::map(WaterBill::KINDS),
            'methods' => Tr::map(Receipt::METHODS),
        ]);
    }

    // ---- connection types ----

    public function types(): JsonResponse
    {
        return response()->json(WaterConnectionType::withCount(['connections', 'connections as active_count' => fn ($q) => $q->where('status', 'active')])
            ->orderBy('sort_order')->orderBy('id')->get());
    }

    public function storeType(Request $request): JsonResponse
    {
        return response()->json(WaterConnectionType::create($this->typeData($request)), 201);
    }

    public function updateType(Request $request, WaterConnectionType $type): JsonResponse
    {
        $type->update($this->typeData($request, $type));

        return response()->json($type->fresh());
    }

    private function typeData(Request $request, ?WaterConnectionType $type = null): array
    {
        return $request->validate([
            'code' => ['required', 'string', 'max:20', Rule::unique('water_connection_types', 'code')->ignore($type)],
            'name_bn' => ['required', 'string', 'max:100'],
            'name_en' => ['nullable', 'string', 'max:100'],
            'monthly_fee' => ['required', 'numeric', 'min:0', 'max:1000000'],
            'connection_fee' => ['required', 'numeric', 'min:0', 'max:10000000'],
            'is_active' => ['boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:999'],
        ]);
    }

    // ---- connections ----

    public function connections(Request $request)
    {
        $q = $this->connectionQuery($request);
        if ($request->query('export') === 'csv') {
            $statuses = Tr::map(WaterConnection::STATUSES);

            return CsvExport::download('water-connections-'.now()->format('Ymd').'.csv',
                [__('সংযোগ নং'), __('গ্রাহক'), __('পিতা/স্বামী'), __('মোবাইল'), __('গ্রাম'), __('ঠিকানা'), __('ধরন'), __('মাসিক ফি'), __('সংযোগের তারিখ'), __('অবস্থা'), __('বকেয়া')],
                $q->orderBy('connection_no')->lazy()->map(fn (WaterConnection $c) => [$c->connection_no, $c->name_bn, $c->father_name, $c->mobile,
                    $c->village?->name_bn, $c->address, $c->type?->name_bn, $c->fee(), $c->connected_on?->toDateString(), $statuses[$c->status] ?? $c->status, (float) $c->due]));
        }

        return response()->json($q->orderByDesc('id')->paginate($this->perPage($request)));
    }

    public function connectionSummary(): JsonResponse
    {
        $month = now()->startOfMonth();
        $billed = fn ($from, $to) => round((float) WaterBill::where('status', '!=', 'cancelled')
            ->whereBetween('bill_date', [$from->toDateString(), $to->toDateString()])->sum('amount'), 2);
        $open = WaterBill::where('status', '!=', 'cancelled')->whereRaw('amount + penalty - paid_amount > 0');

        return response()->json([
            'total' => WaterConnection::count(),
            'active' => WaterConnection::where('status', 'active')->count(),
            'disconnected' => WaterConnection::where('status', 'disconnected')->count(),
            'closed' => WaterConnection::where('status', 'closed')->count(),
            'new_this_month' => WaterConnection::whereDate('connected_on', '>=', $month->toDateString())->count(),
            // connections with at least one unpaid bill
            'owing' => (clone $open)->distinct()->count('connection_id'),
            'due' => round((float) WaterBill::where('status', '!=', 'cancelled')->selectRaw('COALESCE(SUM(amount + penalty - paid_amount), 0) as d')->value('d'), 2),
            'billed_this_month' => $billed($month, $month->copy()->endOfMonth()),
            'billed_last_month' => $billed($month->copy()->subMonth(), $month->copy()->subMonth()->endOfMonth()),
        ]);
    }

    public function storeConnection(Request $request): JsonResponse
    {
        $data = $this->connectionData($request);
        $fee = (float) ($request->validate(['connection_fee' => ['nullable', 'numeric', 'min:0', 'max:10000000']])['connection_fee'] ?? 0);

        return response()->json($this->water->open($data, $fee)->load(['type', 'village']), 201);
    }

    public function showConnection(WaterConnection $connection): JsonResponse
    {
        $connection->load(['type', 'village:id,name_bn,name_en', 'creator:id,name_bn,name_en', 'farmer:id,farmer_code,name_bn,name_en', 'documents.uploader:id,name_bn,name_en']);
        $bills = $connection->bills()->orderByDesc('bill_date')->orderByDesc('id')->get();
        $receiptIds = ReceiptItem::where('payable_type', (new WaterBill)->getMorphClass())->whereIn('payable_id', $bills->pluck('id'))->pluck('receipt_id')->unique();

        return response()->json($connection->toArray() + [
            'fee' => $connection->fee(),
            'due' => $this->water->due($connection),
            'bills' => $bills->map(fn (WaterBill $b) => $this->billRow($b)),
            'receipts' => Receipt::whereIn('id', $receiptIds)->orderByDesc('date')->orderByDesc('id')->get(['id', 'receipt_no', 'date', 'amount', 'method', 'status']),
        ]);
    }

    /** The tap's photo, shown on the detail page (private disk, so through the API). */
    public function connectionPhoto(WaterConnection $connection)
    {
        abort_unless($connection->photo && Storage::disk('local')->exists($connection->photo), 404);

        return Storage::disk('local')->response($connection->photo, null, ['Cache-Control' => 'private, max-age=3600']);
    }

    public function uploadConnectionPhoto(Request $request, WaterConnection $connection): JsonResponse
    {
        $request->validate(['image' => ['required', 'image', 'mimes:png,jpg,jpeg,webp', 'max:5120']]);
        $old = $connection->photo;
        $connection->update(['photo' => ImageService::storeCompressed($request->file('image'), 'water-photos', 1200, 80)]);
        if ($old) {
            Storage::disk('local')->delete($old);
        }

        return response()->json(['photo' => $connection->photo]);
    }

    public function deleteConnectionPhoto(WaterConnection $connection): JsonResponse
    {
        if ($connection->photo) {
            Storage::disk('local')->delete($connection->photo);
            $connection->update(['photo' => null]);
        }

        return response()->json(['photo' => null]);
    }

    public function storeConnectionDocument(Request $request, WaterConnection $connection): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:100'],
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
        ]);
        abort_if($connection->documents()->count() >= 20, 422, __('একটি সংযোগে সর্বোচ্চ ২০টি ডকুমেন্ট রাখা যায়।'));
        $file = $request->file('file');
        $doc = $connection->documents()->create([
            'title' => $data['title'],
            // private disk: reachable only through the authenticated download route
            'path' => $file->store("water-docs/{$connection->id}", 'local'),
            'original_name' => mb_substr($file->getClientOriginalName(), 0, 250),
            'mime' => $file->getMimeType(),
            'size' => $file->getSize(),
            'uploaded_by' => $request->user()->id,
        ]);

        return response()->json($doc->load('uploader:id,name_bn,name_en'), 201);
    }

    public function downloadConnectionDocument(WaterConnection $connection, WaterConnectionDocument $document)
    {
        abort_unless($document->connection_id === $connection->id && Storage::disk('local')->exists($document->path), 404);

        return Storage::disk('local')->response($document->path, $document->original_name);
    }

    public function deleteConnectionDocument(WaterConnection $connection, WaterConnectionDocument $document): JsonResponse
    {
        abort_unless($document->connection_id === $connection->id, 404);
        Storage::disk('local')->delete($document->path);
        $document->delete();

        return response()->json(['message' => __('ডকুমেন্ট মুছে ফেলা হয়েছে।')]);
    }

    /** Who did what to this connection, its bills and its papers (the audit log keeps short class names). */
    public function connectionActivity(Request $request, WaterConnection $connection): JsonResponse
    {
        $q = AuditLog::with('user:id,name_bn,username')->where(fn ($w) => $w
            ->where(fn ($x) => $x->where('auditable_type', 'WaterConnection')->where('auditable_id', $connection->id))
            ->orWhere(fn ($x) => $x->where('auditable_type', 'WaterBill')->whereIn('auditable_id', $connection->bills()->select('id')))
            ->orWhere(fn ($x) => $x->where('auditable_type', 'WaterConnectionDocument')->whereIn('auditable_id', WaterConnectionDocument::where('connection_id', $connection->id)->select('id'))));

        return response()->json($q->latest('id')->paginate($this->perPage($request)));
    }

    public function updateConnection(Request $request, WaterConnection $connection): JsonResponse
    {
        $connection->update($this->connectionData($request, $connection));

        return response()->json($connection->fresh(['type', 'village']));
    }

    public function connectionStatus(Request $request, WaterConnection $connection): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', Rule::in(['disconnect', 'reconnect', 'close'])],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'reason' => [Rule::requiredIf(fn () => $request->input('action') !== 'reconnect'), 'nullable', 'string', 'max:300'],
            'fee' => ['nullable', 'numeric', 'min:0', 'max:10000000'],
        ]);

        return response()->json($this->water->changeStatus($connection, $data['action'], $data['date'], $data['reason'] ?? null, (float) ($data['fee'] ?? 0)));
    }

    private function connectionData(Request $request, ?WaterConnection $connection = null): array
    {
        $request->merge(collect($request->only(['mobile', 'alt_mobile', 'nid', 'latitude', 'longitude']))->map(fn ($v) => is_string($v) ? trim(Bn::toEnDigits($v)) : $v)->all());

        return $request->validate([
            'type_id' => ['required', Rule::exists('water_connection_types', 'id')->where('is_active', true)],
            // a registered farmer's tap: its bills also come up in the farmer's combined payment
            'farmer_id' => ['nullable', Rule::exists('farmers', 'id')->whereNull('deleted_at')],
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'father_name' => ['nullable', 'string', 'max:150'],
            'mobile' => ['nullable', 'regex:/^01[3-9]\d{8}$/'],
            'alt_mobile' => ['nullable', 'regex:/^01[3-9]\d{8}$/'],
            'meter_no' => ['nullable', 'string', 'max:40'],
            'pipe_size' => ['nullable', 'string', 'max:40'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'nid' =>['nullable', 'regex:/^(\d{10}|\d{13}|\d{17})$/'],
            'village_id' => ['nullable', 'exists:villages,id'],
            'address' => ['nullable', 'string', 'max:250'],
            'monthly_fee' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
            'connected_on' => [$connection ? 'sometimes' : 'required', 'date', 'before_or_equal:today'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ], ['mobile.regex' => __('মোবাইল নম্বর ০১XXXXXXXXX আকারে দিন।'), 'alt_mobile.regex' => __('মোবাইল নম্বর ০১XXXXXXXXX আকারে দিন।'), 'nid.regex' => __('NID ১০, ১৩ বা ১৭ অঙ্কের হতে হবে।')]);
    }

    private function connectionQuery(Request $request): Builder
    {
        $q = WaterConnection::with(['type:id,code,name_bn,name_en,monthly_fee', 'village:id,name_bn,name_en', 'farmer:id,farmer_code'])
            ->addSelect(['due' => WaterBill::selectRaw('COALESCE(SUM(amount + penalty - paid_amount), 0)')
                ->whereColumn('connection_id', 'water_connections.id')->where('status', '!=', 'cancelled')]);
        foreach (['type_id', 'village_id', 'status'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        // the rows ticked on the list (export / print only those)
        if ($ids = array_filter(array_map('intval', explode(',', (string) $request->query('ids'))))) {
            $q->whereIn('water_connections.id', $ids);
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                ->orWhere('father_name', 'like', "%$search%")->orWhere('mobile', 'like', "%$en%")->orWhere('connection_no', 'like', "%$en%")
                ->orWhere('address', 'like', "%$search%")->orWhereHas('farmer', fn ($f) => $f->where('farmer_code', 'like', "%$en%")));
        }

        return $q;
    }

    // ---- monthly billing ----

    public function billingPreview(Request $request): JsonResponse
    {
        $period = $request->validate(['period' => ['required', 'date_format:Y-m']])['period'];
        $b = $this->water->billable($period);
        $row = fn (WaterConnection $c) => ['id' => $c->id, 'connection_no' => $c->connection_no, 'name_bn' => $c->name_bn, 'name_en' => $c->name_en,
            'type' => $c->type?->name_bn, 'type_en' => $c->type?->name_en, 'fee' => $c->fee()];

        return response()->json([
            'period' => $period,
            'count' => $b['ready']->count(),
            'total' => round($b['ready']->sum(fn ($c) => $c->fee()), 2),
            'already_billed' => $b['already_billed'],
            'rows' => $b['ready']->map($row)->values(),
            'no_fee' => $b['no_fee']->map($row)->values(),
        ]);
    }

    public function generate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'period' => ['required', 'date_format:Y-m', 'before_or_equal:'.now()->addMonth()->format('Y-m')],
            'bill_date' => ['required', 'date', 'before_or_equal:today'],
            'due_date' => ['nullable', 'date', 'after_or_equal:bill_date'],
        ]);
        $bills = $this->water->generate($data['period'], $data['bill_date'], $data['due_date'] ?? null);
        $this->billSms($bills);

        return response()->json(['count' => $bills->count(), 'total' => round($bills->sum(fn ($b) => (float) $b->amount), 2)], 201);
    }

    /** The month's bill to each customer with a mobile, with what the tap owes in all. */
    private function billSms($bills): void
    {
        if (! SettingService::get('sms_water_bill', true)) {
            return;
        }
        $sms = app(SmsService::class);
        foreach ($bills as $b) {
            $mobile = $b->snapshot['mobile'] ?? null;
            if (! $mobile) {
                continue;
            }
            $sms->queue('water_bill', $mobile, [
                'name' => $b->snapshot['name_bn'] ?? '', 'connection_no' => $b->snapshot['connection_no'] ?? '',
                'month' => WaterBill::periodLabel($b->period), 'amount' => number_format((float) $b->amount, 2),
                'total_due' => number_format($this->water->due($b->connection), 2),
                'due_date' => $b->due_date ? $b->due_date->format('d/m/Y') : '—',
            ], $b);
        }
    }

    // ---- bills ----

    public function bills(Request $request)
    {
        $q = WaterBill::query()->with('connection:id,farmer_id', 'connection.farmer:id,farmer_code');
        foreach (['period', 'kind', 'connection_id'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        // the ticked rows of the list (export only those)
        if ($ids = array_filter(array_map('intval', explode(',', (string) $request->query('ids'))))) {
            $q->whereIn('water_bills.id', $ids);
        }
        $today = now()->toDateString();
        $overdue = fn ($w) => $w->whereIn('status', ['unpaid', 'partial'])->whereNotNull('due_date')->where('due_date', '<', $today);
        $pending = fn ($w) => $w->whereIn('status', ['unpaid', 'partial'])->where(fn ($d) => $d->whereNull('due_date')->orWhere('due_date', '>=', $today));
        if ($request->filled('type_id') || $request->filled('village_id')) {
            $q->whereHas('connection', fn ($c) => $c->when($request->filled('type_id'), fn ($w) => $w->where('type_id', $request->integer('type_id')))
                ->when($request->filled('village_id'), fn ($w) => $w->where('village_id', $request->integer('village_id'))));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('bill_no', 'like', "%$en%")
                ->orWhereHas('connection', fn ($c) => $c->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                    ->orWhere('mobile', 'like', "%$en%")->orWhere('connection_no', 'like', "%$en%")));
        }
        // the summary cards count the month as a whole, whatever status is picked below
        $all = (clone $q)->where('status', '!=', 'cancelled');
        $cards = [
            'total' => (clone $all)->count(),
            'paid' => (clone $all)->where('status', 'paid')->count(),
            'pending' => (clone $all)->where($pending)->count(),
            'overdue' => (clone $all)->where($overdue)->count(),
            'amount' => round((float) (clone $all)->sum(DB::raw('amount + penalty')), 2),
        ];
        if ($request->filled('status')) {
            // "open" = anything still to collect; "pending" = open and not yet past its last date; "overdue" = open and past it
            match ($request->query('status')) {
                'open' => $q->whereIn('status', ['unpaid', 'partial']),
                'pending' => $q->where($pending),
                'overdue' => $q->where($overdue),
                default => $q->where('status', $request->query('status')),
            };
        }
        if ($request->query('export') === 'csv') {
            $statuses = Tr::map(WaterBill::STATUSES);
            $kinds = Tr::map(WaterBill::KINDS);

            return CsvExport::download('water-bills-'.now()->format('Ymd').'.csv',
                [__('বিল নং'), __('মাস'), __('ধরন'), __('সংযোগ নং'), __('গ্রাহক'), __('বিলের তারিখ'), __('বিল'), __('জরিমানা'), __('আদায়'), __('বকেয়া'), __('অবস্থা')],
                (clone $q)->orderBy('bill_no')->lazy()->map(fn (WaterBill $b) => [$b->bill_no, $b->period, $kinds[$b->kind] ?? $b->kind, $b->snapshot['connection_no'] ?? '',
                    $b->snapshot['name_bn'] ?? '', $b->bill_date->toDateString(), $b->amount, $b->penalty, $b->paid_amount, $b->dueAmount(), $statuses[$b->status] ?? $b->status]));
        }
        $valid = (clone $q)->where('status', '!=', 'cancelled');
        $totals = [
            'count' => (clone $valid)->count(),
            'amount' => round((float) (clone $valid)->sum('amount'), 2),
            'penalty' => round((float) (clone $valid)->sum('penalty'), 2),
            'paid' => round((float) (clone $valid)->sum('paid_amount'), 2),
        ];
        $totals['due'] = round($totals['amount'] + $totals['penalty'] - $totals['paid'], 2);
        $page = $q->orderByDesc('bill_date')->orderByDesc('id')->paginate($this->perPage($request));

        return response()->json(['data' => collect($page->items())->map(fn (WaterBill $b) => $this->billRow($b) + ['farmer_code' => $b->connection?->farmer?->farmer_code])]
            + collect($page->toArray())->except('data')->all() + ['totals' => $totals, 'cards' => $cards]);
    }

    public function showBill(WaterBill $bill): JsonResponse
    {
        $bill->load(['journal:id,voucher_no,status', 'creator:id,name_bn,name_en', 'penalties']);
        $items = ReceiptItem::where('payable_type', $bill->getMorphClass())->where('payable_id', $bill->id)->with('receipt:id,receipt_no,date,status,method')->get();

        return response()->json($this->billRow($bill) + [
            'journal' => $bill->journal, 'creator' => $bill->creator, 'penalties' => $bill->penalties,
            'payments' => $items->map(fn ($i) => ['amount' => (float) $i->amount, 'receipt' => $i->receipt]),
            'society' => SettingService::society(),
            'cancel_reason' => $bill->cancel_reason,
        ]);
    }

    public function waivePenalty(Request $request, WaterBill $bill): JsonResponse
    {
        $reason = $request->validate(['reason' => ['required', 'string', 'max:300']])['reason'];

        return response()->json($this->billRow($this->water->waivePenalty($bill, $reason, now()->toDateString())));
    }

    public function cancelBill(Request $request, WaterBill $bill): JsonResponse
    {
        $reason = $request->validate(['reason' => ['required', 'string', 'max:300']])['reason'];

        return response()->json($this->water->requestCancel($bill, $reason), 201);
    }

    private function billRow(WaterBill $b): array
    {
        return [
            'id' => $b->id, 'bill_no' => $b->bill_no, 'connection_id' => $b->connection_id, 'kind' => $b->kind, 'period' => $b->period,
            'bill_date' => $b->bill_date?->toDateString(), 'due_date' => $b->due_date?->toDateString(),
            'amount' => (float) $b->amount, 'penalty' => (float) $b->penalty, 'paid_amount' => (float) $b->paid_amount,
            'due' => $b->dueAmount(), 'status' => $b->status, 'snapshot' => $b->snapshot,
        ];
    }

    // ---- collection ----

    /** A connection's open bills, oldest first — what the collection screen offers. */
    public function dues(WaterConnection $connection): JsonResponse
    {
        $connection->load(['type:id,name_bn,name_en,monthly_fee', 'village:id,name_bn,name_en']);
        $bills = $connection->bills()->whereIn('status', ['unpaid', 'partial'])->orderBy('bill_date')->orderBy('id')->get();

        return response()->json([
            'connection' => $connection->only(['id', 'connection_no', 'name_bn', 'name_en', 'father_name', 'mobile', 'address', 'status']) + [
                'type' => $connection->type, 'village' => $connection->village, 'fee' => $connection->fee(),
            ],
            'bills' => $bills->map(fn (WaterBill $b) => $this->billRow($b)),
            'total_due' => round($bills->sum(fn ($b) => $b->dueAmount()), 2),
        ]);
    }

    public function collect(Request $request): JsonResponse
    {
        $data = $request->validate([
            'connection_id' => ['required', 'exists:water_connections,id'],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'method' => ['required', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'remarks' => ['nullable', 'string', 'max:500'],
            'penalty' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
            'items' => ['required', 'array', 'min:1', 'max:120'],
            'items.*.bill_id' => ['required', 'integer', 'distinct'],
            'items.*.amount' => ['required', 'numeric', 'min:0.01'],
        ]);
        $connection = WaterConnection::findOrFail($data['connection_id']);
        $money = collect($data)->only(['date', 'method', 'fund_account_id', 'reference', 'remarks'])->all();
        $receipt = $this->water->collect($connection, $money, $data['items'], round((float) ($data['penalty'] ?? 0), 2));
        app(SmsService::class)->paymentConfirmation($connection->mobile, $connection->name_bn, (float) $receipt->amount, $receipt->receipt_no, $data['date'], $receipt);

        return response()->json(['id' => $receipt->id, 'receipt_no' => $receipt->receipt_no, 'amount' => (float) $receipt->amount], 201);
    }

    // ---- receipts ----

    public function receipts(Request $request)
    {
        $q = Receipt::where('module', 'water');
        foreach (['status', 'method'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('from')) {
            $q->whereDate('date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->whereDate('date', '<=', $request->query('to'));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('receipt_no', 'like', "%$en%")->orWhere('payer_name', 'like', "%$search%")->orWhere('reference', 'like', "%$en%"));
        }
        // the ticked rows of the list (export only those)
        if ($ids = array_filter(array_map('intval', explode(',', (string) $request->query('ids'))))) {
            $q->whereIn('id', $ids);
        }
        if ($request->query('export') === 'csv') {
            $methods = Tr::map(Receipt::METHODS);
            $statuses = Tr::map(Receipt::STATUSES);

            return CsvExport::download('water-receipts-'.now()->format('Ymd').'.csv',
                [__('রশিদ নং'), __('তারিখ'), __('গ্রাহক'), __('টাকা'), __('মাধ্যম'), __('রেফারেন্স'), __('অবস্থা')],
                (clone $q)->orderBy('date')->orderBy('id')->lazy()->map(fn (Receipt $r) => [$r->receipt_no, $r->date?->toDateString(), $r->payer_name, $r->amount,
                    $methods[$r->method] ?? $r->method, $r->reference, $statuses[$r->status] ?? $r->status]));
        }
        $valid = (clone $q)->where('status', '!=', 'cancelled');
        $total = (clone $valid)->sum('amount');
        // the cards: whatever is filtered, plus today and this month on their own
        $cards = [
            'count' => (clone $valid)->count(),
            'amount' => round((float) $total, 2),
            'today' => round((float) Receipt::where('module', 'water')->where('status', '!=', 'cancelled')->whereDate('date', now()->toDateString())->sum('amount'), 2),
            'month' => round((float) Receipt::where('module', 'water')->where('status', '!=', 'cancelled')->whereDate('date', '>=', now()->startOfMonth()->toDateString())->sum('amount'), 2),
            'cancelled' => (clone $q)->where('status', 'cancelled')->count(),
        ];

        return response()->json($q->with('creator:id,name_bn,name_en')->orderByDesc('date')->orderByDesc('id')->paginate($this->perPage($request))->toArray()
            + ['total_amount' => round((float) $total, 2), 'cards' => $cards, 'methods' => Tr::map(Receipt::METHODS), 'statuses' => Tr::map(Receipt::STATUSES)]);
    }

    public function showReceipt(Receipt $receipt): JsonResponse
    {
        abort_unless($receipt->module === 'water', 404);
        $receipt->load(['items', 'fund:id,code,name_bn,name_en', 'journal:id,voucher_no,status', 'creator:id,name_bn,name_en', 'canceller:id,name_bn,name_en']);
        $bills = WaterBill::whereIn('id', $receipt->items->pluck('payable_id'))->get()->keyBy('id');
        $first = $bills->first();
        $penalties = WaterBillPenalty::where('receipt_id', $receipt->id)->sum('amount');

        return response()->json([
            ...$receipt->toArray(),
            'verify_token' => $receipt->verify_token,
            'connection' => $first ? ($first->snapshot ?? []) + ['id' => $first->connection_id] : null,
            'penalty' => round((float) $penalties, 2),
            'items' => $receipt->items->map(fn ($it) => [
                'amount' => (float) $it->amount, 'description' => $it->description, 'due_after' => $it->due_after !== null ? (float) $it->due_after : null,
                'bill' => ($b = $bills[$it->payable_id] ?? null) ? ['id' => $b->id, 'bill_no' => $b->bill_no, 'kind' => $b->kind, 'period' => $b->period, 'amount' => (float) $b->amount] : null,
            ])->values(),
            'society' => SettingService::society(),
            'methods' => Tr::map(Receipt::METHODS),
            'statuses' => Tr::map(Receipt::STATUSES),
        ]);
    }

    public function cancelReceipt(Request $request, Receipt $receipt): JsonResponse
    {
        abort_unless($receipt->module === 'water', 404);
        $reason = $request->validate(['reason' => ['required', 'string', 'max:300']])['reason'];

        return response()->json(app(ReceiptService::class)->requestCancel($receipt, $reason), 201);
    }

    // ---- dues by connection ----

    public function dueList(Request $request)
    {
        $q = $this->connectionQuery($request)
            ->addSelect(['open_bills' => WaterBill::selectRaw('COUNT(*)')->whereColumn('connection_id', 'water_connections.id')->whereIn('status', ['unpaid', 'partial'])])
            ->addSelect(['oldest_bill' => WaterBill::selectRaw('MIN(bill_date)')->whereColumn('connection_id', 'water_connections.id')->whereIn('status', ['unpaid', 'partial'])])
            ->whereHas('bills', fn ($b) => $b->whereIn('status', ['unpaid', 'partial']));
        if ($request->filled('min_bills')) {
            $q->having('open_bills', '>=', $request->integer('min_bills'));
        }
        if ($request->query('export') === 'csv') {
            return CsvExport::download('water-dues-'.now()->format('Ymd').'.csv',
                [__('সংযোগ নং'), __('গ্রাহক'), __('মোবাইল'), __('গ্রাম'), __('ধরন'), __('বকেয়া বিল'), __('পুরোনো বিলের তারিখ'), __('বকেয়া')],
                $q->orderByDesc('due')->lazy()->map(fn (WaterConnection $c) => [$c->connection_no, $c->name_bn, $c->mobile, $c->village?->name_bn,
                    $c->type?->name_bn, (int) $c->open_bills, $c->oldest_bill, (float) $c->due]));
        }
        $all = (clone $q)->get();

        return response()->json($q->orderByDesc('due')->paginate($this->perPage($request))->toArray() + [
            'totals' => ['connections' => $all->count(), 'due' => round($all->sum(fn ($c) => (float) $c->due), 2), 'bills' => (int) $all->sum('open_bills'),
                // three or more months unpaid: the ones to warn or disconnect
                'long_due' => $all->filter(fn ($c) => (int) $c->open_bills >= 3)->count(),
                'disconnected' => $all->where('status', 'disconnected')->count()],
        ]);
    }
}
