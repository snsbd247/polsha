<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Farmer;
use App\Models\PublicPaymentRequest;
use App\Models\WaterBill;
use App\Models\WaterConnection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Manual mobile-money payments: a farmer sends money to the society's
 * bKash/Nagad/Rocket number and reports the TrxID on the public page. A
 * cashier checks the merchant statement, then either books it as a normal
 * combined payment (same split, receipt and ledger as the counter) or rejects it.
 */
class PublicPaymentService
{
    public function __construct(private CombinedPaymentService $combined, private SmsService $sms, private WaterService $water) {}

    /** What the public page may show: on/off, the receiving numbers and the instructions. */
    public static function info(): array
    {
        $s = SettingService::all();
        $methods = [];
        foreach (array_keys(PublicPaymentRequest::METHODS) as $m) {
            if (trim((string) ($s['public_payment_'.$m] ?? '')) !== '') {
                $methods[] = ['method' => $m, 'number' => $s['public_payment_'.$m]];
            }
        }

        return [
            'enabled' => (bool) $s['public_payment_enabled'] && $methods !== [],
            'methods' => $methods, 'note' => $s['public_payment_note'],
            'society_name_bn' => $s['society_name_bn'] ?? '', 'society_name_en' => $s['society_name_en'] ?? '',
        ];
    }

    public function submit(array $data, ?string $ip): PublicPaymentRequest
    {
        $info = self::info();
        if (! $info['enabled'] || ! in_array($data['method'], array_column($info['methods'], 'method'), true)) {
            throw ValidationException::withMessages(['method' => __('অনলাইন পেমেন্ট জমা এখন বন্ধ আছে।')]);
        }
        // a farmer ID, or a water connection number for a water bill
        $code = trim($data['farmer_code']);
        $farmer = Farmer::where('farmer_code', $code)->first();
        $connection = $farmer ? null : self::connection($code);
        if (! $farmer && ! $connection) {
            throw ValidationException::withMessages(['farmer_code' => __('এই আইডি বা পানির সংযোগ নম্বরের কাউকে পাওয়া যায়নি।')]);
        }
        $trx = strtoupper(trim($data['trx_id']));
        if (PublicPaymentRequest::where('method', $data['method'])->where('trx_id', $trx)->exists()) {
            throw ValidationException::withMessages(['trx_id' => __('এই ট্রানজেকশন আইডি আগেই জমা দেওয়া হয়েছে।')]);
        }

        return PublicPaymentRequest::create([
            'request_no' => SequenceService::next('public_payment'), 'farmer_code' => $farmer?->farmer_code ?? $connection->connection_no,
            'farmer_id' => $farmer?->id, 'water_connection_id' => $connection?->id,
            'payer_name' => $data['payer_name'], 'mobile' => SmsService::normalize($data['mobile']) ?? $data['mobile'],
            'method' => $data['method'], 'sender_number' => $data['sender_number'], 'trx_id' => $trx,
            'amount' => round((float) $data['amount'], 2), 'paid_on' => $data['paid_on'], 'note' => $data['note'] ?? null,
            'status' => 'pending', 'ip' => $ip,
        ]);
    }

    /** Book the money: a combined payment into the chosen bank/mobile-money account, split like the counter. */
    public function verify(PublicPaymentRequest $req, int $fundAccountId, ?float $amount = null, ?array $parts = null): PublicPaymentRequest
    {
        $this->ensurePending($req);
        $fund = Account::with('bankAccount')->find($fundAccountId);
        if (! $fund?->bankAccount) {
            throw ValidationException::withMessages(['fund_account_id' => __('টাকা যে ব্যাংক/মোবাইল ব্যাংকিং হিসাবে এসেছে সেটি বাছাই করুন।')]);
        }

        if ($req->water_connection_id) {
            return $this->verifyWater($req, $fundAccountId, $amount ?? (float) $req->amount);
        }

        return DB::transaction(function () use ($req, $fundAccountId, $amount, $parts) {
            $payment = $this->combined->create([
                'farmer_id' => $req->farmer_id, 'date' => $req->paid_on->toDateString(), 'amount' => $amount ?? (float) $req->amount,
                'method' => 'other', 'fund_account_id' => $fundAccountId, 'reference' => strtoupper($req->method).' '.$req->trx_id,
                'remarks' => __('অনলাইন জমা :no', ['no' => $req->request_no]), 'parts' => $parts,
            ]);
            $req->update(['status' => 'verified', 'combined_payment_id' => $payment->id, 'verified_by' => auth()->id(), 'verified_at' => now()]);
            $this->sms->queue('public_payment_verified', $req->mobile, [
                'name' => $req->payer_name, 'method' => __(PublicPaymentRequest::METHODS[$req->method]),
                'amount' => number_format((float) $payment->amount, 2), 'trx_id' => $req->trx_id, 'receipt_no' => $payment->payment_no,
            ], $req);

            return $req->fresh(['combinedPayment', 'verifier:id,name_bn,name_en']);
        });
    }

    /** A water bill paid online: a water receipt over the open bills, oldest first. */
    private function verifyWater(PublicPaymentRequest $req, int $fundAccountId, float $amount): PublicPaymentRequest
    {
        $connection = WaterConnection::findOrFail($req->water_connection_id);
        $bills = WaterBill::where('connection_id', $connection->id)->whereIn('status', ['unpaid', 'partial'])->orderBy('bill_date')->orderBy('id')->get();
        $due = round($bills->sum(fn (WaterBill $b) => $b->dueAmount()), 2);
        if (round($amount, 2) > $due) {
            throw ValidationException::withMessages(['amount' => __('সংযোগের পানির বিলের বকেয়া :due টাকা; এর বেশি নেওয়া যায় না। বাড়তি টাকা ফেরত দিয়ে বকেয়া পরিমাণ লিখুন।', ['due' => number_format($due, 2)])]);
        }
        $left = (int) round($amount * 100);
        $items = [];
        foreach ($bills as $b) {
            $take = min($left, (int) round($b->dueAmount() * 100));
            if ($take > 0) {
                $items[] = ['bill_id' => $b->id, 'amount' => $take / 100];
                $left -= $take;
            }
        }

        return DB::transaction(function () use ($req, $connection, $fundAccountId, $items) {
            $receipt = $this->water->collect($connection, [
                'date' => $req->paid_on->toDateString(), 'method' => 'other', 'fund_account_id' => $fundAccountId,
                'reference' => strtoupper($req->method).' '.$req->trx_id, 'remarks' => __('অনলাইন জমা :no', ['no' => $req->request_no]),
            ], $items, 0);
            $req->update(['status' => 'verified', 'receipt_id' => $receipt->id, 'verified_by' => auth()->id(), 'verified_at' => now()]);
            $this->sms->queue('public_payment_verified', $req->mobile, [
                'name' => $req->payer_name, 'method' => __(PublicPaymentRequest::METHODS[$req->method]),
                'amount' => number_format((float) $receipt->amount, 2), 'trx_id' => $req->trx_id, 'receipt_no' => $receipt->receipt_no,
            ], $req);

            return $req->fresh(['receipt', 'waterConnection', 'verifier:id,name_bn,name_en']);
        });
    }

    /** A water connection that can take a payment: by its number, not closed. */
    public static function connection(string $code): ?WaterConnection
    {
        $code = strtoupper(trim($code));

        return $code === '' ? null : WaterConnection::where('connection_no', $code)->where('status', '!=', 'closed')->first();
    }

    public function reject(PublicPaymentRequest $req, string $reason): PublicPaymentRequest
    {
        $this->ensurePending($req);
        $req->update(['status' => 'rejected', 'reject_reason' => $reason, 'verified_by' => auth()->id(), 'verified_at' => now()]);
        $this->sms->queue('public_payment_rejected', $req->mobile, [
            'name' => $req->payer_name, 'method' => __(PublicPaymentRequest::METHODS[$req->method]), 'trx_id' => $req->trx_id, 'reason' => $reason,
        ], $req);

        return $req;
    }

    private function ensurePending(PublicPaymentRequest $req): void
    {
        if ($req->status !== 'pending') {
            throw ValidationException::withMessages(['status' => __('এই জমা আগেই নিষ্পত্তি হয়েছে।')]);
        }
        if (! $req->farmer_id && ! $req->water_connection_id) {
            throw ValidationException::withMessages(['farmer_code' => __('কৃষক পাওয়া যায়নি।')]);
        }
    }
}
