<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Farmer extends Model
{
    use Auditable, SoftDeletes;

    protected string $auditModule = 'farmer';

    protected $fillable = [
        'farmer_code', 'name_bn', 'name_en', 'father_name', 'mother_name', 'spouse_name', 'gender',
        'date_of_birth', 'nid', 'birth_reg_no', 'mobile', 'alt_mobile', 'photo', 'village_id', 'mouza_id',
        'para', 'post_office', 'household_id', 'household_relation', 'occupation', 'remarks', 'is_active',
        'merged_into_id', 'created_by', 'import_batch_id',
    ];

    protected $casts = ['date_of_birth' => 'date:Y-m-d', 'is_active' => 'boolean'];

    public function village()
    {
        return $this->belongsTo(Village::class);
    }

    public function mouza()
    {
        return $this->belongsTo(Mouza::class);
    }

    public function household()
    {
        return $this->belongsTo(Household::class);
    }

    public function member()
    {
        return $this->hasOne(Member::class);
    }

    public function documents()
    {
        return $this->hasMany(FarmerDocument::class)->latest();
    }

    public function applications()
    {
        return $this->hasMany(MembershipApplication::class)->latest('id');
    }

    public function ownerships()
    {
        return $this->hasMany(LandOwner::class);
    }

    public function cultivations()
    {
        return $this->hasMany(LandCultivation::class);
    }

    public function mergedInto()
    {
        return $this->belongsTo(Farmer::class, 'merged_into_id');
    }

    /** Farmers that still count as real people (not merged away). */
    public function scopeLive(Builder $q): Builder
    {
        return $q->whereNull('merged_into_id');
    }
}
