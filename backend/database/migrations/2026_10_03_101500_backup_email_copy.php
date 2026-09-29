<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Off-site copy: where each backup was emailed, when, or why it could not be. */
    public function up(): void
    {
        Schema::table('backups', function (Blueprint $table) {
            $table->string('emailed_to', 191)->nullable()->after('type');
            $table->timestamp('emailed_at')->nullable()->after('emailed_to');
            $table->string('email_error', 300)->nullable()->after('emailed_at');
        });
    }

    public function down(): void
    {
        Schema::table('backups', function (Blueprint $table) {
            $table->dropColumn(['emailed_to', 'emailed_at', 'email_error']);
        });
    }
};
