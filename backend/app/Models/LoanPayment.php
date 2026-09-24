<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class LoanPayment extends Model
{
    use Auditable;

    public const STATUSES = ['posted' => 'পোস্টেড', 'cancel_pending' => 'বাতিলের অপেক্ষায়', 'cancelled' => 'বাতিলকৃত'];

    protected string $auditModule = 'loan';

    protected $fillable = [
        'payment_no', 'loan_id', 'date', 'amount', 'penalty', 'interest', 'principal', 'principal_after', 'method', 'fund_account_id',
        'reference', 'remarks', 'status', 'snapshot', 'journal_id', 'approval_request_id', 'cancel_reason', 'created_by', 'cancelled_at',
    ];

    protected $hidden = ['snapshot'];

    protected $casts = [
        'date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'penalty' => 'decimal:2', 'interest' => 'decimal:2', 'principal' => 'decimal:2',
        'principal_after' => 'decimal:2', 'snapshot' => 'array', 'cancelled_at' => 'datetime',
    ];

    public function loan()
    {
        return $this->belongsTo(Loan::class);
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
}
