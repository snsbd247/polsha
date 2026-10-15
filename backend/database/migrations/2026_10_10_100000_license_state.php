<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row: the last answer from the license server (with its signature, so an
 * edited row is caught) and when the server was last asked / last answered validly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('license_state', function (Blueprint $t) {
            $t->id();
            $t->string('license_key', 200)->nullable();
            $t->string('domain', 190)->nullable();
            $t->string('status', 30)->nullable();
            $t->string('expires_at', 40)->nullable(); // kept exactly as the server sent it: it is part of the signed text
            $t->string('activated_at', 40)->nullable();
            $t->text('signature')->nullable();
            $t->string('message', 500)->nullable();
            $t->timestamp('last_checked_at')->nullable();   // last time the server was asked
            $t->boolean('last_check_ok')->default(false);   // did that answer carry a valid signature
            $t->timestamp('last_ok_at')->nullable();        // last answer with a valid signature
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('license_state');
    }
};
