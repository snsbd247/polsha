<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class LandType extends Model
{
    use Auditable;

    protected string $auditModule = 'land';

    protected $fillable = ['name_bn', 'category', 'description', 'is_active', 'sort_order'];

    protected $casts = ['is_active' => 'boolean'];

    public function lands()
    {
        return $this->hasMany(Land::class);
    }
}
