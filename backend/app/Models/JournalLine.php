<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class JournalLine extends Model
{
    public $timestamps = false;

    protected $fillable = ['journal_id', 'account_id', 'debit', 'credit', 'remarks', 'reconciled_at', 'reconciled_by'];

    protected $casts = ['debit' => 'decimal:2', 'credit' => 'decimal:2', 'reconciled_at' => 'datetime'];

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
