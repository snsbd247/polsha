<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Rate "category": deep/shallow tubewell, canal … (master, like land types).
        Schema::create('irrigation_types', function (Blueprint $table) {
            $table->id();
            $table->string('name_bn', 100)->unique();
            $table->string('description', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        // The land's usual irrigation source; an invoice may override it.
        Schema::table('lands', function (Blueprint $table) {
            $table->foreignId('irrigation_type_id')->nullable()->after('land_type_id')->constrained();
        });

        Schema::create('seasons', function (Blueprint $table) {
            $table->id();
            $table->string('name_bn', 100);
            $table->string('crop', 100)->nullable();
            $table->date('start_date');
            $table->date('end_date');
            $table->date('due_date')->nullable(); // default payment deadline for its invoices
            $table->string('status', 10)->default('open'); // planned | open | closed
            $table->string('remarks', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        // Rate per শতক. Rows are never edited: a change is a new row that
        // becomes effective only after approval, so the history is the table.
        Schema::create('irrigation_rates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('season_id')->constrained();
            $table->foreignId('land_type_id')->nullable()->constrained(); // NULL = every land type
            $table->foreignId('irrigation_type_id')->constrained();
            $table->decimal('rate', 12, 4);
            $table->date('effective_from');
            $table->string('status', 10)->default('pending'); // pending | approved | rejected
            $table->string('reason', 500)->nullable();
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->foreignId('approved_by')->nullable()->constrained('users');
            $table->timestamp('approved_at')->nullable();
            $table->timestamps();
            $table->index(['season_id', 'irrigation_type_id', 'land_type_id', 'status'], 'irrigation_rates_lookup');
        });

        Schema::create('invoice_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('season_id')->constrained();
            $table->foreignId('mouza_id')->nullable()->constrained();
            $table->date('invoice_date');
            $table->unsignedInteger('invoice_count')->default(0);
            $table->decimal('total_amount', 15, 2)->default(0);
            $table->unsignedInteger('skipped_count')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        // One irrigation bill per land per season, always in the cultivator's
        // name; everything printed on it is copied into `snapshot`.
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->string('invoice_no', 30)->unique();
            $table->foreignId('season_id')->constrained();
            $table->foreignId('land_id')->constrained();
            $table->foreignId('farmer_id')->constrained(); // cultivator (payer)
            $table->string('cultivation_type', 10); // own | borga | lease
            $table->foreignId('land_type_id')->nullable()->constrained();
            $table->foreignId('irrigation_type_id')->constrained();
            $table->foreignId('rate_id')->nullable()->constrained('irrigation_rates');
            $table->date('invoice_date')->index();
            $table->date('due_date')->nullable();
            $table->decimal('area_decimal', 12, 4);
            $table->decimal('rate', 12, 4);
            $table->decimal('amount', 15, 2);
            $table->decimal('paid_amount', 15, 2)->default(0);
            $table->string('status', 12)->default('unpaid')->index(); // unpaid | partial | paid | cancelled
            $table->json('snapshot');
            $table->string('remarks', 500)->nullable();
            $table->foreignId('batch_id')->nullable()->constrained('invoice_batches');
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('cancelled_at')->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users');
            $table->string('cancel_reason', 500)->nullable();
            $table->timestamps();
            $table->index(['season_id', 'land_id', 'status']);
            $table->index(['farmer_id', 'status']);
        });

        // Money receipts for every module (irrigation now; savings, loans … later).
        Schema::create('receipts', function (Blueprint $table) {
            $table->id();
            $table->string('receipt_no', 30)->unique();
            $table->string('module', 20)->index();
            $table->foreignId('farmer_id')->nullable()->constrained();
            $table->string('payer_name', 150);
            $table->date('date')->index();
            $table->decimal('amount', 15, 2);
            $table->string('method', 10); // cash | bank | other
            $table->foreignId('fund_account_id')->constrained('chart_of_accounts');
            $table->string('reference', 100)->nullable(); // cheque / transaction no
            $table->boolean('is_legacy')->default(false);
            $table->string('legacy_no', 50)->nullable()->unique(); // paper receipt-book number
            $table->string('status', 16)->default('active')->index(); // active | cancel_pending | cancelled
            $table->string('remarks', 500)->nullable();
            $table->string('verify_token', 40)->unique();
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('cancelled_at')->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users');
            $table->string('cancel_reason', 500)->nullable();
            $table->timestamps();
        });

        Schema::create('receipt_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('receipt_id')->constrained()->cascadeOnDelete();
            $table->morphs('payable');
            $table->string('description', 255);
            $table->decimal('amount', 15, 2);
            $table->decimal('due_after', 15, 2)->nullable(); // bill due right after this payment — printed on the receipt
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('receipt_items');
        Schema::dropIfExists('receipts');
        Schema::dropIfExists('invoices');
        Schema::dropIfExists('invoice_batches');
        Schema::dropIfExists('irrigation_rates');
        Schema::dropIfExists('seasons');
        Schema::table('lands', fn (Blueprint $t) => $t->dropConstrainedForeignId('irrigation_type_id'));
        Schema::dropIfExists('irrigation_types');
    }
};
