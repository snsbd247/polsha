<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** Shared behaviour for Division → District → Upazila → Union → Village. */
abstract class Location extends Model
{
    use Auditable;

    protected string $auditModule = 'location';

    protected $guarded = ['id'];

    protected $casts = ['is_active' => 'boolean'];

    /** Column pointing to the parent level, or null for the top level. */
    public static function parentKey(): ?string
    {
        return null;
    }
}
