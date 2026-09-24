<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

class RolePermissionSeeder extends Seeder
{
    private const OPERATIONS = ['farmer', 'membership', 'member', 'patwari', 'land', 'irrigation', 'savings', 'share', 'loan', 'payment', 'cash', 'bank', 'accounting', 'asset', 'report'];

    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        $modules = array_keys(config('erp.modules'));
        $actions = array_keys(config('erp.actions'));
        foreach ($modules as $m) {
            foreach ($actions as $a) {
                Permission::findOrCreate("$m.$a", 'web');
            }
        }

        foreach (config('erp.roles') as $name => $meta) {
            $role = Role::firstOrCreate(['name' => $name, 'guard_name' => 'web']);
            $role->update($meta + ['is_system' => true]);

            // Only seed defaults for a role that has none, so edits made in
            // the permission matrix survive re-running the seeder.
            if ($name !== 'super_admin' && $role->permissions()->doesntExist()) {
                $role->syncPermissions($this->defaults($name, $modules));
            }
        }
    }

    private function defaults(string $role, array $modules): array
    {
        $p = fn (array $mods, array $acts) => collect($mods)->crossJoin($acts)->map(fn ($x) => "$x[0].$x[1]")->all();
        $system = ['user', 'role', 'audit', 'approval', 'location', 'mouza', 'settings', 'import'];

        return array_values(array_unique(match ($role) {
            'admin' => array_merge(
                $p($system, ['view', 'create', 'edit', 'delete', 'export', 'admin']),
                $p($modules, ['view', 'export']),
            ),
            'president' => array_merge($p($modules, ['view', 'export']), $p(self::OPERATIONS, ['approve'])),
            'manager' => array_merge(
                $p(self::OPERATIONS, ['view', 'create', 'edit', 'export', 'approve']),
                $p(['location', 'mouza'], ['view', 'create', 'edit']),
                ['audit.view', 'user.view', 'import.view', 'import.create'],
            ),
            'accountant' => array_merge(
                $p(['accounting', 'cash', 'bank', 'payment'], ['view', 'create', 'edit', 'export']),
                $p(['savings', 'share'], ['create']),
                $p(['farmer', 'member', 'irrigation', 'savings', 'share', 'loan', 'report'], ['view', 'export']),
            ),
            'cashier' => array_merge(
                $p(['payment', 'cash', 'savings', 'share'], ['view', 'create']),
                $p(['farmer', 'member', 'irrigation', 'loan'], ['view']),
            ),
            'irrigation_officer' => array_merge(
                $p(['irrigation', 'land'], ['view', 'create', 'edit', 'export']),
                $p(['payment'], ['view', 'create']),
                $p(['farmer', 'member', 'mouza', 'patwari', 'report'], ['view']),
            ),
            'member_officer' => array_merge(
                $p(['farmer', 'membership', 'member', 'patwari'], ['view', 'create', 'edit', 'export']),
                $p(['land', 'mouza', 'report'], ['view']),
            ),
            'loan_officer' => array_merge(
                $p(['loan'], ['view', 'create', 'edit', 'export']),
                $p(['farmer', 'member', 'savings', 'share', 'report'], ['view']),
            ),
            'asset_officer' => array_merge($p(['asset'], ['view', 'create', 'edit', 'export']), ['report.view']),
            'auditor' => $p($modules, ['view', 'export']),
            'data_entry' => array_merge(
                $p(['farmer', 'land', 'membership'], ['view', 'create', 'edit']),
                $p(['member', 'mouza', 'patwari'], ['view']),
                ['import.view', 'import.create'],
            ),
            default => [],
        }));
    }
}
