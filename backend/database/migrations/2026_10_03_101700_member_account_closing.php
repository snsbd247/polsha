<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Closing a savings / share account: the balance must be zero, the request
 * goes to the manager, and a closed account keeps its history but takes no
 * new transactions. A cancelled membership closes the accounts the same way.
 */
return new class extends Migration
{
    private const RULES = [
        ['savings.account_close', 'savings', 'সঞ্চয় হিসাব বন্ধ'],
        ['share.account_close', 'share', 'শেয়ার হিসাব বন্ধ'],
    ];

    public function up(): void
    {
        Schema::table('member_accounts', function (Blueprint $table) {
            $table->date('closed_on')->nullable()->after('status');
            $table->string('close_reason', 300)->nullable()->after('closed_on');
            // request = closed on request; membership = the membership was cancelled
            $table->string('close_kind', 20)->nullable()->after('close_reason');
            $table->foreignId('close_request_id')->nullable()->after('close_kind')->constrained('approval_requests')->nullOnDelete();
        });

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
        Schema::table('member_accounts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('close_request_id');
            $table->dropColumn(['closed_on', 'close_reason', 'close_kind']);
        });
    }
};
