<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Irrigation types (sources) get a short code, filled in for the seeded ones. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('irrigation_types', function (Blueprint $table) {
            $table->string('code', 12)->nullable()->unique()->after('name_bn');
        });

        $codes = ['গভীর নলকূপ' => 'DTW', 'অগভীর নলকূপ' => 'STW', 'খাল/নালা' => 'CANAL', 'পাওয়ার পাম্প (এলএলপি)' => 'LLP'];
        foreach (DB::table('irrigation_types')->get() as $t) {
            DB::table('irrigation_types')->where('id', $t->id)->update(['code' => $codes[$t->name_bn] ?? 'IT'.$t->id]);
        }
    }

    public function down(): void
    {
        Schema::table('irrigation_types', function (Blueprint $table) {
            $table->dropUnique(['code']);
            $table->dropColumn('code');
        });
    }
};
