<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Starter chart of accounts, voucher sequences and approval rules. Done as a
 * migration so the already-deployed database gets them too. Accounts with a
 * `key` are posted to by code; the rest can be edited freely.
 */
return new class extends Migration
{
    public function up(): void
    {
        // [code, key, name_bn, name_en, type, parent code, postable, system]
        $accounts = [
            ['1000', null, 'সম্পদ', 'Assets', 'asset', null, false, true],
            ['1100', 'cash_in_hand', 'হাতে নগদ', 'Cash in Hand', 'asset', '1000', false, true],
            ['1111', 'cash_irrigation', 'সেচের নগদ', 'Irrigation Cash', 'asset', '1100', true, true],
            ['1112', 'cash_society', 'সমিতির নগদ', 'Society Cash', 'asset', '1100', true, true],
            ['1113', 'cash_misc', 'বিবিধ নগদ', 'Miscellaneous Cash', 'asset', '1100', true, true],
            ['1200', 'bank_group', 'ব্যাংক হিসাব', 'Bank Accounts', 'asset', '1000', false, true],
            ['1300', null, 'প্রাপ্য', 'Receivables', 'asset', '1000', false, false],
            ['1310', 'accounts_receivable', 'পাওনা (প্রাপ্য হিসাব)', 'Accounts Receivable', 'asset', '1300', true, true],
            ['2000', null, 'দায়', 'Liabilities', 'liability', null, false, true],
            ['2100', 'accounts_payable', 'দেনা (প্রদেয় হিসাব)', 'Accounts Payable', 'liability', '2000', true, true],
            ['3000', null, 'মূলধন ও তহবিল', 'Equity & Funds', 'equity', null, false, true],
            ['3100', 'general_fund', 'সাধারণ তহবিল', 'General Fund', 'equity', '3000', true, true],
            ['3900', 'opening_balance_equity', 'প্রারম্ভিক জের সমন্বয়', 'Opening Balance Equity', 'equity', '3000', true, true],
            ['4000', null, 'আয়', 'Income', 'income', null, false, true],
            ['4100', 'admission_fee_income', 'ভর্তি ফি আয়', 'Admission Fee Income', 'income', '4000', true, true],
            ['4900', 'other_income', 'বিবিধ আয়', 'Other Income', 'income', '4000', true, false],
            ['5000', null, 'ব্যয়', 'Expenses', 'expense', null, false, true],
            ['5100', 'office_expense', 'অফিস খরচ', 'Office Expense', 'expense', '5000', true, false],
            ['5200', 'bank_charges', 'ব্যাংক চার্জ', 'Bank Charges', 'expense', '5000', true, true],
            ['5900', 'other_expense', 'বিবিধ ব্যয়', 'Other Expense', 'expense', '5000', true, false],
        ];
        $ids = [];
        foreach ($accounts as [$code, $key, $bn, $en, $type, $parent, $postable, $system]) {
            $existing = DB::table('chart_of_accounts')->where('code', $code)->value('id');
            $ids[$code] = $existing ?: DB::table('chart_of_accounts')->insertGetId([
                'key' => $key, 'code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'type' => $type,
                'parent_id' => $parent ? $ids[$parent] : null, 'is_postable' => $postable, 'is_system' => $system,
                'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $sequences = [
            ['journal_voucher', 'জার্নাল ভাউচার', 'JV-{YYYY}-'],
            ['receipt_voucher', 'প্রাপ্তি ভাউচার', 'RV-{YYYY}-'],
            ['payment_voucher', 'পরিশোধ ভাউচার', 'PV-{YYYY}-'],
            ['contra_voucher', 'কন্ট্রা ভাউচার', 'CV-{YYYY}-'],
        ];
        foreach ($sequences as [$key, $label, $prefix]) {
            if (! DB::table('sequences')->where('key', $key)->exists()) {
                DB::table('sequences')->insert([
                    'key' => $key, 'label' => $label, 'prefix' => $prefix, 'pad_length' => 5,
                    'next_value' => 1, 'reset_yearly' => true, 'current_year' => (int) date('Y'),
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        $rules = [
            ['accounting.journal', 'জার্নাল এন্ট্রি অনুমোদন'],
            ['accounting.reversal', 'ভাউচার বাতিল (রিভার্সাল)'],
        ];
        foreach ($rules as [$key, $label]) {
            if (! DB::table('approval_rules')->where('action_key', $key)->exists()) {
                DB::table('approval_rules')->insert([
                    'action_key' => $key, 'module' => 'accounting', 'label' => $label,
                    'steps' => json_encode([['manager']]), 'enabled' => true,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        DB::table('approval_rules')->whereIn('action_key', ['accounting.journal', 'accounting.reversal'])->delete();
        DB::table('sequences')->whereIn('key', ['journal_voucher', 'receipt_voucher', 'payment_voucher', 'contra_voucher'])->delete();
    }
};
