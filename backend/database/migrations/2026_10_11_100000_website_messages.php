<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Messages sent from the website's contact page, read and answered in the office. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('website_messages', function (Blueprint $t) {
            $t->id();
            $t->string('name', 100);
            $t->string('mobile', 20)->index();
            $t->string('email', 100)->nullable();
            $t->string('subject', 150);
            $t->text('message');
            $t->string('ip', 45)->nullable();
            $t->timestamp('read_at')->nullable();
            $t->foreignId('read_by')->nullable()->constrained('users');
            $t->string('note', 500)->nullable(); // what the office did about it
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('website_messages');
    }
};
