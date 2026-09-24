<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Loan reference data for existing databases: ledger accounts (principal,
 * interest and penalty kept apart), loan / payment numbers and approval
 * rules. Repayments ride on payment.create, so cashiers need no new permission.
 */
return new class extends Migration
{
    private const RULES = [
        ['loan.application', 'loan', 'ঋণ আবেদন অনুমোদন'],
        ['loan.payment_cancel', 'loan', 'ঋণ পরিশোধ বাতিল'],
    ];

    private const SEQUENCES = [
        ['loan', 'ঋণ নম্বর', 'LN-{YYYY}-', 5, true],
        ['loan_payment', 'ঋণ পরিশোধ', 'LP-{YYYY}-', 6, true],
    ];

    public function up(): void
    {
        // [code, key, name_bn, name_en, type, parent code]
        $accounts = [
            ['1330', 'loans_receivable', 'সদস্যদের ঋণ (আসল)', 'Loans to Members (Principal)', 'asset', '1300'],
            ['4300', 'loan_interest_income', 'ঋণের সুদ আয়', 'Loan Interest Income', 'income', '4000'],
            ['4400', 'loan_penalty_income', 'ঋণের জরিমানা আয়', 'Loan Penalty Income', 'income', '4000'],
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

    }

    public function down(): void
    {
        DB::table('approval_rules')->whereIn('action_key', array_column(self::RULES, 0))->delete();
        DB::table('sequences')->whereIn('key', array_column(self::SEQUENCES, 0))->delete();
    }
};
