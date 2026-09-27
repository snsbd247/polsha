<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('land_cultivations', function (Blueprint $table) {
            // borga/lease: the cultivator's share of the crop, and when the agreement is due to end
            $table->decimal('share_percent', 5, 2)->nullable()->after('terms');
            $table->date('contract_end')->nullable()->after('start_date');
        });

        // Until now the share lived in the terms text ("ফসলের অর্ধেক", "ফসলের ৫০%"); carry it over where it can be read.
        $bn = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
        foreach (DB::table('land_cultivations')->whereIn('type', ['borga', 'lease'])->whereNotNull('terms')->get(['id', 'terms']) as $c) {
            $t = str_replace($bn, range(0, 9), $c->terms);
            $share = preg_match('/(\d{1,3}(?:\.\d+)?)\s*%/u', $t, $m) ? (float) $m[1]
                : (str_contains($t, 'অর্ধেক') ? 50.0 : (str_contains($t, 'তিন ভাগের এক') ? 33.33 : null));
            if ($share !== null && $share > 0 && $share <= 100) {
                DB::table('land_cultivations')->where('id', $c->id)->update(['share_percent' => $share]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('land_cultivations', function (Blueprint $table) {
            $table->dropColumn(['share_percent', 'contract_end']);
        });
    }
};
