<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 8 reference data: fixed-asset ledger accounts, asset categories
 * with their useful life, combined-receipt / asset numbers and the approval
 * rules for reopening a closed day, disposing of an asset and cancelling a
 * combined receipt.
 */
return new class extends Migration
{
    private const RULES = [
        ['cash.day_reopen', 'cash', 'বন্ধ দিন খোলা'],
        ['asset.disposal', 'asset', 'সম্পদ বিক্রয়/বাতিল'],
        ['payment.combined_cancel', 'payment', 'সমন্বিত রশিদ বাতিল'],
    ];

    private const SEQUENCES = [
        ['combined_payment', 'সমন্বিত রশিদ', 'CP-{YYYY}-', 6, true],
        ['asset', 'সম্পদ নম্বর', 'AST-', 5, false],
    ];

    public function up(): void
    {
        // [code, key, name_bn, name_en, type, parent code, postable]
        $accounts = [
            ['1500', 'fixed_asset_group', 'স্থায়ী সম্পদ', 'Fixed Assets', 'asset', '1000', false],
            ['1510', 'fixed_assets', 'স্থায়ী সম্পদ (ক্রয়মূল্য)', 'Fixed Assets (Cost)', 'asset', '1500', true],
            ['1590', 'accumulated_depreciation', 'পুঞ্জীভূত অবচয়', 'Accumulated Depreciation', 'asset', '1500', true],
            ['4500', 'asset_sale_gain', 'সম্পদ বিক্রয়ে লাভ', 'Gain on Sale of Assets', 'income', '4000', true],
            ['5400', 'depreciation_expense', 'অবচয় ব্যয়', 'Depreciation Expense', 'expense', '5000', true],
            ['5500', 'asset_repair_expense', 'সম্পদ মেরামত ও রক্ষণাবেক্ষণ', 'Asset Repair & Maintenance', 'expense', '5000', true],
            ['5600', 'asset_disposal_loss', 'সম্পদ বিক্রয়/বাতিলে ক্ষতি', 'Loss on Disposal of Assets', 'expense', '5000', true],
        ];
        foreach ($accounts as [$code, $key, $bn, $en, $type, $parent, $postable]) {
            if (DB::table('chart_of_accounts')->where('key', $key)->exists()) {
                continue;
            }
            while (DB::table('chart_of_accounts')->where('code', $code)->exists()) {
                $code = (string) ((int) $code + 1);
            }
            DB::table('chart_of_accounts')->insert([
                'key' => $key, 'code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'type' => $type,
                'parent_id' => DB::table('chart_of_accounts')->where('code', $parent)->value('id'),
                'is_postable' => $postable, 'is_system' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        // [code, bn, en, life months]
        $categories = [
            ['BLD', 'ভবন ও অবকাঠামো', 'Buildings & Structures', 480],
            ['PUMP', 'সেচ পাম্প ও মোটর', 'Irrigation Pumps & Motors', 120],
            ['PIPE', 'পাইপলাইন ও নালা', 'Pipelines & Channels', 180],
            ['ELEC', 'বৈদ্যুতিক সরঞ্জাম', 'Electrical Equipment', 96],
            ['FURN', 'আসবাবপত্র', 'Furniture', 120],
            ['OFFICE', 'কম্পিউটার ও অফিস সরঞ্জাম', 'Computers & Office Equipment', 60],
            ['VEH', 'যানবাহন', 'Vehicles', 96],
        ];
        foreach ($categories as [$code, $bn, $en, $life]) {
            if (! DB::table('asset_categories')->where('code', $code)->exists()) {
                DB::table('asset_categories')->insert([
                    'code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'life_months' => $life, 'salvage_percent' => 0,
                    'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
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
    }

    public function down(): void
    {
        DB::table('approval_rules')->whereIn('action_key', array_column(self::RULES, 0))->delete();
        DB::table('sequences')->whereIn('key', array_column(self::SEQUENCES, 0))->delete();
    }
};
