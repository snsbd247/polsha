<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\Season;
use App\Services\IrrigationService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InvoiceController extends Controller
{
    public function __construct(private IrrigationService $irrigation) {}

    public function meta(): JsonResponse
    {
        return response()->json([
            'seasons' => Season::orderByDesc('start_date')->get(['id', 'name_bn', 'crop', 'status', 'start_date', 'end_date', 'due_date']),
            'irrigation_types' => IrrigationType::where('is_active', true)->orderBy('sort_order')->get(['id', 'name_bn'])
                ->map(fn ($t) => ['id' => $t->id, 'name_bn' => __($t->name_bn)]),
            'statuses' => Tr::map(Invoice::STATUSES),
            'cultivation_types' => Tr::map(Land::CULTIVATION_TYPES),
            'skip_reasons' => Tr::map(IrrigationService::SKIP_REASONS),
        ]);
    }

    public function index(Request $request)
    {
        $q = $this->filtered($request);
        if ($request->query('export') === 'csv') {
            $statuses = Tr::map(Invoice::STATUSES);
            $types = Tr::map(Land::CULTIVATION_TYPES);

            return CsvExport::download('invoices-'.now()->format('Ymd').'.csv',
                [__('ইনভয়েস নং'), __('তারিখ'), __('মৌসুম'), __('চাষি'), __('পিতার নাম'), __('চাষের ধরন'), __('মালিক'), __('মৌজা'), __('দাগ'), __('খতিয়ান'),
                    __('পরিমাণ (শতক)'), __('রেট'), __('টাকা'), __('আদায়'), __('বকেয়া'), __('অবস্থা')],
                $q->orderBy('invoice_no')->lazy()->map(function (Invoice $i) use ($statuses, $types) {
                    $r = $this->row($i);

                    return [$r['invoice_no'], $i->invoice_date, $r['season'], $r['cultivator']['name_bn'] ?? '', $r['cultivator']['father_name'] ?? '',
                        $types[$i->cultivation_type] ?? $i->cultivation_type, collect($r['owners'])->pluck('name_bn')->implode(', '),
                        $r['mouza'], $r['dag_no'], $r['khatian_no'], $r['area_decimal'], $r['rate'], $r['amount'], $r['paid_amount'], $r['due'],
                        $statuses[$i->status] ?? $i->status];
                }));
        }

        $totals = (clone $q)->reorder()->selectRaw('COUNT(*) c, COALESCE(SUM(amount),0) a, COALESCE(SUM(paid_amount),0) p')
            ->where('status', '!=', 'cancelled')->first();

        return response()->json($q->orderByDesc('invoice_date')->orderByDesc('id')->paginate($this->perPage($request))
            ->through(fn ($i) => $this->row($i))->toArray()
            + ['totals' => ['amount' => round((float) $totals->a, 2), 'paid' => round((float) $totals->p, 2), 'due' => round((float) $totals->a - (float) $totals->p, 2)]]);
    }

    public function show(Invoice $invoice): JsonResponse
    {
        $invoice->load(['journal:id,voucher_no,status', 'creator:id,name_bn,name_en', 'rateRow:id,rate,effective_from,approved_at',
            'batch:id,created_at', 'receiptItems.receipt:id,receipt_no,date,status,method,is_legacy,legacy_no']);

        return response()->json($this->row($invoice) + [
            'snapshot' => $invoice->snapshot,
            'remarks' => $invoice->remarks,
            'journal' => $invoice->journal,
            'creator' => $invoice->creator,
            'rate_row' => $invoice->rateRow,
            'batch_id' => $invoice->batch_id,
            'cancel_reason' => $invoice->cancel_reason,
            'cancelled_at' => $invoice->cancelled_at,
            'payments' => $invoice->receiptItems->map(fn ($it) => ['amount' => (float) $it->amount] + ($it->receipt?->toArray() ?? []))->values(),
            'cancel_pending' => $this->irrigation->pendingApproval('irrigation.invoice_cancel', $invoice),
        ]);
    }

    /** Single-invoice preview: what this land would be billed. */
    public function quote(Request $request): JsonResponse
    {
        $data = $this->validatedSingle($request);
        $c = $this->irrigation->candidate(Land::findOrFail($data['land_id']), Season::findOrFail($data['season_id']), $data['invoice_date'],
            $data['irrigation_type_id'] ?? null, isset($data['area_decimal']) ? (float) $data['area_decimal'] : null);

        return response()->json($c + ['reason_label' => $c['reason'] ? __(IrrigationService::SKIP_REASONS[$c['reason']]) : null]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validatedSingle($request);
        $invoice = $this->irrigation->createInvoice(Land::findOrFail($data['land_id']), Season::findOrFail($data['season_id']), $data);

        return response()->json(['id' => $invoice->id, 'invoice_no' => $invoice->invoice_no], 201);
    }

    public function bulkPreview(Request $request): JsonResponse
    {
        $data = $this->validatedBulk($request);
        $p = $this->irrigation->preview(Season::findOrFail($data['season_id']), $data['mouza_id'] ?? null, $data['invoice_date']);

        return response()->json([
            'summary' => $p['summary'],
            'lines' => $p['lines']->map(fn ($c) => [
                'land_id' => $c['land_id'], 'ok' => $c['ok'], 'reason' => $c['reason'],
                'land_code' => $c['snapshot']['land_code'], 'mouza' => $c['snapshot']['mouza'], 'mouza_en' => $c['snapshot']['mouza_en'],
                'dag_no' => $c['snapshot']['dag_no'], 'khatian_no' => $c['snapshot']['khatian_no'], 'cultivator' => $c['snapshot']['cultivator'],
                'owners' => $c['snapshot']['owners'], 'cultivation_type' => $c['cultivation_type'],
                'land_type' => Tr::label($c['snapshot']['land_type']), 'irrigation_type' => Tr::label($c['snapshot']['irrigation_type']),
                'area_decimal' => $c['area_decimal'], 'rate' => $c['rate'], 'amount' => $c['amount'],
            ])->values(),
        ]);
    }

    public function bulkStore(Request $request): JsonResponse
    {
        $data = $this->validatedBulk($request);
        $batch = $this->irrigation->bulk(Season::findOrFail($data['season_id']), $data['mouza_id'] ?? null, $data['invoice_date']);

        return response()->json($batch, 201);
    }

    public function cancel(Request $request, Invoice $invoice): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);

        return response()->json($this->irrigation->requestCancel($invoice, $data['reason']), 201);
    }

    private function validatedSingle(Request $request): array
    {
        return $request->validate([
            'season_id' => ['required', 'exists:seasons,id'],
            'land_id' => ['required', 'exists:lands,id'],
            'invoice_date' => ['required', 'date', 'before_or_equal:today'],
            'irrigation_type_id' => ['nullable', 'exists:irrigation_types,id'],
            'area_decimal' => ['nullable', 'numeric', 'gt:0', 'max:99999999'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
    }

    private function validatedBulk(Request $request): array
    {
        return $request->validate([
            'season_id' => ['required', 'exists:seasons,id'],
            'mouza_id' => ['nullable', 'exists:mouzas,id'],
            'invoice_date' => ['required', 'date', 'before_or_equal:today'],
        ]);
    }

    private function filtered(Request $request): Builder
    {
        $q = Invoice::query()->with(['season:id,name_bn', 'land:id,mouza_id']);
        foreach (['season_id', 'status', 'farmer_id', 'land_id', 'batch_id', 'irrigation_type_id', 'cultivation_type'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('mouza_id')) {
            $q->whereHas('land', fn ($l) => $l->withTrashed()->where('mouza_id', $request->query('mouza_id')));
        }
        if ($request->query('due') === '1') {
            $q->whereIn('status', ['unpaid', 'partial']);
        }
        if ($request->query('overdue') === '1') {
            $q->whereIn('status', ['unpaid', 'partial'])->whereDate('due_date', '<', now()->toDateString());
        }
        if ($request->filled('from')) {
            $q->whereDate('invoice_date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->whereDate('invoice_date', '<=', $request->query('to'));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('invoice_no', 'like', "%$en%")
                ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")->orWhere('farmer_code', $en))
                ->orWhereHas('land', fn ($l) => $l->where('dag_no', $en)->orWhere('land_code', $en)));
        }

        return $q;
    }

    private function row(Invoice $i): array
    {
        $s = $i->snapshot ?? [];

        return [
            'id' => $i->id,
            'invoice_no' => $i->invoice_no,
            'invoice_date' => $i->invoice_date?->toDateString(),
            'due_date' => $i->due_date?->toDateString(),
            'season_id' => $i->season_id,
            'season' => $i->season?->name_bn ?? ($s['season'] ?? null),
            'land_id' => $i->land_id,
            'land_code' => $s['land_code'] ?? null,
            'farmer_id' => $i->farmer_id,
            'cultivator' => $s['cultivator'] ?? null,
            'owners' => $s['owners'] ?? [],
            'cultivation_type' => $i->cultivation_type,
            'mouza' => $s['mouza'] ?? null,
            'mouza_en' => $s['mouza_en'] ?? null,
            'survey' => $s['survey'] ?? null,
            'dag_no' => $s['dag_no'] ?? null,
            'khatian_no' => $s['khatian_no'] ?? null,
            'land_type' => Tr::label($s['land_type'] ?? null),
            'irrigation_type' => Tr::label($s['irrigation_type'] ?? null),
            'area_decimal' => (float) $i->area_decimal,
            'rate' => (float) $i->rate,
            'amount' => (float) $i->amount,
            'paid_amount' => (float) $i->paid_amount,
            'due' => $i->dueAmount(),
            'status' => $i->status,
        ];
    }
}
