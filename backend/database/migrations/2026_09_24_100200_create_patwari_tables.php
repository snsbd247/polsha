<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patwaris', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('father_name');
            $table->string('mobile', 11);
            $table->string('nid', 17)->nullable();
            $table->foreignId('farmer_id')->nullable()->constrained()->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // One row per mouza responsibility period; end_date NULL = current.
        Schema::create('patwari_mouza_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('patwari_id')->constrained()->cascadeOnDelete();
            $table->foreignId('mouza_id')->constrained();
            $table->date('start_date');
            $table->date('end_date')->nullable();
            $table->timestamps();
            $table->index(['mouza_id', 'end_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('patwari_mouza_assignments');
        Schema::dropIfExists('patwaris');
    }
};
