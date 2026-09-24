<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Receipt extends Model
{
    use Auditable;

    public const METHODS = ['cash' => 'নগদ', 'bank' => 'ব্যাংক', 'other' => 'অন্যান্য (মোবাইল ব্যাংকিং ইত্যাদি)'];

    public const STATUSES = ['active' => 'বৈধ', 'cancel_pending' => 'বাতিলের অপেক্ষায়', 'cancelled' => 'বাতিল'];

    /** Receipt module → the cash stream its cash lands in. */
    public const MODULES = ['irrigation' => 'সেচ'];

    public const CASH_ACCOUNT = ['irrigation' => 'cash_irrigation', 'savings' => 'cash_society', 'share' => 'cash_society', 'loan' => 'cash_society'];

    protected string $auditModule = 'payment';

    protected $auditExclude = ['verify_token'];

    protected $hidden = ['verify_token'];

    protected $fillable = [
        'receipt_no', 'module', 'farmer_id', 'payer_name', 'date', 'amount', 'method', 'fund_account_id', 'reference',
        'is_legacy', 'legacy_no', 'status', 'remarks', 'verify_token', 'journal_id', 'created_by',
        'cancelled_at', 'cancelled_by', 'cancel_reason', 'import_batch_id',
    ];

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'is_legacy' => 'boolean', 'cancelled_at' => 'datetime'];

    public function items()
    {
        return $this->hasMany(ReceiptItem::class);
    }

    public function farmer()
    {
        return $this->belongsTo(Farmer::class)->withTrashed();
    }

    public function fund()
    {
        return $this->belongsTo(Account::class, 'fund_account_id');
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function canceller()
    {
        return $this->belongsTo(User::class, 'cancelled_by')->withTrashed();
    }
}
