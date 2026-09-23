<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApprovalStep extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['roles' => 'array', 'acted_at' => 'datetime'];
    }

    public function actor()
    {
        return $this->belongsTo(User::class, 'acted_by')->withTrashed();
    }
}
