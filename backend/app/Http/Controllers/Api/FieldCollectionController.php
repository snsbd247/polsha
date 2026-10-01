<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CombinedPayment;
use App\Models\Farmer;
use App\Models\FieldDeposit;
use App\Models\User;
use App\Services\CombinedPaymentService;
use App\Services\FieldCollectionService;
use App\Services\SmsService;
use App\Support\Bn;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The phone screen for field collectors, and the office side that receives their cash. */
class FieldCollectionController extends Controller
{
    public function __construct(private FieldCollectionService $field, private CombinedPaymentService $payments) {}

    /** Farmers by name, mobile, farmer ID or member number — just enough to recognise them. */
    public function farmers(Request $request): JsonResponse
    {
        $search = trim((string) $request->query('search'));
        if (mb_strlen($search) < 2) {
            return response()->json([]);
        }
        $en = Bn::toEnDigits($search);
        $rows = Farmer::with(['village:id,name_bn,name_en', 'member:id,farmer_id,member_no,status'])
            ->whereNull('merged_into_id')
            ->where(fn ($q) => $q->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                ->orWhere('farmer_code', 'like', "%$en%")->orWhere('mobile', 'like', "%$en%")
                ->when(ctype_digit($en), fn ($x) => $x->orWhereHas('member', fn ($m) => $m->where('member_no', (int) $en))))
            ->orderBy('name_bn')->limit(15)->get(['id', 'farmer_code', 'name_bn', 'name_en', 'father_name', 'mobile', 'village_id']);

        return response()->json($rows);
    }

    /** What the farmer owes now, and how an amount would be split. */
    public function dues(Request $request): JsonResponse
    {
        $data = $request->validate(['farmer_id' => ['required', 'exists:farmers,id'], 'amount' => ['nullable', 'numeric', 'min:0']]);
        $dues = $this->payments->dues(Farmer::findOrFail($data['farmer_id']), now()->toDateString());

        return response()->json($dues + ['allocation' => $this->payments->allocate($dues, (float) ($data['amount'] ?? 0)),
            'modules' => Tr::map(CombinedPayment::MODULES)]);
    }

    public function collect(Request $request): JsonResponse
    {
        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:9999999999999'],
            'remarks' => ['nullable', 'string', 'max:300'],
        ]);
        $payment = $this->field->collect($data, $request->user());
        $farmer = $payment->farmer;
        app(SmsService::class)->paymentConfirmation($farmer?->mobile, (string) $farmer?->name_bn, (float) $payment->amount, $payment->payment_no, $payment->date->toDateString(), $payment);

        return response()->json($payment->makeVisible('verify_token')->toArray() + [
            'modules' => Tr::map(CombinedPayment::MODULES),
            'message' => __('আদায় হয়েছে — রশিদ :no', ['no' => $payment->payment_no]),
        ], 201);
    }

    /** The collector's own day: today's receipts, what they still hold, their recent hand-ins. */
    public function mine(Request $request): JsonResponse
    {
        $me = $request->user()->id;
        $today = CombinedPayment::with(['parts', 'farmer:id,farmer_code,name_bn,name_en'])->where('field_collector_id', $me)
            ->whereDate('date', now()->toDateString())->orderByDesc('id')->get();
        $holding = $this->field->holding($me);

        return response()->json([
            'today' => $today->map(fn ($p) => $p->makeVisible('verify_token')),
            'today_total' => round((float) $today->where('status', 'posted')->sum('amount'), 2),
            'holding' => ['count' => $holding->count(), 'amount' => round((float) $holding->sum('amount'), 2), 'oldest' => $holding->first()?->date?->toDateString()],
            'deposits' => FieldDeposit::with('receiver:id,name_bn,name_en')->where('collector_id', $me)->orderByDesc('id')->limit(5)->get(),
            'modules' => Tr::map(CombinedPayment::MODULES),
        ]);
    }

    /** Office: every collector with the cash they hold, and the latest hand-ins. */
    public function collectors(): JsonResponse
    {
        $collectors = $this->field->collectors();

        return response()->json([
            'collectors' => $collectors,
            'holding' => round((float) $collectors->sum('amount'), 2),
            'deposits' => FieldDeposit::with(['collector:id,name_bn,name_en', 'receiver:id,name_bn,name_en', 'journal:id,voucher_no'])->orderByDesc('id')->limit(20)->get(),
        ]);
    }

    /** Office: the receipts one collector holds, before receiving the cash. */
    public function holding(User $user): JsonResponse
    {
        return response()->json(['collector' => $user->only(['id', 'name_bn', 'name_en', 'mobile']), 'payments' => $this->field->holding($user->id),
            'modules' => Tr::map(CombinedPayment::MODULES)]);
    }

    public function deposit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'collector_id' => ['required', 'exists:users,id'],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $deposit = $this->field->deposit(User::findOrFail($data['collector_id']), $request->user(), $data['date'], $data['note'] ?? null);

        return response()->json($deposit->toArray() + ['message' => __('৳:amount জমা নেওয়া হয়েছে — :no', ['amount' => number_format((float) $deposit->amount, 2), 'no' => $deposit->deposit_no])], 201);
    }
}
