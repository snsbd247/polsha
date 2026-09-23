<?php

namespace App\Models;

class Union extends Location
{
    public static function parentKey(): ?string
    {
        return 'upazila_id';
    }

    public function upazila()
    {
        return $this->belongsTo(Upazila::class);
    }

    public function villages()
    {
        return $this->hasMany(Village::class);
    }

    public function mouzas()
    {
        return $this->hasMany(Mouza::class);
    }
}
