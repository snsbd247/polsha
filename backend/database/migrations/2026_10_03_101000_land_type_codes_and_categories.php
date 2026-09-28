<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Land types get a short code and a default rate, and their free-text class
 * becomes one of a fixed set (agricultural, residential, waterbody,
 * non-agricultural, other) so the list can count and filter by it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('land_types', function (Blueprint $table) {
            $table->string('code', 10)->nullable()->unique()->after('name_bn');
            $table->decimal('default_rate', 12, 2)->default(0)->after('description');
        });

        $codes = ['উঁচু জমি' => 'HGH', 'মাঝারি উঁচু জমি' => 'MHG', 'মাঝারি নিচু জমি' => 'MLW', 'নিচু জমি' => 'LOW', 'বসতভিটা' => 'HOM', 'পুকুর/জলাশয়' => 'PON'];
        foreach (DB::table('land_types')->get() as $t) {
            $name = (string) $t->name_bn;
            $category = match (true) {
                in_array($t->category, ['উঁচু', 'মাঝারি', 'নিচু'], true) => 'agricultural',
                str_contains($name, 'বসত') => 'residential',
                str_contains($name, 'পুকুর') || str_contains($name, 'জলাশয়') => 'waterbody',
                $t->category === 'অকৃষি' => 'non_agricultural',
                default => 'other',
            };
            DB::table('land_types')->where('id', $t->id)->update(['category' => $category, 'code' => $codes[$name] ?? 'LT'.$t->id]);
        }
    }

    public function down(): void
    {
        Schema::table('land_types', function (Blueprint $table) {
            $table->dropUnique(['code']);
            $table->dropColumn(['code', 'default_rate']);
        });
    }
};
