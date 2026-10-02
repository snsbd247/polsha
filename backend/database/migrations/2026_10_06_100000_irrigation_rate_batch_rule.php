<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rates copied from an earlier season go for approval together: one rule,
 * with the same approvers the single-rate rule has today.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('approval_rules')->where('action_key', 'irrigation.rate_batch')->exists()) {
            return;
        }
        $single = DB::table('approval_rules')->where('action_key', 'irrigation.rate')->first();
        DB::table('approval_rules')->insert([
            'action_key' => 'irrigation.rate_batch', 'module' => 'irrigation', 'label' => 'সেচের রেট অনুমোদন (আগের মৌসুম থেকে কপি)',
            'steps' => $single->steps ?? json_encode([['manager']]), 'enabled' => $single->enabled ?? true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('approval_rules')->where('action_key', 'irrigation.rate_batch')->delete();
    }
};
