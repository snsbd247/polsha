<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class PublicPaymentRequest extends Model
{
    use Auditable;

    public const METHODS = ['bkash' => 'বিকাশ', 'nagad' => 'নগদ (মোবাইল)', 'rocket' => 'রকেট'];

    public const STATUSES = ['pending' => 'যাচাইয়ের অপেক্ষায়', 'verified' => 'যাচাইকৃত', 'rejected' => 'প্রত্যাখ্যাত'];

    protected string $auditModule = 'payment';

    protected $fillable = [
        'request_no', 'farmer_code', 'farmer_id', 'water_connection_id', 'payer_name', 'mobile', 'method', 'sender_number', 'trx_id', 'amount', 'paid_on',
        'note', 'status', 'combined_payment_id', 'receipt_id', 'verified_by', 'verified_at', 'reject_reason', 'ip',
    ];

    protected $casts = ['amount' => 'decimal:2', 'paid_on' => 'date:Y-m-d', 'verified_at' => 'datetime'];

    public function farmer()
    {
        return $this->belongsTo(Farmer::class)->withTrashed();
    }

    public function combinedPayment()
    {
        return $this->belongsTo(CombinedPayment::class);
    }

    /** For a water bill paid online: the connection, and the water receipt once verified. */
    public function waterConnection()
    {
        return $this->belongsTo(WaterConnection::class);
    }

    public function receipt()
    {
        return $this->belongsTo(Receipt::class);
    }

    /** The number the payer is given: the combined receipt's, or the water receipt's. */
    public function receiptNo(): ?string
    {
        return $this->combinedPayment?->payment_no ?? $this->receipt?->receipt_no;
    }

    public function verifier()
    {
        return $this->belongsTo(User::class, 'verified_by')->withTrashed();
    }
}
