<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

class RoleController extends Controller
{
    public function index(): JsonResponse
    {
        $roles = Role::withCount('users')->orderBy('id')->get()
            ->map(fn (Role $r) => $this->row($r));

        return response()->json($roles);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $role = Role::create($data + ['name' => $this->slug($data['label']), 'guard_name' => 'web']);

        return response()->json($this->row($role->loadCount('users')), 201);
    }

    public function update(Request $request, Role $role): JsonResponse
    {
        $role->update($this->validated($request, $role));

        return response()->json($this->row($role->loadCount('users')));
    }

    public function duplicate(Role $role): JsonResponse
    {
        $copy = DB::transaction(function () use ($role) {
            $label = $role->label.' (কপি)';
            $copy = Role::create(['name' => $this->slug($label), 'label' => $label, 'description' => $role->description, 'guard_name' => 'web']);
            $copy->syncPermissions($role->permissions);

            return $copy;
        });

        return response()->json($this->row($copy->loadCount('users')), 201);
    }

    public function destroy(Role $role): JsonResponse
    {
        if ($role->is_system) {
            throw ValidationException::withMessages(['role' => 'সিস্টেম রোল মুছা যাবে না।']);
        }
        if ($role->users()->exists()) {
            throw ValidationException::withMessages(['role' => 'এই রোলে ইউজার আছে, তাই মুছা যাবে না।']);
        }
        $role->delete();

        return response()->json(['message' => 'রোল মুছে ফেলা হয়েছে।']);
    }

    /** Modules × actions grid plus the permissions this role currently holds. */
    public function permissions(Role $role): JsonResponse
    {
        return response()->json([
            'role' => $this->row($role->loadCount('users')),
            'modules' => config('erp.modules'),
            'actions' => config('erp.actions'),
            'granted' => $role->name === 'super_admin' ? Permission::pluck('name') : $role->permissions->pluck('name'),
            'locked' => $role->name === 'super_admin',
        ]);
    }

    public function syncPermissions(Request $request, Role $role): JsonResponse
    {
        if ($role->name === 'super_admin') {
            throw ValidationException::withMessages(['role' => 'সুপার অ্যাডমিনের অনুমতি পরিবর্তন করা যাবে না।']);
        }
        $data = $request->validate([
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string', 'exists:permissions,name'],
        ]);

        $before = $role->permissions->pluck('name')->sort()->values()->all();
        $role->syncPermissions($data['permissions']);
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $after = collect($data['permissions'])->sort()->values()->all();

        AuditLogger::log('role', 'permissions_change', $role,
            ['removed' => array_values(array_diff($before, $after))],
            ['added' => array_values(array_diff($after, $before))]);

        return response()->json(['message' => 'অনুমতি সংরক্ষণ হয়েছে।', 'granted' => $after]);
    }

    private function validated(Request $request, ?Role $role = null): array
    {
        return $request->validate([
            'label' => ['required', 'string', 'max:100', Rule::unique('roles', 'label')->ignore($role)],
            'description' => ['nullable', 'string', 'max:500'],
        ]);
    }

    private function slug(string $label): string
    {
        $base = Str::slug(Str::ascii($label), '_') ?: 'role';
        $name = $base;
        $i = 1;
        while (Role::where('name', $name)->exists()) {
            $name = $base.'_'.++$i;
        }

        return $name;
    }

    private function row(Role $r): array
    {
        return [
            'id' => $r->id,
            'name' => $r->name,
            'label' => $r->label,
            'description' => $r->description,
            'is_system' => $r->is_system,
            'users_count' => $r->users_count ?? 0,
        ];
    }
}
