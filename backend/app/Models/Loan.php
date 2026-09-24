<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Loan extends Model
{
    use Auditable;

    public const STATUSES = [
        'pending' => 'অনুমোদনের অপেক্ষায়', 'approved' => 'অনুমোদিত (বিতরণ বাকি)', 'active' => 'চলমান',
        'closed' => 'পরিশোধিত', 'rejected' => 'প্রত্যাখ্যাত', 'cancelled' => 'বাতিলকৃত',
    ];

    /** A member may hold only one loan in these states at a time. */
    public const OPEN = ['pending', 'approved', 'active'];

    protected string $auditModule = 'loan';

    protected $fillable = [
        'loan_no', 'member_id', 'product_id', 'applied_on', 'amount', 'purpose', 'interest_rate', 'interest_method', 'frequency',
        'installments', 'term_months', 'penalty_rate', 'grace_days', 'limit_amount', 'status', 'disbursed_on', 'first_due_on',
        'closed_on', 'total_interest', 'method', 'fund_account_id', 'reference', 'remarks', 'approval_request_id', 'journal_id',
        'created_by', 'disbursed_by', 'import_batch_id',
    ];

    protected $casts = [
        'applied_on' => 'date:Y-m-d', 'disbursed_on' => 'date:Y-m-d', 'first_due_on' => 'date:Y-m-d', 'closed_on' => 'date:Y-m-d',
        'amount' => 'decimal:2', 'interest_rate' => 'decimal:2', 'penalty_rate' => 'decimal:2', 'limit_amount' => 'decimal:2',
        'total_interest' => 'decimal:2', 'installments' => 'integer', 'term_months' => 'integer', 'grace_days' => 'integer',
    ];

    public function member()
    {
        return $this->belongsTo(Member::class);
    }

    public function product()
    {
        return $this->belongsTo(LoanProduct::class, 'product_id');
    }

    public function guarantors()
    {
        return $this->hasMany(LoanGuarantor::class);
    }

    public function schedule()
    {
        return $this->hasMany(LoanInstallment::class)->orderBy('seq');
    }

    public function payments()
    {
        return $this->hasMany(LoanPayment::class);
    }

    public function fund()
    {
        return $this->belongsTo(Account::class, 'fund_account_id');
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function approvalRequest()
    {
        return $this->belongsTo(ApprovalRequest::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function disburser()
    {
        return $this->belongsTo(User::class, 'disbursed_by')->withTrashed();
    }
}
