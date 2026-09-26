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
        'date_of_birth', 'nid', 'birth_reg_no', 'mobile', 'alt_mobile', 'email', 'photo', 'village_id', 'mouza_id',
        'para', 'post_office', 'post_code', 'household_id', 'household_relation', 'occupation', 'blood_group', 'education_level', 'farmer_type', 'remarks', 'is_active',
        'merged_into_id', 'created_by', 'import_batch_id', 'delete_reason', 'delete_note', 'deleted_by', 'removed_at',
    ];

    protected $casts = ['date_of_birth' => 'date:Y-m-d', 'is_active' => 'boolean', 'removed_at' => 'datetime'];

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

    public function family()
    {
        return $this->hasMany(FarmerFamilyMember::class)->orderBy('sort')->orderBy('id');
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

    /** Who deleted or merged this record away. */
    public function deleter()
    {
        return $this->belongsTo(User::class, 'deleted_by')->withTrashed();
    }

    /** Farmers that still count as real people (not merged away). */
    public function scopeLive(Builder $q): Builder
    {
        return $q->whereNull('merged_into_id');
    }
}
