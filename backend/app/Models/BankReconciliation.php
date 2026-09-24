<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class BankReconciliation extends Model
{
    use Auditable;

    public const STATUSES = ['draft' => 'চলমান', 'finalized' => 'চূড়ান্ত'];

    protected string $auditModule = 'bank';

    protected $fillable = [
        'bank_account_id', 'period', 'statement_opening', 'statement_closing', 'book_closing', 'status', 'note',
        'created_by', 'finalized_by', 'finalized_at',
    ];

    protected $casts = [
        'statement_opening' => 'decimal:2', 'statement_closing' => 'decimal:2', 'book_closing' => 'decimal:2', 'finalized_at' => 'datetime',
    ];

    public function bankAccount()
    {
        return $this->belongsTo(BankAccount::class);
    }

    public function lines()
    {
        return $this->hasMany(BankStatementLine::class, 'reconciliation_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function finalizer()
    {
        return $this->belongsTo(User::class, 'finalized_by')->withTrashed();
    }

    public function startDate(): string
    {
        return Carbon::parse($this->period.'-01')->toDateString();
    }

    public function endDate(): string
    {
        return Carbon::parse($this->period.'-01')->endOfMonth()->toDateString();
    }
}
