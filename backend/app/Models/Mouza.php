<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Mouza extends Model
{
    use Auditable;

    protected string $auditModule = 'mouza';

    protected $fillable = ['union_id', 'upazila_id', 'name_bn', 'name_en', 'jl_no', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function union()
    {
        return $this->belongsTo(Union::class);
    }

    public function upazila()
    {
        return $this->belongsTo(Upazila::class);
    }

    public function villages()
    {
        return $this->belongsToMany(Village::class);
    }
}
