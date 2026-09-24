<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class IntegrityScan extends Model
{
    protected $fillable = ['trigger', 'total_issues', 'errors', 'results', 'created_by', 'started_at', 'finished_at'];

    protected $casts = ['results' => 'array', 'started_at' => 'datetime', 'finished_at' => 'datetime'];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
