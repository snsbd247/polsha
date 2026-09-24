<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CombinedPaymentPart extends Model
{
    public $timestamps = false;

    protected $fillable = ['combined_payment_id', 'module', 'amount', 'source_type', 'source_id', 'description'];

    protected $casts = ['amount' => 'decimal:2'];

    public function combined()
    {
        return $this->belongsTo(CombinedPayment::class, 'combined_payment_id');
    }

    public function source()
    {
        return $this->morphTo();
    }
}
