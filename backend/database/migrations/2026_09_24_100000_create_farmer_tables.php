<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('households', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->foreignId('village_id')->nullable()->constrained();
            // FK to farmers added below (circular reference).
            $table->unsignedBigInteger('head_farmer_id')->nullable()->index();
            $table->string('remarks', 500)->nullable();
            $table->timestamps();
        });

        Schema::create('farmers', function (Blueprint $table) {
            $table->id();
            $table->string('farmer_code', 20)->unique();
            $table->string('name_bn');
            $table->string('name_en')->nullable();
            $table->string('father_name');
            $table->string('mother_name')->nullable();
            $table->string('spouse_name')->nullable();
            $table->string('gender', 10);
            $table->date('date_of_birth')->nullable();
            $table->string('nid', 17)->nullable()->unique();
            $table->string('birth_reg_no', 17)->nullable();
            $table->string('mobile', 11)->nullable()->index();
            $table->string('alt_mobile', 11)->nullable();
            $table->string('photo')->nullable();
            $table->foreignId('village_id')->constrained();
            $table->foreignId('mouza_id')->constrained();
            $table->string('para')->nullable();
            $table->string('post_office')->nullable();
            $table->foreignId('household_id')->nullable()->constrained()->nullOnDelete();
            $table->string('household_relation', 30)->nullable();
            $table->string('occupation', 50)->nullable();
            $table->text('remarks')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignId('merged_into_id')->nullable()->constrained('farmers');
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['name_bn', 'father_name']);
        });

        Schema::table('households', function (Blueprint $table) {
            $table->foreign('head_farmer_id')->references('id')->on('farmers')->nullOnDelete();
        });

        Schema::create('farmer_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farmer_id')->constrained()->cascadeOnDelete();
            $table->string('type', 30);
            $table->string('path');
            $table->string('original_name');
            $table->string('mime', 100);
            $table->unsignedInteger('size');
            $table->string('remarks', 500)->nullable();
            $table->foreignId('uploaded_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        // Pairs a user confirmed are different people, so they stop showing as duplicates.
        Schema::create('duplicate_dismissals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farmer_a_id')->constrained('farmers')->cascadeOnDelete();
            $table->foreignId('farmer_b_id')->constrained('farmers')->cascadeOnDelete();
            $table->foreignId('dismissed_by')->nullable()->constrained('users');
            $table->timestamps();
            $table->unique(['farmer_a_id', 'farmer_b_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('duplicate_dismissals');
        Schema::dropIfExists('farmer_documents');
        Schema::table('households', fn (Blueprint $t) => $t->dropForeign(['head_farmer_id']));
        Schema::dropIfExists('farmers');
        Schema::dropIfExists('households');
    }
};
