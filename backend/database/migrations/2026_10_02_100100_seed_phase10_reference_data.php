<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Phase 10 reference data: rolling an import back is an admin decision.
 */
return new class extends Migration
{
    private const RULES = [
        ['import.rollback', 'import', 'ইমপোর্ট রোলব্যাক', [['admin']]],
    ];

    public function up(): void
    {
        foreach (self::RULES as [$key, $module, $label, $steps]) {
            if (! DB::table('approval_rules')->where('action_key', $key)->exists()) {
                DB::table('approval_rules')->insert([
                    'action_key' => $key, 'module' => $module, 'label' => $label,
                    'steps' => json_encode($steps), 'enabled' => true,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        // older installations: make sure the admin can ask for a rollback
        if (DB::table('permissions')->exists() && $roleId = DB::table('roles')->where('name', 'admin')->value('id')) {
            app(PermissionRegistrar::class)->forgetCachedPermissions();
            $permId = Permission::findOrCreate('import.admin', 'web')->id;
            DB::table('role_has_permissions')->insertOrIgnore(['permission_id' => $permId, 'role_id' => $roleId]);
            app(PermissionRegistrar::class)->forgetCachedPermissions();
        }
    }

    public function down(): void
    {
        DB::table('approval_rules')->whereIn('action_key', array_column(self::RULES, 0))->delete();
    }
};
