<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lands', function (Blueprint $table) {
            // which of the mouza's villages the plot lies in, and where exactly
            $table->foreignId('village_id')->nullable()->after('mouza_id')->constrained()->nullOnDelete();
            $table->decimal('latitude', 10, 7)->nullable()->after('area_decimal');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            $table->string('location_note', 300)->nullable()->after('longitude');
            // the part of the plot that can take irrigation water (the rest stays dry)
            $table->decimal('irrigable_decimal', 12, 4)->nullable()->after('location_note');
        });
    }

    public function down(): void
    {
        Schema::table('lands', function (Blueprint $table) {
            $table->dropConstrainedForeignId('village_id');
            $table->dropColumn(['latitude', 'longitude', 'location_note', 'irrigable_decimal']);
        });
    }
};
