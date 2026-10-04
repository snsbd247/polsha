<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\Farmer;
use App\Models\PublicPaymentRequest;
use App\Models\WaterBill;
use App\Services\CombinedPaymentService;
use App\Services\PublicPaymentService;
use App\Services\SettingService;
use App\Services\SmsService;
use App\Support\Bn;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PublicPaymentController extends Controller
{
    public function __construct(private PublicPaymentService $payments) {}

    // ---- public (no login) ----

    public function info(): JsonResponse
    {
        return response()->json(PublicPaymentService::info() + ['methods_labels' => Tr::map(PublicPaymentRequest::METHODS)]);
    }

    public function submit(Request $request): JsonResponse
    {
        $request->merge(collect($request->only(['farmer_code', 'mobile', 'sender_number', 'amount', 'trx_id']))
            ->map(fn ($v) => is_string($v) ? trim(Bn::toEnDigits($v)) : $v)->all());
        $data = $request->validate([
            'farmer_code' => ['required', 'string', 'max:30'],
            'payer_name' => ['required', 'string', 'max:150'],
            'mobile' => ['required', 'string', 'max:20'],
            'method' => ['required', 'in:'.implode(',', array_keys(PublicPaymentRequest::METHODS))],
            'sender_number' => ['required', 'string', 'max:20'],
            'trx_id' => ['required', 'string', 'min:6', 'max:40', 'regex:/^[A-Za-z0-9]+$/'],
            'amount' => ['required', 'numeric', 'min:1', 'max:10000000'],
            'paid_on' => ['required', 'date', 'before_or_equal:today', 'after:'.now()->subDays(60)->toDateString()],
            'note' => ['nullable', 'string', 'max:300'],
        ]);
        $req = $this->payments->submit($data, $request->ip());

        return response()->json(['request_no' => $req->request_no, 'message' => __('আপনার পেমেন্টের তথ্য জমা হয়েছে। যাচাইয়ের পর SMS-এ রশিদ নম্বর পাবেন।')], 201);
    }

    /** Status check by request number + mobile, so a payer can follow up without logging in. */
    public function status(Request $request): JsonResponse
    {
        $data = $request->validate(['request_no' => ['required', 'string', 'max:30'], 'mobile' => ['required', 'string', 'max:20']]);
        $req = PublicPaymentRequest::with(['combinedPayment:id,payment_no', 'receipt:id,receipt_no'])->where('request_no', trim(Bn::toEnDigits($data['request_no'])))->first();
        // The whole number must match: an empty or partial mobile used to pass the suffix check.
        $mobile = SmsService::normalize($data['mobile']);
        abort_unless($req && $mobile && SmsService::normalize($req->mobile) === $mobile, 404, __('এই নম্বর ও মোবাইলে কোনো অনুরোধ পাওয়া যায়নি।'));

        return response()->json([
            'request_no' => $req->request_no, 'status' => $req->status, 'status_label' => __(PublicPaymentRequest::STATUSES[$req->status]),
            'amount' => $req->amount, 'trx_id' => $req->trx_id, 'paid_on' => $req->paid_on?->toDateString(),
            'receipt_no' => $req->receiptNo(), 'reject_reason' => $req->reject_reason,
        ]);
    }

    // ---- staff ----

    public function index(Request $request): JsonResponse
    {
        $q = PublicPaymentRequest::with(['farmer:id,farmer_code,name_bn,name_en', 'waterConnection:id,connection_no,name_bn,name_en', 'verifier:id,name_bn,name_en',
            'combinedPayment:id,payment_no', 'receipt:id,receipt_no'])->latest('id');
        $request->filled('status') && $q->where('status', $request->query('status'));
        $request->filled('method') && $q->where('method', $request->query('method'));
        if ($s = $request->query('q')) {
            $s = Bn::toEnDigits($s);
            $q->where(fn ($w) => $w->where('request_no', 'like', "%$s%")->orWhere('trx_id', 'like', "%$s%")->orWhere('farmer_code', 'like', "%$s%")
                ->orWhere('mobile', 'like', "%$s%")->orWhere('sender_number', 'like', "%$s%")->orWhere('payer_name', 'like', "%$s%"));
        }
        $counts = PublicPaymentRequest::selectRaw('status, count(*) as n, sum(amount) as amount')->groupBy('status')->get()->keyBy('status');

        return response()->json($q->paginate($this->perPage($request))->toArray() + [
            'counts' => $counts, 'statuses' => Tr::map(PublicPaymentRequest::STATUSES), 'methods' => Tr::map(PublicPaymentRequest::METHODS),
        ]);
    }

    /** One request with the farmer's dues and the proposed split, so the cashier can check before booking. */
    public function show(PublicPaymentRequest $publicPayment, CombinedPaymentService $combined): JsonResponse
    {
        $publicPayment->load(['farmer:id,farmer_code,name_bn,name_en,mobile', 'waterConnection:id,connection_no,name_bn,name_en,mobile,status', 'verifier:id,name_bn,name_en',
            'combinedPayment:id,payment_no,amount,status', 'receipt:id,receipt_no,amount,status']);
        $out = $publicPayment->toArray();
        if ($publicPayment->status === 'pending' && $publicPayment->waterConnection) {
            // a water bill: the open bills it will pay, oldest first
            $bills = WaterBill::where('connection_id', $publicPayment->water_connection_id)->whereIn('status', ['unpaid', 'partial'])->orderBy('bill_date')->orderBy('id')->get();
            $out['water_dues'] = [
                'due' => round($bills->sum(fn (WaterBill $b) => $b->dueAmount()), 2),
                'bills' => $bills->map(fn (WaterBill $b) => ['id' => $b->id, 'bill_no' => $b->bill_no, 'kind' => $b->kind, 'period' => $b->period, 'due' => $b->dueAmount()])->values(),
            ];
        }
        if ($publicPayment->status === 'pending' && $publicPayment->farmer) {
            $dues = $combined->dues($publicPayment->farmer, $publicPayment->paid_on->toDateString());
            $out['dues'] = $dues;
            $out['allocation'] = $combined->allocate($dues, (float) $publicPayment->amount);
        }
        $out['duplicate_trx'] = PublicPaymentRequest::where('trx_id', $publicPayment->trx_id)->whereKeyNot($publicPayment->id)->pluck('request_no');
        $out['funds'] = Account::with('bankAccount:id,account_id,bank_name,account_no')->whereHas('bankAccount')->where('is_postable', true)->where('is_active', true)
            ->orderBy('code')->get(['id', 'code', 'name_bn', 'name_en']);

        return response()->json($out);
    }

    public function verify(Request $request, PublicPaymentRequest $publicPayment): JsonResponse
    {
        $data = $request->validate([
            'fund_account_id' => ['required', 'exists:chart_of_accounts,id'],
            'amount' => ['nullable', 'numeric', 'min:0.01'],
            'parts' => ['nullable', 'array'],
            'parts.*' => ['numeric', 'min:0'],
        ]);

        return response()->json($this->payments->verify($publicPayment, (int) $data['fund_account_id'], isset($data['amount']) ? (float) $data['amount'] : null, $data['parts'] ?? null));
    }

    public function reject(Request $request, PublicPaymentRequest $publicPayment): JsonResponse
    {
        $reason = $request->validate(['reason' => ['required', 'string', 'max:300']])['reason'];

        return response()->json($this->payments->reject($publicPayment, $reason));
    }

    public function settings(): JsonResponse
    {
        return response()->json(array_intersect_key(SettingService::all(), array_flip(self::SETTING_KEYS)));
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'public_payment_enabled' => ['required', 'boolean'],
            'public_payment_bkash' => ['nullable', 'string', 'max:20'],
            'public_payment_nagad' => ['nullable', 'string', 'max:20'],
            'public_payment_rocket' => ['nullable', 'string', 'max:20'],
            'public_payment_note' => ['nullable', 'string', 'max:500'],
        ]);
        foreach (self::SETTING_KEYS as $k) {
            if ($k !== 'public_payment_enabled') {
                $data[$k] = trim((string) Bn::toEnDigits($data[$k] ?? ''));
            }
        }
        SettingService::setMany($data);

        return $this->settings();
    }

    /** Farmer lookup used by the public form to show the name before submitting (code → masked name). */
    public function farmer(Request $request): JsonResponse
    {
        $code = trim(Bn::toEnDigits((string) $request->query('code')));
        $farmer = $code !== '' ? Farmer::where('farmer_code', $code)->first(['id', 'farmer_code', 'name_bn', 'name_en']) : null;
        if (! $farmer && ($c = PublicPaymentService::connection($code))) {
            // a water connection number: the payer pays that tap's water bills
            return response()->json(['farmer_code' => $c->connection_no, 'kind' => 'water', 'name_bn' => self::mask($c->name_bn), 'name_en' => self::mask($c->name_en)]);
        }
        abort_unless($farmer, 404, __('এই আইডি বা পানির সংযোগ নম্বরের কাউকে পাওয়া যায়নি।'));

        return response()->json(['farmer_code' => $farmer->farmer_code, 'kind' => 'farmer', 'name_bn' => self::mask($farmer->name_bn), 'name_en' => self::mask($farmer->name_en)]);
    }

    /** "রহিম উদ্দিন মিয়া" → "রহিম ***": enough to confirm the ID, not a directory of names. */
    private static function mask(?string $name): ?string
    {
        if (! $name) {
            return $name;
        }
        $parts = preg_split('/\s+/u', trim($name));

        return count($parts) > 1 ? $parts[0].' ***' : mb_substr($parts[0], 0, 2).'***';
    }

    private const SETTING_KEYS = ['public_payment_enabled', 'public_payment_bkash', 'public_payment_nagad', 'public_payment_rocket', 'public_payment_note'];
}
