<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** Residential / commercial / institutional: each with its fixed monthly fee. */
class WaterConnectionType extends Model
{
    use Auditable;

    protected string $auditModule = 'water';

    protected $fillable = ['code', 'name_bn', 'name_en', 'monthly_fee', 'connection_fee', 'is_active', 'sort_order'];

    protected $casts = ['monthly_fee' => 'decimal:2', 'connection_fee' => 'decimal:2', 'is_active' => 'boolean'];

    public function connections()
    {
        return $this->hasMany(WaterConnection::class, 'type_id');
    }
}
