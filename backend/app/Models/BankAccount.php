<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class BankAccount extends Model
{
    use Auditable;

    public const TYPES = ['current' => 'চলতি হিসাব', 'savings' => 'সঞ্চয়ী হিসাব', 'fdr' => 'এফডিআর'];

    protected string $auditModule = 'bank';

    protected $fillable = [
        'account_id', 'bank_name', 'branch_name', 'account_no', 'account_type', 'opened_on',
        'fdr_maturity_date', 'fdr_interest_rate', 'is_active', 'remarks', 'created_by',
    ];

    protected $casts = [
        'opened_on' => 'date:Y-m-d', 'fdr_maturity_date' => 'date:Y-m-d',
        'fdr_interest_rate' => 'decimal:2', 'is_active' => 'boolean',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
