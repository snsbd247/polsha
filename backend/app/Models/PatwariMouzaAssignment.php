<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PatwariMouzaAssignment extends Model
{
    protected $fillable = ['patwari_id', 'mouza_id', 'start_date', 'end_date'];

    protected $casts = ['start_date' => 'date:Y-m-d', 'end_date' => 'date:Y-m-d'];

    public function mouza()
    {
        return $this->belongsTo(Mouza::class);
    }
}
