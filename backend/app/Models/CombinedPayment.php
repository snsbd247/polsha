<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** One counter receipt split across loan, irrigation, share and savings. */
class CombinedPayment extends Model
{
    use Auditable;

    /** Modules a combined payment can pay into, in their default settlement order. */
    public const MODULES = ['loan' => 'ঋণ', 'irrigation' => 'সেচ', 'share' => 'শেয়ার', 'savings' => 'সঞ্চয়'];

    public const STATUSES = ['posted' => 'বৈধ', 'cancel_pending' => 'বাতিলের অপেক্ষায়', 'cancelled' => 'বাতিল'];

    protected string $auditModule = 'payment';

    protected $auditExclude = ['verify_token'];

    protected $hidden = ['verify_token'];

    protected $fillable = [
        'payment_no', 'farmer_id', 'member_id', 'payer_name', 'date', 'amount', 'method', 'fund_account_id', 'reference', 'remarks',
        'allocation', 'status', 'verify_token', 'created_by', 'cancelled_at', 'cancel_reason', 'field_collector_id', 'field_deposit_id',
    ];

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'allocation' => 'array', 'cancelled_at' => 'datetime'];

    public function parts()
    {
        return $this->hasMany(CombinedPaymentPart::class);
    }

    /** The field collector who took the money at the farmer's door, if not at the counter. */
    public function fieldCollector()
    {
        return $this->belongsTo(User::class, 'field_collector_id')->withTrashed();
    }

    public function fieldDeposit()
    {
        return $this->belongsTo(FieldDeposit::class);
    }

    public function farmer()
    {
        return $this->belongsTo(Farmer::class)->withTrashed();
    }

    public function member()
    {
        return $this->belongsTo(Member::class);
    }

    public function fund()
    {
        return $this->belongsTo(Account::class, 'fund_account_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
