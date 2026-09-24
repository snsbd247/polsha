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
        'request_no', 'farmer_code', 'farmer_id', 'payer_name', 'mobile', 'method', 'sender_number', 'trx_id', 'amount', 'paid_on',
        'note', 'status', 'combined_payment_id', 'verified_by', 'verified_at', 'reject_reason', 'ip',
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

    public function verifier()
    {
        return $this->belongsTo(User::class, 'verified_by')->withTrashed();
    }
}
