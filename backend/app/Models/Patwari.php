<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Patwari extends Model
{
    use Auditable;

    protected string $auditModule = 'patwari';

    protected $fillable = ['name', 'father_name', 'mobile', 'nid', 'farmer_id', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function assignments()
    {
        return $this->hasMany(PatwariMouzaAssignment::class)->latest('start_date');
    }

    public function currentAssignments()
    {
        return $this->hasMany(PatwariMouzaAssignment::class)->whereNull('end_date');
    }

    public function farmer()
    {
        return $this->belongsTo(Farmer::class);
    }
}
