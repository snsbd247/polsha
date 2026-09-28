<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** A report taken off the land report list stays in the export log for the audit trail. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('export_logs', function (Blueprint $table) {
            $table->timestamp('dismissed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('export_logs', function (Blueprint $table) {
            $table->dropColumn('dismissed_at');
        });
    }
};
