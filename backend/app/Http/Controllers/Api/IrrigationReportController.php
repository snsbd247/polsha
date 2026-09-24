<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\IrrigationRate;
use App\Models\Land;
use App\Models\Receipt;
use App\Models\Season;
use App\Services\IrrigationService;
use App\Services\LedgerService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class IrrigationReportController extends Controller
{
    public function __construct(private IrrigationService $irrigation, private LedgerService $ledger) {}

    /** Outstanding irrigation dues per cultivator. */
    public function dues(Request $request)
    {
        $q = DB::table('invoices')->join('farmers', 'farmers.id', '=', 'invoices.farmer_id')
            ->join('lands', 'lands.id', '=', 'invoices.land_id')
            ->whereIn('invoices.status', ['unpaid', 'partial'])
            ->when($request->query('season_id'), fn ($q, $v) => $q->where('invoices.season_id', $v))
            ->when($request->query('mouza_id'), fn ($q, $v) => $q->where('lands.mouza_id', $v))
            ->when($request->query('overdue') === '1', fn ($q) => $q->whereDate('invoices.due_date', '<', now()->toDateString()))
            ->when(trim((string) $request->query('search')), fn ($q, $v) => $q->where(fn ($w) => $w->where('farmers.name_bn', 'like', "%$v%")
                ->orWhere('farmers.name_en', 'like', "%$v%")->orWhere('farmers.farmer_code', Bn::toEnDigits($v))))
            ->groupBy('farmers.id', 'farmers.farmer_code', 'farmers.name_bn', 'farmers.name_en', 'farmers.father_name', 'farmers.mobile')
            ->selectRaw('farmers.id, farmers.farmer_code, farmers.name_bn, farmers.name_en, farmers.father_name, farmers.mobile,
                COUNT(*) AS invoice_count, SUM(invoices.amount) AS amount, SUM(invoices.paid_amount) AS paid,
                SUM(invoices.amount - invoices.paid_amount) AS due, MIN(invoices.invoice_date) AS oldest')
            ->orderByDesc('due');

        $map = fn ($r) => [
            'farmer_id' => $r->id, 'farmer_code' => $r->farmer_code, 'name_bn' => $r->name_bn, 'name_en' => $r->name_en,
            'father_name' => $r->father_name, 'mobile' => $r->mobile, 'invoice_count' => (int) $r->invoice_count,
            'amount' => round((float) $r->amount, 2), 'paid' => round((float) $r->paid, 2), 'due' => round((float) $r->due, 2), 'oldest' => $r->oldest,
        ];

        if ($request->query('export') === 'csv') {
            return CsvExport::download('irrigation-dues-'.now()->format('Ymd').'.csv',
                [__('কৃষক আইডি'), __('নাম'), __('পিতার নাম'), __('মোবাইল'), __('ইনভয়েস'), __('মোট বিল'), __('আদায়'), __('বকেয়া'), __('সবচেয়ে পুরনো')],
                $q->get()->map($map)->map(fn ($r) => [$r['farmer_code'], $r['name_bn'], $r['father_name'], $r['mobile'], $r['invoice_count'], $r['amount'], $r['paid'], $r['due'], $r['oldest']]));
        }

        $all = $q->get();
        $page = max(1, (int) $request->query('page', 1));
        $per = $this->perPage($request);

        return response()->json([
            'data' => $all->forPage($page, $per)->map($map)->values(),
            'total' => $all->count(),
            'current_page' => $page,
            'per_page' => $per,
            'totals' => ['farmers' => $all->count(), 'amount' => round($all->sum('amount'), 2), 'paid' => round($all->sum('paid'), 2), 'due' => round($all->sum('due'), 2)],
        ]);
    }

    /** Invoice history + receipts of one farmer (as cultivator). */
    public function statement(Farmer $farmer): JsonResponse
    {
        $invoices = Invoice::where('farmer_id', $farmer->id)->with('season:id,name_bn')->orderByDesc('invoice_date')->orderByDesc('id')->get()
            ->map(fn (Invoice $i) => [
                'id' => $i->id, 'invoice_no' => $i->invoice_no, 'invoice_date' => $i->invoice_date->toDateString(), 'season' => $i->season?->name_bn,
                'mouza' => $i->snapshot['mouza'] ?? null, 'dag_no' => $i->snapshot['dag_no'] ?? null, 'cultivation_type' => $i->cultivation_type,
                'area_decimal' => (float) $i->area_decimal, 'amount' => (float) $i->amount, 'paid_amount' => (float) $i->paid_amount,
                'due' => $i->dueAmount(), 'status' => $i->status,
            ]);
        $receipts = Receipt::where('farmer_id', $farmer->id)->orderByDesc('date')->orderByDesc('id')
            ->get(['id', 'receipt_no', 'date', 'amount', 'method', 'status', 'is_legacy', 'legacy_no']);
        $live = $invoices->where('status', '!=', 'cancelled');

        return response()->json([
            'farmer' => $farmer->only(['id', 'farmer_code', 'name_bn', 'name_en', 'father_name', 'mobile']),
            'invoices' => $invoices,
            'receipts' => $receipts,
            'totals' => ['amount' => round($live->sum('amount'), 2), 'paid' => round($live->sum('paid_amount'), 2), 'due' => round($live->sum('due'), 2)],
        ]);
    }

    /**
     * Where the operational records and the ledger disagree. Everything
     * listed here should be empty on a healthy system.
     */
    public function mismatch(): JsonResponse
    {
        $receivable = Account::byKey('irrigation_receivable');
        $ledgerDue = $this->ledger->balance($receivable->id);
        $bookDue = round((float) Invoice::where('status', '!=', 'cancelled')->sum(DB::raw('amount - paid_amount')), 2);

        $morph = (new Invoice)->getMorphClass();
        $paidByReceipts = DB::table('receipt_items')->join('receipts', 'receipts.id', '=', 'receipt_items.receipt_id')
            ->where('receipt_items.payable_type', $morph)->where('receipts.status', '!=', 'cancelled')
            ->groupBy('receipt_items.payable_id')->selectRaw('receipt_items.payable_id, SUM(receipt_items.amount) s')->pluck('s', 'payable_id');

        $issues = collect();
        Invoice::with('journal:id,status,amount')->select(['id', 'invoice_no', 'farmer_id', 'amount', 'paid_amount', 'status', 'journal_id', 'snapshot'])
            ->orderBy('id')->chunk(500, function ($chunk) use (&$issues, $paidByReceipts) {
                foreach ($chunk as $i) {
                    $paid = round((float) ($paidByReceipts[$i->id] ?? 0), 2);
                    $name = $i->snapshot['cultivator']['name_bn'] ?? '';
                    if ($paid !== round((float) $i->paid_amount, 2)) {
                        $issues->push(['kind' => 'paid_vs_receipts', 'invoice_id' => $i->id, 'ref' => $i->invoice_no, 'name' => $name, 'expected' => $paid, 'actual' => (float) $i->paid_amount]);
                    }
                    $want = $i->status === 'cancelled' ? 'reversed' : 'posted';
                    if (! $i->journal || $i->journal->status !== $want || round((float) $i->journal->amount, 2) !== round((float) $i->amount, 2)) {
                        $issues->push(['kind' => 'invoice_voucher', 'invoice_id' => $i->id, 'ref' => $i->invoice_no, 'name' => $name, 'expected' => (float) $i->amount, 'actual' => $i->journal ? (float) $i->journal->amount : null]);
                    }
                    $status = $i->status === 'cancelled' ? 'cancelled' : ((float) $i->paid_amount <= 0 ? 'unpaid' : ((float) $i->paid_amount >= (float) $i->amount ? 'paid' : 'partial'));
                    if ($status !== $i->status || (float) $i->paid_amount > (float) $i->amount) {
                        $issues->push(['kind' => 'invoice_status', 'invoice_id' => $i->id, 'ref' => $i->invoice_no, 'name' => $name, 'expected' => (float) $i->amount, 'actual' => (float) $i->paid_amount]);
                    }
                }
            });

        Receipt::with(['journal:id,status,amount'])->withSum('items', 'amount')->orderBy('id')->chunk(500, function ($chunk) use (&$issues) {
            foreach ($chunk as $r) {
                if (round((float) $r->items_sum_amount, 2) !== round((float) $r->amount, 2)) {
                    $issues->push(['kind' => 'receipt_items', 'receipt_id' => $r->id, 'ref' => $r->receipt_no, 'name' => $r->payer_name, 'expected' => (float) $r->amount, 'actual' => (float) $r->items_sum_amount]);
                }
                $want = $r->status === 'cancelled' ? 'reversed' : 'posted';
                if (! $r->journal || $r->journal->status !== $want || round((float) $r->journal->amount, 2) !== round((float) $r->amount, 2)) {
                    $issues->push(['kind' => 'receipt_voucher', 'receipt_id' => $r->id, 'ref' => $r->receipt_no, 'name' => $r->payer_name, 'expected' => (float) $r->amount, 'actual' => $r->journal ? (float) $r->journal->amount : null]);
                }
            }
        });

        return response()->json([
            'ledger_due' => $ledgerDue,
            'book_due' => $bookDue,
            'difference' => round($ledgerDue - $bookDue, 2),
            'account' => $receivable->only(['id', 'code', 'name_bn', 'name_en']),
            'issues' => $issues->values(),
            'kinds' => ([
                'paid_vs_receipts' => __('ইনভয়েসের আদায় ও রশিদের যোগফল মেলে না'),
                'invoice_voucher' => __('ইনভয়েসের ভাউচার নেই বা মেলে না'),
                'invoice_status' => __('ইনভয়েসের অবস্থা ভুল'),
                'receipt_items' => __('রশিদের মোট ও বিবরণের যোগফল মেলে না'),
                'receipt_voucher' => __('রশিদের ভাউচার নেই বা মেলে না'),
            ]),
        ]);
    }

    /** Rate audit: bills that don't match the approved rate, lands with no rate, and the change log. */
    public function rateAudit(Request $request): JsonResponse
    {
        $season = Season::findOrFail($request->query('season_id'));

        $invoiceIssues = Invoice::where('season_id', $season->id)->where('status', '!=', 'cancelled')->orderBy('id')->get()
            ->map(function (Invoice $i) use ($season) {
                $rate = $this->irrigation->rateFor($season->id, $i->land_type_id, $i->irrigation_type_id, $i->invoice_date->toDateString());
                $expected = $rate ? round((float) $i->area_decimal * (float) $rate->rate, 2) : null;
                $problems = [];
                if (! $rate) {
                    $problems[] = 'no_rate_now';
                } elseif ((float) $rate->rate !== (float) $i->rate) {
                    $problems[] = 'rate_changed';
                }
                if (round((float) $i->area_decimal * (float) $i->rate, 2) !== round((float) $i->amount, 2)) {
                    $problems[] = 'amount_math';
                }
                if ($i->area_decimal > ($i->snapshot['land_area'] ?? PHP_INT_MAX)) {
                    $problems[] = 'area_exceeds';
                }

                return $problems ? [
                    'id' => $i->id, 'invoice_no' => $i->invoice_no, 'name' => $i->snapshot['cultivator']['name_bn'] ?? '', 'dag_no' => $i->snapshot['dag_no'] ?? '',
                    'area_decimal' => (float) $i->area_decimal, 'rate' => (float) $i->rate, 'amount' => (float) $i->amount,
                    'current_rate' => $rate ? (float) $rate->rate : null, 'expected' => $expected, 'problems' => $problems,
                ] : null;
            })->filter()->values();

        // Cultivated, cultivator-assigned lands the season can't bill because no rate covers them.
        $combos = Land::where('status', 'cultivated')->whereHas('cultivation')->whereNotNull('irrigation_type_id')
            ->groupBy('land_type_id', 'irrigation_type_id')->selectRaw('land_type_id, irrigation_type_id, COUNT(*) c, SUM(area_decimal) a')->get();
        $today = min(now()->toDateString(), $season->end_date->toDateString());
        $noRate = $combos->filter(fn ($c) => ! $this->irrigation->rateFor($season->id, $c->land_type_id, $c->irrigation_type_id, max($today, $season->start_date->toDateString())))
            ->map(fn ($c) => [
                'land_type' => Tr::label(DB::table('land_types')->where('id', $c->land_type_id)->value('name_bn')),
                'irrigation_type' => Tr::label(DB::table('irrigation_types')->where('id', $c->irrigation_type_id)->value('name_bn')),
                'lands' => (int) $c->c, 'area' => round((float) $c->a, 4),
            ])->values();
        $noType = Land::where('status', 'cultivated')->whereHas('cultivation')->whereNull('irrigation_type_id')->count();

        $changes = IrrigationRate::where('season_id', $season->id)->with(['irrigationType:id,name_bn', 'landType:id,name_bn', 'creator:id,name_bn,name_en', 'approver:id,name_bn,name_en'])
            ->orderByDesc('id')->get()->map(fn ($r) => $r->toArray() + [
                'irrigation_type_name' => Tr::label($r->irrigationType?->name_bn), 'land_type_name' => Tr::label($r->landType?->name_bn),
                'invoices' => Invoice::where('rate_id', $r->id)->where('status', '!=', 'cancelled')->count(),
            ]);

        return response()->json([
            'season' => $season,
            'invoice_issues' => $invoiceIssues,
            'no_rate' => $noRate,
            'lands_without_irrigation_type' => $noType,
            'changes' => $changes,
            'problems' => ([
                'no_rate_now' => __('এখন কোনো অনুমোদিত রেট নেই'),
                'rate_changed' => __('বিলের রেট ও অনুমোদিত রেট ভিন্ন'),
                'amount_math' => __('পরিমাণ × রেট ≠ টাকা'),
                'area_exceeds' => __('বিলের পরিমাণ জমির চেয়ে বেশি'),
            ]),
            'statuses' => Tr::map(IrrigationRate::STATUSES),
        ]);
    }
}
