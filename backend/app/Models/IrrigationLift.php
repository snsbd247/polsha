<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** A pumping stage (1st, 2nd, 3rd lift …); the lift a land sits on sets its irrigation rate. */
class IrrigationLift extends Model
{
    use Auditable;

    protected string $auditModule = 'irrigation';

    protected $fillable = ['code', 'name_bn', 'name_en', 'description', 'is_active', 'sort_order'];

    protected $casts = ['is_active' => 'boolean'];

    public function lands()
    {
        return $this->hasMany(Land::class, 'lift_id');
    }

    public function rates()
    {
        return $this->hasMany(IrrigationRate::class, 'lift_id');
    }
}
