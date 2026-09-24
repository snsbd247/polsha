<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 8: combined payment, day-end cash close, monthly bank
 * reconciliation, QR scan log and the fixed-asset register.
 */
return new class extends Migration
{
    public function up(): void
    {
        // One counter receipt that pays several modules; each part is booked by its own module.
        Schema::create('combined_payments', function (Blueprint $table) {
            $table->id();
            $table->string('payment_no', 30)->unique();
            $table->foreignId('farmer_id')->constrained();
            $table->foreignId('member_id')->nullable()->constrained();
            $table->string('payer_name');
            $table->date('date')->index();
            $table->decimal('amount', 15, 2);
            $table->string('method', 10);
            $table->foreignId('fund_account_id')->nullable()->constrained('chart_of_accounts');
            $table->string('reference', 100)->nullable();
            $table->string('remarks', 500)->nullable();
            $table->json('allocation')->nullable(); // {auto: {...}, final: {...}}
            $table->string('status', 20)->default('posted')->index(); // posted|cancel_pending|cancelled
            $table->string('verify_token', 40)->unique();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancel_reason', 300)->nullable();
            $table->timestamps();
        });

        Schema::create('combined_payment_parts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('combined_payment_id')->constrained()->cascadeOnDelete();
            $table->string('module', 20); // loan|irrigation|share|savings
            $table->decimal('amount', 15, 2);
            $table->morphs('source'); // LoanPayment | Receipt | MemberTransaction
            $table->string('description', 255)->nullable();
        });

        // Day-end cash count. A closed date (and every date before it) takes no more cash entries.
        Schema::create('day_closes', function (Blueprint $table) {
            $table->id();
            $table->date('date')->unique();
            $table->decimal('opening', 15, 2)->default(0);
            $table->decimal('collections', 15, 2)->default(0);
            $table->decimal('payments', 15, 2)->default(0);
            $table->decimal('expected', 15, 2)->default(0);
            $table->decimal('actual', 15, 2)->default(0);
            $table->decimal('difference', 15, 2)->default(0);
            $table->json('breakdown')->nullable(); // per cash stream
            $table->json('denominations')->nullable();
            $table->string('note', 500)->nullable();
            $table->string('status', 20)->default('closed')->index(); // closed|reopen_pending|reopened
            $table->foreignId('closed_by')->nullable()->constrained('users');
            $table->timestamp('closed_at')->nullable();
            $table->string('reopen_reason', 300)->nullable();
            $table->foreignId('reopened_by')->nullable()->constrained('users');
            $table->timestamp('reopened_at')->nullable();
            $table->timestamps();
        });

        Schema::create('bank_reconciliations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bank_account_id')->constrained();
            $table->string('period', 7); // YYYY-MM
            $table->decimal('statement_opening', 15, 2)->default(0);
            $table->decimal('statement_closing', 15, 2)->default(0);
            $table->decimal('book_closing', 15, 2)->nullable(); // frozen on finalize
            $table->string('status', 20)->default('draft'); // draft|finalized
            $table->string('note', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->foreignId('finalized_by')->nullable()->constrained('users');
            $table->timestamp('finalized_at')->nullable();
            $table->timestamps();
            $table->unique(['bank_account_id', 'period']);
        });

        Schema::create('bank_statement_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('reconciliation_id')->constrained('bank_reconciliations')->cascadeOnDelete();
            $table->date('date');
            $table->string('description', 255)->nullable();
            $table->string('reference', 100)->nullable();
            $table->decimal('amount', 15, 2); // + deposit, − withdrawal
            $table->foreignId('journal_line_id')->nullable()->unique()->constrained('journal_lines')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('qr_scans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained();
            $table->string('entity_type', 20)->index(); // farmer|member|land|asset|receipt|combined|unknown
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('code', 255);
            $table->string('label', 255)->nullable();
            $table->boolean('found')->default(false);
            $table->string('source', 10)->default('camera'); // camera|manual|link
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->timestamp('created_at')->useCurrent()->index();
        });

        Schema::create('asset_categories', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->string('name_bn', 150);
            $table->string('name_en', 150)->nullable();
            $table->unsignedSmallInteger('life_months')->default(60);
            $table->decimal('salvage_percent', 5, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('assets', function (Blueprint $table) {
            $table->id();
            $table->string('asset_code', 30)->unique();
            $table->string('name_bn');
            $table->string('name_en')->nullable();
            $table->foreignId('category_id')->constrained('asset_categories');
            $table->string('brand_model', 150)->nullable();
            $table->string('serial_no', 100)->nullable();
            $table->string('supplier', 150)->nullable();
            $table->date('purchase_date');
            $table->decimal('cost', 15, 2);
            $table->decimal('salvage_value', 15, 2)->default(0);
            $table->unsignedSmallInteger('life_months');
            $table->date('depreciation_from'); // first month (1st day) that takes a charge
            $table->decimal('accumulated_depreciation', 15, 2)->default(0);
            $table->string('acquisition', 20)->default('purchase'); // purchase|opening|donation
            $table->string('location', 200)->nullable();
            $table->foreignId('mouza_id')->nullable()->constrained();
            $table->string('custodian', 150)->nullable();
            $table->string('condition', 20)->default('good'); // good|fair|poor|damaged
            $table->string('status', 20)->default('in_stock')->index(); // in_stock|installed|in_repair|disposal_pending|disposed|sold
            $table->date('installed_on')->nullable();
            $table->string('method', 10)->nullable();
            $table->foreignId('fund_account_id')->nullable()->constrained('chart_of_accounts');
            $table->string('reference', 100)->nullable();
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->json('disposal')->nullable(); // requested/settled sale or write-off
            $table->string('remarks', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        Schema::create('asset_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20); // acquire|transfer|install|uninstall|condition|repair|repaired|dispose_request|disposed|sold|dispose_rejected
            $table->date('date');
            $table->string('from_location', 200)->nullable();
            $table->string('to_location', 200)->nullable();
            $table->string('custodian', 150)->nullable();
            $table->string('condition', 20)->nullable();
            $table->decimal('amount', 15, 2)->nullable();
            $table->string('note', 500)->nullable();
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        Schema::create('asset_maintenances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 20)->default('service'); // service|repair
            $table->string('title', 200);
            $table->date('due_on')->nullable()->index();
            $table->unsignedSmallInteger('repeat_months')->nullable();
            $table->date('done_on')->nullable();
            $table->decimal('cost', 15, 2)->default(0);
            $table->string('vendor', 150)->nullable();
            $table->string('status', 20)->default('scheduled')->index(); // scheduled|done|cancelled
            $table->string('method', 10)->nullable();
            $table->foreignId('fund_account_id')->nullable()->constrained('chart_of_accounts');
            $table->string('reference', 100)->nullable();
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->string('note', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        Schema::create('asset_depreciations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->string('period', 7)->index(); // YYYY-MM
            $table->decimal('amount', 15, 2);
            $table->decimal('accumulated_after', 15, 2);
            $table->decimal('book_value_after', 15, 2);
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->timestamps();
            $table->unique(['asset_id', 'period']);
        });
    }

    public function down(): void
    {
        foreach (['asset_depreciations', 'asset_maintenances', 'asset_movements', 'assets', 'asset_categories', 'qr_scans',
            'bank_statement_lines', 'bank_reconciliations', 'day_closes', 'combined_payment_parts', 'combined_payments'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
