<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Irrigation reference data for existing databases: irrigation types,
 * receivable/income accounts, invoice & receipt numbers, approval rules
 * and the collection permission for irrigation officers.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('irrigation_types')->doesntExist()) {
            foreach (['গভীর নলকূপ', 'অগভীর নলকূপ', 'খাল/নালা', 'পাওয়ার পাম্প (এলএলপি)'] as $i => $name) {
                DB::table('irrigation_types')->insert([
                    'name_bn' => $name, 'is_active' => true, 'sort_order' => $i + 1, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        // [code, key, name_bn, name_en, type, parent code]
        $accounts = [
            ['1320', 'irrigation_receivable', 'সেচ চার্জ পাওনা', 'Irrigation Charge Receivable', 'asset', '1300'],
            ['4200', 'irrigation_income', 'সেচ চার্জ আয়', 'Irrigation Charge Income', 'income', '4000'],
        ];
        foreach ($accounts as [$code, $key, $bn, $en, $type, $parent]) {
            if (DB::table('chart_of_accounts')->where('key', $key)->exists()) {
                continue;
            }
            // Someone may already have used the code for a hand-made account.
            while (DB::table('chart_of_accounts')->where('code', $code)->exists()) {
                $code = (string) ((int) $code + 1);
            }
            DB::table('chart_of_accounts')->insert([
                'key' => $key, 'code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'type' => $type,
                'parent_id' => DB::table('chart_of_accounts')->where('code', $parent)->value('id'),
                'is_postable' => true, 'is_system' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $sequences = [
            ['irrigation_invoice', 'সেচ ইনভয়েস', 'INV-{YYYY}-', 6],
            ['money_receipt', 'টাকার রশিদ', 'MR-{YYYY}-', 6],
        ];
        foreach ($sequences as [$key, $label, $prefix, $pad]) {
            if (! DB::table('sequences')->where('key', $key)->exists()) {
                DB::table('sequences')->insert([
                    'key' => $key, 'label' => $label, 'prefix' => $prefix, 'pad_length' => $pad,
                    'next_value' => 1, 'reset_yearly' => true, 'current_year' => (int) date('Y'),
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        $rules = [
            ['irrigation.rate', 'irrigation', 'সেচের রেট অনুমোদন'],
            ['irrigation.invoice_cancel', 'irrigation', 'সেচ ইনভয়েস বাতিল'],
            ['payment.receipt_cancel', 'payment', 'রশিদ বাতিল'],
        ];
        foreach ($rules as [$key, $module, $label]) {
            if (! DB::table('approval_rules')->where('action_key', $key)->exists()) {
                DB::table('approval_rules')->insert([
                    'action_key' => $key, 'module' => $module, 'label' => $label,
                    'steps' => json_encode([['manager']]), 'enabled' => true,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        if (DB::table('permissions')->exists()) {
            app(PermissionRegistrar::class)->forgetCachedPermissions();
            $grant = [
                'irrigation_officer' => ['payment.view', 'payment.create'],
                'cashier' => ['irrigation.view'],
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
        DB::table('approval_rules')->whereIn('action_key', ['irrigation.rate', 'irrigation.invoice_cancel', 'payment.receipt_cancel'])->delete();
        DB::table('sequences')->whereIn('key', ['irrigation_invoice', 'money_receipt'])->delete();
    }
};
