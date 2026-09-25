<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('farmers', function (Blueprint $table) {
            $table->string('post_code', 10)->nullable()->after('post_office');
            $table->string('blood_group', 5)->nullable()->after('occupation');
            $table->string('education_level', 30)->nullable()->after('blood_group');
            $table->string('farmer_type', 30)->nullable()->after('education_level');
        });

        // relatives recorded on the farmer form (not necessarily farmers themselves)
        Schema::create('farmer_family_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farmer_id')->constrained()->cascadeOnDelete();
            $table->string('name', 150);
            $table->string('relation', 30)->nullable();
            $table->string('occupation', 100)->nullable();
            $table->string('mobile', 11)->nullable();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('farmer_family_members');
        Schema::table('farmers', function (Blueprint $table) {
            $table->dropColumn(['post_code', 'blood_group', 'education_level', 'farmer_type']);
        });
    }
};
