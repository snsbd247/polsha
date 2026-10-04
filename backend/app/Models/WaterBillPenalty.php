<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A penalty the collector added at the counter; reversed if its receipt is cancelled. */
class WaterBillPenalty extends Model
{
    protected $fillable = ['bill_id', 'receipt_id', 'date', 'amount', 'journal_id', 'reversed_at', 'created_by'];

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'reversed_at' => 'datetime'];

    public function bill()
    {
        return $this->belongsTo(WaterBill::class, 'bill_id');
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }
}
