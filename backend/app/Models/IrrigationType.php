<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class IrrigationType extends Model
{
    use Auditable;

    protected string $auditModule = 'irrigation';

    protected $fillable = ['name_bn', 'code', 'description', 'is_active', 'sort_order'];

    protected $casts = ['is_active' => 'boolean'];

    public function lands()
    {
        return $this->hasMany(Land::class);
    }

    public function rates()
    {
        return $this->hasMany(IrrigationRate::class);
    }
}
