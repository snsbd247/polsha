<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Household extends Model
{
    use Auditable;

    protected string $auditModule = 'farmer';

    protected $fillable = ['code', 'village_id', 'head_farmer_id', 'remarks'];

    public function head()
    {
        return $this->belongsTo(Farmer::class, 'head_farmer_id');
    }

    public function village()
    {
        return $this->belongsTo(Village::class);
    }

    public function farmers()
    {
        return $this->hasMany(Farmer::class)->live();
    }
}
