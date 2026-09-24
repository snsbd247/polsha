<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One row of a loan's repayment schedule, with what has been paid against it. */
class LoanInstallment extends Model
{
    protected $fillable = [
        'loan_id', 'seq', 'due_date', 'principal', 'interest', 'principal_paid', 'interest_paid',
        'penalty_accrued', 'penalty_paid', 'penalty_to', 'paid_on',
    ];

    protected $casts = [
        'due_date' => 'date:Y-m-d', 'penalty_to' => 'date:Y-m-d', 'paid_on' => 'date:Y-m-d',
        'principal' => 'decimal:2', 'interest' => 'decimal:2', 'principal_paid' => 'decimal:2', 'interest_paid' => 'decimal:2',
        'penalty_accrued' => 'decimal:2', 'penalty_paid' => 'decimal:2', 'seq' => 'integer',
    ];

    public const STATE = ['loan_id', 'seq', 'principal_paid', 'interest_paid', 'penalty_accrued', 'penalty_paid', 'penalty_to', 'paid_on'];

    public function loan()
    {
        return $this->belongsTo(Loan::class);
    }

    public function principalDue(): float
    {
        return round((float) $this->principal - (float) $this->principal_paid, 2);
    }

    public function interestDue(): float
    {
        return round((float) $this->interest - (float) $this->interest_paid, 2);
    }

    /** Unpaid instalment money (principal + interest) — the base penalty runs on. */
    public function outstanding(): float
    {
        return round($this->principalDue() + $this->interestDue(), 2);
    }
}
