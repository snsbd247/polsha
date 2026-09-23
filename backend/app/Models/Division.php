<?php

namespace App\Models;

class Division extends Location
{
    public function districts()
    {
        return $this->hasMany(District::class);
    }
}
