<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class MemberTransaction extends Model
{
    use Auditable;

    public const TYPES = [
        'savings' => [
            'opening' => 'প্রারম্ভিক জের', 'deposit' => 'সঞ্চয় জমা', 'withdrawal' => 'উত্তোলন', 'adjustment' => 'সমন্বয়',
            'profit' => 'মুনাফা', 'dividend' => 'লভ্যাংশ',
        ],
        'share' => [
            'opening' => 'প্রারম্ভিক জের', 'purchase' => 'শেয়ার ক্রয়', 'transfer_in' => 'হস্তান্তর (প্রাপ্ত)',
            'transfer_out' => 'হস্তান্তর (প্রদত্ত)', 'adjustment' => 'সমন্বয়',
        ],
    ];

    public const STATUSES = [
        'pending' => 'অনুমোদনের অপেক্ষায়', 'posted' => 'পোস্টেড', 'rejected' => 'প্রত্যাখ্যাত',
        'cancel_pending' => 'বাতিলের অপেক্ষায়', 'cancelled' => 'বাতিলকৃত',
    ];

    public const DIRECTIONS = ['in' => 'জমা (+)', 'out' => 'খরচ (−)'];

    /** Types that must wait for approval before they touch the balance. */
    public const NEEDS_APPROVAL = ['opening', 'withdrawal', 'adjustment', 'transfer_out'];

    /** Types a user can ask to cancel once posted (runs and transfers are corrected by adjustment). */
    public const CANCELLABLE = ['deposit', 'withdrawal', 'purchase', 'opening', 'adjustment'];

    protected string $auditModule = 'savings';

    public function auditModule(): string
    {
        return $this->kind === 'share' ? 'share' : 'savings';
    }

    protected $fillable = [
        'txn_no', 'member_account_id', 'kind', 'date', 'type', 'direction', 'amount', 'balance_after', 'status', 'method',
        'fund_account_id', 'counter_account_id', 'reference', 'remarks', 'pair_id', 'run_id', 'journal_id', 'approval_request_id',
        'cancel_reason', 'created_by', 'posted_at', 'cancelled_at',
    ];

    protected $casts = [
        'date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'balance_after' => 'decimal:2',
        'posted_at' => 'datetime', 'cancelled_at' => 'datetime',
    ];

    public function account()
    {
        return $this->belongsTo(MemberAccount::class, 'member_account_id');
    }

    public function fund()
    {
        return $this->belongsTo(Account::class, 'fund_account_id');
    }

    public function counterAccount()
    {
        return $this->belongsTo(Account::class, 'counter_account_id');
    }

    public function pair()
    {
        return $this->belongsTo(self::class, 'pair_id');
    }

    public function run()
    {
        return $this->belongsTo(DistributionRun::class, 'run_id');
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function signed(): float
    {
        return $this->direction === 'in' ? (float) $this->amount : -(float) $this->amount;
    }

    public function typeLabel(): string
    {
        return __(self::TYPES[$this->kind][$this->type] ?? $this->type);
    }
}
