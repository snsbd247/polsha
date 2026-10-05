<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * More about each water connection for its detail page: a second mobile, the
 * meter (if one is fitted — the bill stays the fixed monthly fee), pipe size,
 * where the tap is, a photo, and scanned papers (NID, application, agreement).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('water_connections', function (Blueprint $t) {
            $t->string('alt_mobile', 20)->nullable()->after('mobile');
            $t->string('meter_no', 40)->nullable()->after('address');
            $t->string('pipe_size', 40)->nullable()->after('meter_no');
            $t->decimal('latitude', 10, 7)->nullable()->after('pipe_size');
            $t->decimal('longitude', 10, 7)->nullable()->after('latitude');
            $t->string('photo', 120)->nullable()->after('longitude');
        });

        Schema::create('water_connection_documents', function (Blueprint $t) {
            $t->id();
            $t->foreignId('connection_id')->constrained('water_connections')->cascadeOnDelete();
            $t->string('title', 100);
            $t->string('path', 255);
            $t->string('original_name', 255);
            $t->string('mime', 100)->nullable();
            $t->unsignedInteger('size')->default(0);
            $t->foreignId('uploaded_by')->nullable()->constrained('users');
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('water_connection_documents');
        Schema::table('water_connections', function (Blueprint $t) {
            $t->dropColumn(['alt_mobile', 'meter_no', 'pipe_size', 'latitude', 'longitude', 'photo']);
        });
    }
};
