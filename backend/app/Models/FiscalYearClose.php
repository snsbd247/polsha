<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class FiscalYearClose extends Model
{
    use Auditable;

    protected string $auditModule = 'accounting';

    protected $fillable = ['fiscal_year', 'start_date', 'end_date', 'income_total', 'expense_total', 'surplus', 'journal_id', 'note', 'closed_by', 'closed_at'];

    protected $casts = [
        'start_date' => 'date:Y-m-d', 'end_date' => 'date:Y-m-d', 'closed_at' => 'datetime',
        'income_total' => 'decimal:2', 'expense_total' => 'decimal:2', 'surplus' => 'decimal:2',
    ];

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function closer()
    {
        return $this->belongsTo(User::class, 'closed_by')->withTrashed();
    }
}
