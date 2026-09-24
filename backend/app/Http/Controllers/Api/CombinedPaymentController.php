<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CombinedPayment;
use App\Models\Farmer;
use App\Models\LoanPayment;
use App\Models\MemberTransaction;
use App\Models\Receipt;
use App\Services\CombinedPaymentService;
use App\Services\SettingService;
use App\Services\SmsService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CombinedPaymentController extends Controller
{
    public function __construct(private CombinedPaymentService $payments) {}

    public function index(Request $request)
    {
        $q = $this->filtered($request);
        $methods = Tr::map(Receipt::METHODS);
        $statuses = Tr::map(CombinedPayment::STATUSES);
        if ($request->query('export') === 'csv') {
            return CsvExport::download('combined-receipts-'.now()->format('Ymd').'.csv',
                [__('রশিদ নং'), __('তারিখ'), __('প্রদানকারী'), __('মাধ্যম'), __('ঋণ'), __('সেচ'), __('শেয়ার'), __('সঞ্চয়'), __('মোট'), __('অবস্থা')],
                $q->with('parts')->orderBy('payment_no')->lazy()->map(function (CombinedPayment $p) use ($methods, $statuses) {
                    $by = $p->parts->pluck('amount', 'module');

                    return [$p->payment_no, $p->date, $p->payer_name, $methods[$p->method] ?? $p->method,
                        $by['loan'] ?? 0, $by['irrigation'] ?? 0, $by['share'] ?? 0, $by['savings'] ?? 0, $p->amount, $statuses[$p->status] ?? $p->status];
                }));
        }
        $total = (clone $q)->reorder()->where('status', '!=', 'cancelled')->sum('amount');

        return response()->json($q->with(['parts:id,combined_payment_id,module,amount', 'farmer:id,farmer_code', 'creator:id,name_bn,name_en'])
            ->orderByDesc('date')->orderByDesc('id')->paginate($this->perPage($request))->toArray()
            + ['total_amount' => round((float) $total, 2), 'methods' => $methods, 'statuses' => $statuses, 'modules' => Tr::map(CombinedPayment::MODULES)]);
    }

    /** Dues of the payer plus the automatic split for an amount. */
    public function quote(Request $request): JsonResponse
    {
        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'date' => ['nullable', 'date'],
            'amount' => ['nullable', 'numeric', 'min:0'],
        ]);
        $dues = $this->payments->dues(Farmer::findOrFail($data['farmer_id']), $data['date'] ?? now()->toDateString());

        return response()->json($dues + ['allocation' => $this->payments->allocate($dues, (float) ($data['amount'] ?? 0)),
            'modules' => Tr::map(CombinedPayment::MODULES)]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:9999999999999'],
            'method' => ['required', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'remarks' => ['nullable', 'string', 'max:500'],
            'parts' => ['nullable', 'array'],
            'parts.*' => ['nullable', 'numeric', 'min:0'],
        ]);
        $payment = $this->payments->create($data);
        $farmer = $payment->farmer;
        app(SmsService::class)->paymentConfirmation($farmer?->mobile, (string) $farmer?->name_bn, (float) $payment->amount, $payment->payment_no, $data['date'], $payment);

        return response()->json(['id' => $payment->id, 'payment_no' => $payment->payment_no], 201);
    }

    public function show(CombinedPayment $combinedPayment): JsonResponse
    {
        $p = $combinedPayment->load(['parts.source', 'farmer:id,farmer_code,name_bn,name_en,father_name,mobile', 'member:id,member_no',
            'fund:id,code,name_bn,name_en', 'creator:id,name_bn,name_en']);

        return response()->json([
            ...$p->toArray(),
            'parts' => $p->parts->map(fn ($part) => [
                'id' => $part->id, 'module' => $part->module, 'amount' => (float) $part->amount, 'description' => $part->description,
                'source' => $this->sourceRef($part->source),
            ])->values(),
            'verify_token' => $p->verify_token,
            'society' => SettingService::society(),
            'methods' => Tr::map(Receipt::METHODS), 'statuses' => Tr::map(CombinedPayment::STATUSES), 'modules' => Tr::map(CombinedPayment::MODULES),
        ]);
    }

    public function cancel(Request $request, CombinedPayment $combinedPayment): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);

        return response()->json($this->payments->requestCancel($combinedPayment, $data['reason']), 201);
    }

    /** Public QR check of a printed combined receipt. */
    public function verify(string $token): JsonResponse
    {
        $p = CombinedPayment::with('parts')->where('verify_token', $token)->first();
        abort_unless($p, 404, __('রশিদ পাওয়া যায়নি।'));

        return response()->json([
            'receipt_no' => $p->payment_no, 'date' => $p->date->toDateString(), 'payer_name' => $p->payer_name,
            'amount' => (float) $p->amount, 'status' => $p->status === 'posted' ? 'active' : $p->status,
            'status_label' => __(CombinedPayment::STATUSES[$p->status]),
            'parts' => $p->parts->map(fn ($x) => ['module' => $x->module, 'label' => __(CombinedPayment::MODULES[$x->module]), 'amount' => (float) $x->amount])->values(),
            'society' => SettingService::get('society_name_bn'),
        ]);
    }

    private function sourceRef($src): ?array
    {
        return match (true) {
            $src instanceof LoanPayment => ['type' => 'loan_payment', 'id' => $src->id, 'no' => $src->payment_no, 'status' => $src->status],
            $src instanceof Receipt => ['type' => 'receipt', 'id' => $src->id, 'no' => $src->receipt_no, 'status' => $src->status],
            $src instanceof MemberTransaction => ['type' => 'member_txn', 'kind' => $src->kind, 'id' => $src->id, 'no' => $src->txn_no, 'status' => $src->status],
            default => null,
        };
    }

    private function filtered(Request $request): Builder
    {
        $q = CombinedPayment::query();
        foreach (['status', 'method', 'farmer_id'] as $f) {
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
            $q->where(fn ($w) => $w->where('payment_no', 'like', "%$en%")->orWhere('payer_name', 'like', "%$search%")->orWhere('reference', 'like', "%$en%"));
        }

        return $q;
    }
}
