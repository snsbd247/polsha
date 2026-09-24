<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 10: every record an import creates carries its batch, so a batch
 * can be traced (import audit) and rolled back while nothing else has
 * touched it yet.
 */
return new class extends Migration
{
    private const TRACKED = ['member_accounts', 'member_transactions', 'loans', 'invoices', 'receipts'];

    public function up(): void
    {
        Schema::table('import_batches', function (Blueprint $table) {
            $table->decimal('total_amount', 15, 2)->default(0)->after('skipped_rows');
            $table->json('mapping')->nullable()->after('errors');
            $table->foreignId('approval_request_id')->nullable()->after('status')->constrained();
            $table->string('rollback_reason', 500)->nullable()->after('approval_request_id');
            $table->timestamp('rolled_back_at')->nullable()->after('rollback_reason');
            $table->foreignId('rolled_back_by')->nullable()->after('rolled_back_at')->constrained('users');
            $table->index(['type', 'status']);
        });

        foreach (self::TRACKED as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignId('import_batch_id')->nullable()->constrained()->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (self::TRACKED as $name) {
            Schema::table($name, fn (Blueprint $t) => $t->dropConstrainedForeignId('import_batch_id'));
        }
        Schema::table('import_batches', function (Blueprint $table) {
            $table->dropIndex(['type', 'status']);
            $table->dropConstrainedForeignId('approval_request_id');
            $table->dropConstrainedForeignId('rolled_back_by');
            $table->dropColumn(['total_amount', 'mapping', 'rollback_reason', 'rolled_back_at']);
        });
    }
};
