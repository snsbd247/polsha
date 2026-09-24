<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReceiptItem extends Model
{
    public $timestamps = false;

    protected $fillable = ['receipt_id', 'payable_type', 'payable_id', 'description', 'amount', 'due_after'];

    protected $casts = ['amount' => 'decimal:2', 'due_after' => 'decimal:2'];

    public function receipt()
    {
        return $this->belongsTo(Receipt::class);
    }

    public function payable()
    {
        return $this->morphTo();
    }
}
