<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Reference data that already-deployed databases need too (seeders only run
 * on the first deploy): the land ID sequence, starter land types, and
 * import permissions for roles that do data entry.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! DB::table('sequences')->where('key', 'land')->exists()) {
            DB::table('sequences')->insert([
                'key' => 'land', 'label' => 'Land ID', 'prefix' => 'L-', 'pad_length' => 6,
                'next_value' => 1, 'reset_yearly' => false, 'current_year' => (int) date('Y'),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        if (DB::table('land_types')->doesntExist()) {
            $types = [
                ['উঁচু জমি', 'উঁচু'], ['মাঝারি উঁচু জমি', 'মাঝারি'], ['মাঝারি নিচু জমি', 'মাঝারি'],
                ['নিচু জমি', 'নিচু'], ['বসতভিটা', 'অকৃষি'], ['পুকুর/জলাশয়', 'অকৃষি'],
            ];
            foreach ($types as $i => [$name, $cat]) {
                DB::table('land_types')->insert([
                    'name_bn' => $name, 'category' => $cat, 'is_active' => true, 'sort_order' => $i + 1,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        // Permissions exist from the phase-1 seeder; only attach where the roles exist.
        if (DB::table('permissions')->exists()) {
            app(PermissionRegistrar::class)->forgetCachedPermissions();
            $grant = [
                'admin' => ['import.view', 'import.create'],
                'manager' => ['import.view', 'import.create', 'land.approve'],
                'data_entry' => ['import.view', 'import.create'],
                'irrigation_officer' => ['land.view'],
            ];
            foreach ($grant as $roleName => $perms) {
                $roleId = DB::table('roles')->where('name', $roleName)->value('id');
                if (! $roleId) {
                    continue;
                }
                foreach ($perms as $perm) {
                    $permId = Permission::findOrCreate($perm, 'web')->id;
                    DB::table('role_has_permissions')->insertOrIgnore(['permission_id' => $permId, 'role_id' => $roleId]);
                }
            }
            app(PermissionRegistrar::class)->forgetCachedPermissions();
        }
    }

    public function down(): void
    {
        DB::table('sequences')->where('key', 'land')->delete();
    }
};
