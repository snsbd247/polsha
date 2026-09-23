<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_batches', function (Blueprint $table) {
            $table->id();
            $table->string('type', 20); // farmers | lands
            $table->string('filename');
            $table->unsignedInteger('total_rows')->default(0);
            $table->unsignedInteger('imported_rows')->default(0);
            $table->unsignedInteger('skipped_rows')->default(0);
            $table->json('errors')->nullable();
            $table->string('status', 20)->default('completed'); // completed | rolled_back
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        Schema::table('farmers', function (Blueprint $table) {
            $table->foreignId('import_batch_id')->nullable()->after('created_by')->constrained()->nullOnDelete();
        });

        // Irrigation rates (phase 5) are keyed on land type, so it is a master table.
        Schema::create('land_types', function (Blueprint $table) {
            $table->id();
            $table->string('name_bn');
            $table->string('category', 50)->nullable();
            $table->string('description', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('lands', function (Blueprint $table) {
            $table->id();
            $table->string('land_code', 20)->unique();
            $table->foreignId('mouza_id')->constrained();
            $table->string('survey', 10)->default('RS'); // RS | BS | SA | CS | other
            $table->string('khatian_no', 30);
            $table->string('dag_no', 30);
            // Always stored in decimals (শতক); UI converts other units.
            $table->decimal('area_decimal', 12, 4);
            $table->foreignId('land_type_id')->nullable()->constrained();
            $table->string('status', 20)->default('cultivated'); // cultivated | fallow | disputed | inactive
            $table->text('remarks')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->foreignId('import_batch_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['mouza_id', 'survey', 'khatian_no', 'dag_no']);
        });

        // Ownership periods; end_date NULL = current owner. Never overwritten.
        Schema::create('land_owners', function (Blueprint $table) {
            $table->id();
            $table->foreignId('land_id')->constrained()->cascadeOnDelete();
            $table->foreignId('farmer_id')->constrained();
            $table->decimal('share_percent', 5, 2);
            $table->date('start_date');
            $table->date('end_date')->nullable();
            $table->string('remarks', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
            $table->index(['farmer_id', 'end_date']);
            $table->index(['land_id', 'end_date']);
        });

        // Who farms the land, and on what terms; one open period per land.
        Schema::create('land_cultivations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('land_id')->constrained()->cascadeOnDelete();
            $table->foreignId('farmer_id')->constrained();
            $table->string('type', 10); // own | borga | lease
            $table->string('terms', 500)->nullable();
            $table->date('start_date');
            $table->date('end_date')->nullable();
            $table->string('remarks', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
            $table->index(['farmer_id', 'end_date']);
            $table->index(['land_id', 'end_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('land_cultivations');
        Schema::dropIfExists('land_owners');
        Schema::dropIfExists('lands');
        Schema::dropIfExists('land_types');
        Schema::table('farmers', fn (Blueprint $t) => $t->dropConstrainedForeignId('import_batch_id'));
        Schema::dropIfExists('import_batches');
    }
};
