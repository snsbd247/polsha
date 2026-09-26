<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Papers kept for a plot (khatian copy, map, mutation, deed); files live on the private disk.
        Schema::create('land_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('land_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20);
            $table->string('title', 150)->nullable();
            $table->string('path');
            $table->string('original_name', 255);
            $table->string('mime', 100)->nullable();
            $table->unsignedInteger('size')->default(0);
            $table->foreignId('uploaded_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        // Short dated remarks staff add over time ("verified on site", "line connected").
        Schema::create('land_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('land_id')->constrained()->cascadeOnDelete();
            $table->string('note', 500);
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('land_notes');
        Schema::dropIfExists('land_documents');
    }
};
