<?php

namespace App\Models;

class District extends Location
{
    public static function parentKey(): ?string
    {
        return 'division_id';
    }

    public function division()
    {
        return $this->belongsTo(Division::class);
    }

    public function upazilas()
    {
        return $this->hasMany(Upazila::class);
    }
}
