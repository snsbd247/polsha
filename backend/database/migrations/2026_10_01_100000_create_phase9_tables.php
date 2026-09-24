<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 9: export audit trail, SMS (templates, outbox, OTP), nightly
 * integrity scans, public bKash/Nagad payment requests, paper receipt
 * books and the financial-year close.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Every report printed or exported (Excel/CSV) — who took which data out, and when.
        Schema::create('export_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained();
            $table->string('report_key', 60)->index();
            $table->string('title', 200);
            $table->string('format', 10); // xlsx|csv|print
            $table->json('filters')->nullable();
            $table->unsignedInteger('row_count')->default(0);
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at')->nullable()->index();
        });

        Schema::create('sms_templates', function (Blueprint $table) {
            $table->id();
            $table->string('key', 50)->unique();
            $table->string('name_bn', 150);
            $table->string('name_en', 150)->nullable();
            $table->text('body'); // {name}, {amount} ... placeholders
            $table->json('variables')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // The SMS outbox. Without gateway credentials a message is only "logged".
        Schema::create('sms_logs', function (Blueprint $table) {
            $table->id();
            $table->string('template_key', 50)->nullable()->index();
            $table->string('mobile', 20)->index();
            $table->text('message');
            $table->string('status', 10)->default('pending')->index(); // pending|sent|failed|logged
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->string('response', 500)->nullable();
            $table->nullableMorphs('related');
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
        });

        Schema::create('sms_otps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('purpose', 30); // password_reset
            $table->string('code_hash');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamps();
        });

        Schema::create('integrity_scans', function (Blueprint $table) {
            $table->id();
            $table->string('trigger', 10)->default('auto'); // auto|manual
            $table->unsignedInteger('total_issues')->default(0);
            $table->unsignedInteger('errors')->default(0);
            $table->json('results')->nullable(); // [{key,label,group,severity,count,sample:[...]}]
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
        });

        // Money sent to the society's bKash/Nagad number, reported by the payer without login.
        Schema::create('public_payment_requests', function (Blueprint $table) {
            $table->id();
            $table->string('request_no', 30)->unique();
            $table->string('farmer_code', 30);
            $table->foreignId('farmer_id')->nullable()->constrained();
            $table->string('payer_name', 150);
            $table->string('mobile', 20);
            $table->string('method', 10); // bkash|nagad|rocket
            $table->string('sender_number', 20);
            $table->string('trx_id', 40);
            $table->decimal('amount', 15, 2);
            $table->date('paid_on');
            $table->string('note', 300)->nullable();
            $table->string('status', 12)->default('pending')->index(); // pending|verified|rejected
            $table->foreignId('combined_payment_id')->nullable()->constrained();
            $table->foreignId('verified_by')->nullable()->constrained('users');
            $table->timestamp('verified_at')->nullable();
            $table->string('reject_reason', 300)->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestamps();
            $table->unique(['method', 'trx_id']);
        });

        // Pre-printed paper receipt books handed to collectors.
        Schema::create('receipt_books', function (Blueprint $table) {
            $table->id();
            $table->string('book_no', 30)->unique();
            $table->unsignedBigInteger('start_no');
            $table->unsignedBigInteger('end_no');
            $table->foreignId('issued_to')->nullable()->constrained('users');
            $table->date('issued_on')->nullable();
            $table->string('status', 12)->default('stock'); // stock|issued|closed|lost
            $table->string('note', 300)->nullable();
            $table->timestamps();
        });

        Schema::create('fiscal_year_closes', function (Blueprint $table) {
            $table->id();
            $table->string('fiscal_year', 10)->unique();
            $table->date('start_date');
            $table->date('end_date');
            $table->decimal('income_total', 15, 2)->default(0);
            $table->decimal('expense_total', 15, 2)->default(0);
            $table->decimal('surplus', 15, 2)->default(0);
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->string('note', 500)->nullable();
            $table->foreignId('closed_by')->nullable()->constrained('users');
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['fiscal_year_closes', 'receipt_books', 'public_payment_requests', 'integrity_scans', 'sms_otps', 'sms_logs', 'sms_templates', 'export_logs'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
