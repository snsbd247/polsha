<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LandOwner extends Model
{
    protected $fillable = ['land_id', 'farmer_id', 'share_percent', 'start_date', 'end_date', 'remarks', 'created_by'];

    protected $casts = ['share_percent' => 'decimal:2', 'start_date' => 'date:Y-m-d', 'end_date' => 'date:Y-m-d'];

    public function farmer()
    {
        return $this->belongsTo(Farmer::class)->withTrashed();
    }

    public function land()
    {
        return $this->belongsTo(Land::class);
    }
}
