<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Savings & share reference data for existing databases: ledger accounts,
 * account / transaction numbers, approval rules and cashier permissions.
 */
return new class extends Migration
{
    private const RULES = [
        ['savings.opening', 'savings', 'সঞ্চয়ের প্রারম্ভিক জের'],
        ['savings.withdrawal', 'savings', 'সঞ্চয় উত্তোলন'],
        ['savings.adjustment', 'savings', 'সঞ্চয় সমন্বয়'],
        ['savings.txn_cancel', 'savings', 'সঞ্চয় লেনদেন বাতিল'],
        ['savings.profit', 'savings', 'সঞ্চয়ের মুনাফা বণ্টন'],
        ['share.opening', 'share', 'শেয়ারের প্রারম্ভিক জের'],
        ['share.transfer', 'share', 'শেয়ার হস্তান্তর'],
        ['share.adjustment', 'share', 'শেয়ার সমন্বয়'],
        ['share.txn_cancel', 'share', 'শেয়ার লেনদেন বাতিল'],
        ['share.dividend', 'share', 'লভ্যাংশ বণ্টন'],
    ];

    private const SEQUENCES = [
        ['savings_account', 'সঞ্চয় হিসাব নম্বর', 'SAV-', 6, false],
        ['share_account', 'শেয়ার হিসাব নম্বর', 'SHR-', 6, false],
        ['savings_txn', 'সঞ্চয় লেনদেন', 'SV-{YYYY}-', 6, true],
        ['share_txn', 'শেয়ার লেনদেন', 'SH-{YYYY}-', 6, true],
        ['distribution_run', 'মুনাফা/লভ্যাংশ বণ্টন', 'DST-{YYYY}-', 4, true],
    ];

    public function up(): void
    {
        // [code, key, name_bn, name_en, type, parent code]
        $accounts = [
            ['2200', 'savings_deposits', 'সদস্যদের সঞ্চয় আমানত', 'Members\' Savings Deposits', 'liability', '2000'],
            ['3200', 'share_capital', 'শেয়ার মূলধন', 'Share Capital', 'equity', '3000'],
            ['3300', 'dividend_distribution', 'লভ্যাংশ বণ্টন', 'Dividend Distribution', 'equity', '3000'],
            ['5300', 'savings_profit_expense', 'সঞ্চয়ের মুনাফা ব্যয়', 'Profit on Savings', 'expense', '5000'],
        ];
        foreach ($accounts as [$code, $key, $bn, $en, $type, $parent]) {
            if (DB::table('chart_of_accounts')->where('key', $key)->exists()) {
                continue;
            }
            while (DB::table('chart_of_accounts')->where('code', $code)->exists()) {
                $code = (string) ((int) $code + 1);
            }
            DB::table('chart_of_accounts')->insert([
                'key' => $key, 'code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'type' => $type,
                'parent_id' => DB::table('chart_of_accounts')->where('code', $parent)->value('id'),
                'is_postable' => true, 'is_system' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        foreach (self::SEQUENCES as [$key, $label, $prefix, $pad, $yearly]) {
            if (! DB::table('sequences')->where('key', $key)->exists()) {
                DB::table('sequences')->insert([
                    'key' => $key, 'label' => $label, 'prefix' => $prefix, 'pad_length' => $pad,
                    'next_value' => 1, 'reset_yearly' => $yearly, 'current_year' => (int) date('Y'),
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        foreach (self::RULES as [$key, $module, $label]) {
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
                'cashier' => ['savings.create', 'share.create'],
                'accountant' => ['savings.create', 'share.create'],
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
        DB::table('approval_rules')->whereIn('action_key', array_column(self::RULES, 0))->delete();
        DB::table('sequences')->whereIn('key', array_column(self::SEQUENCES, 0))->delete();
    }
};
