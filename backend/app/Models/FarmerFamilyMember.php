<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FarmerFamilyMember extends Model
{
    protected $fillable = ['farmer_id', 'name', 'relation', 'occupation', 'mobile', 'sort'];

    public function farmer()
    {
        return $this->belongsTo(Farmer::class);
    }
}
