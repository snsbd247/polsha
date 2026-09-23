<?php

namespace App\Models;

class Upazila extends Location
{
    public static function parentKey(): ?string
    {
        return 'district_id';
    }

    public function district()
    {
        return $this->belongsTo(District::class);
    }

    public function unions()
    {
        return $this->hasMany(Union::class);
    }
}
