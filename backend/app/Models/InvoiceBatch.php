<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InvoiceBatch extends Model
{
    protected $fillable = ['season_id', 'mouza_id', 'invoice_date', 'invoice_count', 'total_amount', 'skipped_count', 'created_by'];

    protected $casts = ['invoice_date' => 'date:Y-m-d', 'total_amount' => 'decimal:2'];

    public function season()
    {
        return $this->belongsTo(Season::class);
    }

    public function mouza()
    {
        return $this->belongsTo(Mouza::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
