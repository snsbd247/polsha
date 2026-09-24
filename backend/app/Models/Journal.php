<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Journal extends Model
{
    use Auditable;

    public const TYPES = [
        'journal' => 'জার্নাল',
        'opening' => 'প্রারম্ভিক জের',
        'receipt' => 'প্রাপ্তি',
        'payment' => 'পরিশোধ',
        'contra' => 'কন্ট্রা (স্থানান্তর)',
    ];

    public const STATUSES = [
        'pending' => 'অনুমোদনের অপেক্ষায়',
        'posted' => 'পোস্টেড',
        'rejected' => 'প্রত্যাখ্যাত',
        'returned' => 'ফেরত',
        'reversed' => 'রিভার্সড',
    ];

    public const SEQUENCES = [
        'journal' => 'journal_voucher', 'opening' => 'journal_voucher',
        'receipt' => 'receipt_voucher', 'payment' => 'payment_voucher', 'contra' => 'contra_voucher',
    ];

    protected string $auditModule = 'accounting';

    protected $fillable = [
        'voucher_no', 'voucher_type', 'date', 'narration', 'module', 'source_type', 'source_id', 'period_id',
        'status', 'amount', 'reversal_of_id', 'reversed_by_id', 'approval_request_id', 'created_by', 'posted_by', 'posted_at',
    ];

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'posted_at' => 'datetime'];

    public function lines()
    {
        return $this->hasMany(JournalLine::class)->orderBy('id');
    }

    public function source()
    {
        return $this->morphTo();
    }

    public function period()
    {
        return $this->belongsTo(AccountingPeriod::class, 'period_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function poster()
    {
        return $this->belongsTo(User::class, 'posted_by')->withTrashed();
    }

    public function reversalOf()
    {
        return $this->belongsTo(self::class, 'reversal_of_id');
    }

    public function reversedBy()
    {
        return $this->belongsTo(self::class, 'reversed_by_id');
    }

    public function approvalRequest()
    {
        return $this->belongsTo(ApprovalRequest::class);
    }
}
