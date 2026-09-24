<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BankStatementLine extends Model
{
    protected $fillable = ['reconciliation_id', 'date', 'description', 'reference', 'amount', 'journal_line_id'];

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2'];

    public function reconciliation()
    {
        return $this->belongsTo(BankReconciliation::class, 'reconciliation_id');
    }

    public function journalLine()
    {
        return $this->belongsTo(JournalLine::class);
    }
}
