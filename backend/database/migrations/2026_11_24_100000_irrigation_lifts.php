<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Lifts: water is pumped up in stages, and the stage a plot sits on (1st,
 * 2nd, 3rd lift …) sets its irrigation rate. A lift is a fixed fact of the
 * land; rates may name one, and an invoice keeps the lift it was billed at.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('irrigation_lifts', function (Blueprint $table) {
            $table->id();
            $table->string('code', 12)->unique();
            $table->string('name_bn', 100)->unique();
            $table->string('name_en', 100)->nullable();
            $table->string('description', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        $now = now();
        foreach ([['L1', '১ম লিফট', '1st Lift'], ['L2', '২য় লিফট', '2nd Lift'], ['L3', '৩য় লিফট', '3rd Lift']] as $i => [$code, $bn, $en]) {
            DB::table('irrigation_lifts')->insert(['code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'is_active' => true, 'sort_order' => $i + 1, 'created_at' => $now, 'updated_at' => $now]);
        }

        Schema::table('lands', function (Blueprint $table) {
            $table->foreignId('lift_id')->nullable()->after('irrigation_type_id')->constrained('irrigation_lifts')->restrictOnDelete();
        });
        Schema::table('irrigation_rates', function (Blueprint $table) {
            $table->foreignId('lift_id')->nullable()->after('irrigation_type_id')->constrained('irrigation_lifts')->restrictOnDelete();
        });
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreignId('lift_id')->nullable()->after('irrigation_type_id')->constrained('irrigation_lifts')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        foreach (['invoices', 'irrigation_rates', 'lands'] as $t) {
            Schema::table($t, function (Blueprint $table) {
                $table->dropConstrainedForeignId('lift_id');
            });
        }
        Schema::dropIfExists('irrigation_lifts');
    }
};
