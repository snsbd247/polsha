<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Simpler late-payment penalty: charged once per late instalment, either a
 * fixed sum or a % of what was overdue. Loans already given keep the old
 * day-by-day % per month ("daily") so their figures do not change.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['loan_products', 'loans'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->string('penalty_type', 10)->default('percent')->after('term_months');
                $t->decimal('penalty_rate', 12, 2)->default(0)->change();
            });
        }
        DB::table('loans')->update(['penalty_type' => 'daily']);
        // new loans are flat-rate only; plans that were declining become flat for future loans
        DB::table('loan_products')->update(['interest_method' => 'flat']);
    }

    public function down(): void
    {
        foreach (['loan_products', 'loans'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->dropColumn('penalty_type'));
        }
    }
};
