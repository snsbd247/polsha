<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    use Auditable, HasApiTokens, HasFactory, HasRoles, Notifiable, SoftDeletes;

    protected string $auditModule = 'user';

    protected array $auditExclude = ['failed_attempts', 'locked_until', 'last_login_at'];

    protected $fillable = [
        'name_bn', 'name_en', 'username', 'mobile', 'email', 'photo', 'password',
        'is_active', 'must_change_password', 'locale',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'is_active' => 'boolean',
            'must_change_password' => 'boolean',
            'locked_until' => 'datetime',
            'last_login_at' => 'datetime',
        ];
    }

    public function isSuperAdmin(): bool
    {
        return $this->hasRole('super_admin');
    }

    public function isLocked(): bool
    {
        return $this->locked_until !== null && $this->locked_until->isFuture();
    }

    public function loginLogs()
    {
        return $this->hasMany(LoginLog::class);
    }

    /** Permission names the frontend uses to show/hide menus and buttons. */
    public function permissionNames(): array
    {
        if ($this->isSuperAdmin()) {
            return Permission::pluck('name')->all();
        }

        return $this->getAllPermissions()->pluck('name')->values()->all();
    }
}
