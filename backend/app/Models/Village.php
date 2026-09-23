<?php

namespace App\Models;

class Village extends Location
{
    public static function parentKey(): ?string
    {
        return 'union_id';
    }

    public function union()
    {
        return $this->belongsTo(Union::class);
    }

    public function mouzas()
    {
        return $this->belongsToMany(Mouza::class);
    }
}
