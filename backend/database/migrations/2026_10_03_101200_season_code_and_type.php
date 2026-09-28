<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Seasons get a short code and a cropping type (rabi, kharif, summer…); older seasons are given both from their name. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seasons', function (Blueprint $table) {
            $table->string('code', 20)->nullable()->unique()->after('name_bn');
            $table->string('type', 20)->nullable()->after('code');
        });

        $used = [];
        foreach (DB::table('seasons')->orderBy('id')->get() as $s) {
            $name = (string) $s->name_bn;
            [$base, $type] = match (true) {
                str_contains($name, 'বোরো') => ['BORO', 'rabi'],
                str_contains($name, 'আমন') => ['AMAN', 'kharif'],
                str_contains($name, 'আউশ') => ['AUS', 'kharif'],
                str_contains($name, 'রবি') => ['RABI', 'rabi'],
                default => ['SEASON', 'other'],
            };
            $year = substr((string) $s->start_date, 2, 2);
            $code = $base.$year;
            for ($i = 2; in_array($code, $used, true); $i++) {
                $code = $base.$year.'-'.$i;
            }
            $used[] = $code;
            DB::table('seasons')->where('id', $s->id)->update(['code' => $code, 'type' => $type]);
        }
    }

    public function down(): void
    {
        Schema::table('seasons', function (Blueprint $table) {
            $table->dropUnique(['code']);
            $table->dropColumn(['code', 'type']);
        });
    }
};
