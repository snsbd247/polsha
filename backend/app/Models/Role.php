<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Spatie\Permission\Models\Role as SpatieRole;
use Spatie\Permission\PermissionRegistrar;

class Role extends SpatieRole
{
    use Auditable;

    protected string $auditModule = 'role';

    protected $casts = ['is_system' => 'boolean'];

    /**
     * Spatie resolves the user model from the current default guard, which is
     * "sanctum" (no provider) inside API requests — so withCount('users')
     * would fail. There is only one user model, so name it directly.
     */
    public function users(): BelongsToMany
    {
        return $this->morphedByMany(
            User::class,
            'model',
            config('permission.table_names.model_has_roles'),
            app(PermissionRegistrar::class)->pivotRole,
            config('permission.column_names.model_morph_key')
        );
    }
}
