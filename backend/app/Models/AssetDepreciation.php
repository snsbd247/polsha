<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AssetDepreciation extends Model
{
    protected $fillable = ['asset_id', 'period', 'amount', 'accumulated_after', 'book_value_after', 'journal_id'];

    protected $casts = ['amount' => 'decimal:2', 'accumulated_after' => 'decimal:2', 'book_value_after' => 'decimal:2'];

    public function asset()
    {
        return $this->belongsTo(Asset::class);
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }
}
