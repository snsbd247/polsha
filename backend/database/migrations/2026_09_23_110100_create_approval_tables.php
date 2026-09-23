<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('approval_rules', function (Blueprint $table) {
            $table->id();
            $table->string('action_key', 60)->unique();
            $table->string('module', 50);
            $table->string('label');
            $table->boolean('enabled')->default(true);
            // [["manager"], ["president"]] — each entry is one step; any listed role may act on it.
            $table->json('steps');
            $table->decimal('min_amount', 15, 2)->nullable();
            $table->timestamps();
        });

        Schema::create('approval_requests', function (Blueprint $table) {
            $table->id();
            $table->string('action_key', 60)->index();
            $table->string('module', 50)->index();
            $table->string('title');
            $table->nullableMorphs('approvable');
            $table->json('payload')->nullable();
            $table->json('before')->nullable();
            $table->decimal('amount', 15, 2)->nullable();
            $table->string('status', 20)->default('pending')->index();
            $table->unsignedTinyInteger('current_step')->default(1);
            $table->unsignedTinyInteger('total_steps')->default(1);
            $table->foreignId('requested_by')->constrained('users');
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();
        });

        Schema::create('approval_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('approval_request_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('step_no');
            $table->json('roles');
            $table->string('status', 20)->default('waiting');
            $table->foreignId('acted_by')->nullable()->constrained('users');
            $table->timestamp('acted_at')->nullable();
            $table->string('remarks', 1000)->nullable();
            $table->timestamps();

            $table->unique(['approval_request_id', 'step_no']);
        });

        Schema::create('approval_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('approval_request_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained();
            $table->text('body');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_comments');
        Schema::dropIfExists('approval_steps');
        Schema::dropIfExists('approval_requests');
        Schema::dropIfExists('approval_rules');
    }
};
