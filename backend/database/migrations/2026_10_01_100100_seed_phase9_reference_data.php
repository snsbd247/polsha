<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 9 reference data: the accumulated-surplus equity account that the
 * year-end close sweeps income and expense into, the public payment
 * request number, and the default SMS templates.
 */
return new class extends Migration
{
    private const SEQUENCES = [
        ['public_payment', 'অনলাইন পেমেন্ট অনুরোধ', 'OPR-{YYYY}-', 5, true],
    ];

    // [key, name_bn, name_en, body, variables]
    private const TEMPLATES = [
        ['otp', 'পাসওয়ার্ড রিসেট কোড', 'Password reset code',
            'আপনার পাসওয়ার্ড রিসেট কোড {code}। {minutes} মিনিট বৈধ। কাউকে জানাবেন না। — {society}', ['code', 'minutes', 'society']],
        ['payment', 'পেমেন্ট নিশ্চিতকরণ', 'Payment confirmation',
            '{name}, আপনার {amount} টাকা জমা হয়েছে। রশিদ নং {receipt_no}, তারিখ {date}। ধন্যবাদ — {society}', ['name', 'amount', 'receipt_no', 'date', 'society']],
        ['savings', 'সঞ্চয় জমা নিশ্চিতকরণ', 'Savings confirmation',
            '{name}, আপনার হিসাব {account_no}-এ {amount} টাকা জমা হয়েছে। বর্তমান স্থিতি {balance} টাকা। — {society}', ['name', 'account_no', 'amount', 'balance', 'society']],
        ['irrigation_due', 'সেচ বিল বকেয়া স্মরণ', 'Irrigation due reminder',
            '{name}, {season} মৌসুমের সেচ বিল {amount} টাকা বকেয়া, শেষ তারিখ {due_date}। — {society}', ['name', 'season', 'amount', 'due_date', 'society']],
        ['loan_due', 'ঋণের কিস্তি স্মরণ', 'Loan installment reminder',
            '{name}, ঋণ {loan_no}-এর কিস্তি {amount} টাকা {due_date} তারিখে পরিশোধযোগ্য। — {society}', ['name', 'loan_no', 'amount', 'due_date', 'society']],
        ['public_payment_verified', 'অনলাইন পেমেন্ট গৃহীত', 'Online payment accepted',
            '{name}, আপনার {method} পেমেন্ট {amount} টাকা (TrxID {trx_id}) গৃহীত হয়েছে। রশিদ নং {receipt_no}। — {society}', ['name', 'method', 'amount', 'trx_id', 'receipt_no', 'society']],
        ['public_payment_rejected', 'অনলাইন পেমেন্ট বাতিল', 'Online payment rejected',
            '{name}, আপনার {method} পেমেন্ট অনুরোধ (TrxID {trx_id}) গ্রহণ করা যায়নি: {reason}। অফিসে যোগাযোগ করুন। — {society}', ['name', 'method', 'trx_id', 'reason', 'society']],
    ];

    public function up(): void
    {
        if (! DB::table('chart_of_accounts')->where('key', 'accumulated_surplus')->exists()) {
            $code = '3400';
            while (DB::table('chart_of_accounts')->where('code', $code)->exists()) {
                $code = (string) ((int) $code + 1);
            }
            DB::table('chart_of_accounts')->insert([
                'key' => 'accumulated_surplus', 'code' => $code, 'name_bn' => 'পুঞ্জীভূত উদ্বৃত্ত (সংরক্ষিত তহবিল)', 'name_en' => 'Accumulated Surplus',
                'type' => 'equity', 'parent_id' => DB::table('chart_of_accounts')->where('code', '3000')->value('id'),
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

        foreach (self::TEMPLATES as [$key, $bn, $en, $body, $vars]) {
            if (! DB::table('sms_templates')->where('key', $key)->exists()) {
                DB::table('sms_templates')->insert([
                    'key' => $key, 'name_bn' => $bn, 'name_en' => $en, 'body' => $body, 'variables' => json_encode($vars),
                    'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        DB::table('sequences')->whereIn('key', array_column(self::SEQUENCES, 0))->delete();
        DB::table('chart_of_accounts')->where('key', 'accumulated_surplus')->delete();
    }
};
