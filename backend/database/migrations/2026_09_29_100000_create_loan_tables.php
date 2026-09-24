<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loan_products', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->string('name_bn', 150);
            $table->string('name_en', 150)->nullable();
            $table->string('category', 20); // agriculture | business | general | emergency
            $table->decimal('max_amount', 15, 2);
            // limit also capped at N × (savings + share balance); null = no such cap
            $table->decimal('savings_multiplier', 6, 2)->nullable();
            $table->decimal('interest_rate', 6, 2); // % per year
            $table->string('interest_method', 10); // flat | declining
            $table->string('frequency', 10); // monthly | weekly | quarterly | one_time
            $table->unsignedSmallInteger('installments'); // one_time = 1
            $table->unsignedSmallInteger('term_months')->nullable(); // one_time: months until the lump sum is due
            $table->decimal('penalty_rate', 6, 2)->default(0); // % per month on the overdue amount
            $table->unsignedSmallInteger('grace_days')->default(0);
            $table->unsignedTinyInteger('guarantors_required')->default(1);
            $table->boolean('is_active')->default(true);
            $table->string('description', 500)->nullable();
            $table->timestamps();
        });

        Schema::create('loans', function (Blueprint $table) {
            $table->id();
            $table->string('loan_no', 30)->unique();
            $table->foreignId('member_id')->constrained();
            $table->foreignId('product_id')->constrained('loan_products');
            $table->date('applied_on');
            $table->decimal('amount', 15, 2);
            $table->string('purpose', 300)->nullable();
            // terms are copied from the product so later product edits never change a running loan
            $table->decimal('interest_rate', 6, 2);
            $table->string('interest_method', 10);
            $table->string('frequency', 10);
            $table->unsignedSmallInteger('installments');
            $table->unsignedSmallInteger('term_months')->nullable();
            $table->decimal('penalty_rate', 6, 2)->default(0);
            $table->unsignedSmallInteger('grace_days')->default(0);
            $table->decimal('limit_amount', 15, 2)->nullable(); // limit worked out at application
            // pending | approved | active | closed | rejected | cancelled
            $table->string('status', 12)->default('pending');
            $table->date('disbursed_on')->nullable();
            $table->date('first_due_on')->nullable();
            $table->date('closed_on')->nullable();
            $table->decimal('total_interest', 15, 2)->default(0);
            $table->string('method', 10)->nullable(); // disbursement: cash | bank | other
            $table->foreignId('fund_account_id')->nullable()->constrained('chart_of_accounts');
            $table->string('reference', 100)->nullable();
            $table->string('remarks', 500)->nullable();
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->foreignId('journal_id')->nullable()->constrained(); // disbursement voucher
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->foreignId('disbursed_by')->nullable()->constrained('users');
            $table->timestamps();
            $table->index(['member_id', 'status']);
            $table->index(['status', 'disbursed_on']);
        });

        Schema::create('loan_guarantors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('loan_id')->constrained()->cascadeOnDelete();
            $table->foreignId('member_id')->constrained();
            $table->string('relation', 100)->nullable();
            $table->timestamps();
            $table->unique(['loan_id', 'member_id']);
        });

        Schema::create('loan_installments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('loan_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('seq');
            $table->date('due_date');
            $table->decimal('principal', 15, 2);
            $table->decimal('interest', 15, 2);
            $table->decimal('principal_paid', 15, 2)->default(0);
            $table->decimal('interest_paid', 15, 2)->default(0);
            // penalty is worked out day by day on what is overdue and stored up to penalty_to
            $table->decimal('penalty_accrued', 15, 2)->default(0);
            $table->decimal('penalty_paid', 15, 2)->default(0);
            $table->date('penalty_to')->nullable();
            $table->date('paid_on')->nullable(); // fully paid
            $table->timestamps();
            $table->unique(['loan_id', 'seq']);
            $table->index('due_date');
        });

        Schema::create('loan_payments', function (Blueprint $table) {
            $table->id();
            $table->string('payment_no', 30)->unique();
            $table->foreignId('loan_id')->constrained();
            $table->date('date');
            $table->decimal('amount', 15, 2);
            $table->decimal('penalty', 15, 2)->default(0);
            $table->decimal('interest', 15, 2)->default(0);
            $table->decimal('principal', 15, 2)->default(0);
            $table->decimal('principal_after', 15, 2)->default(0); // principal still owed after this payment
            $table->string('method', 10);
            $table->foreignId('fund_account_id')->nullable()->constrained('chart_of_accounts');
            $table->string('reference', 100)->nullable();
            $table->string('remarks', 500)->nullable();
            $table->string('status', 15)->default('posted'); // posted | cancel_pending | cancelled
            $table->json('snapshot')->nullable(); // installment state before this payment (for cancellation)
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->string('cancel_reason', 300)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->index(['loan_id', 'status', 'date']);
            $table->index(['date', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('loan_payments');
        Schema::dropIfExists('loan_installments');
        Schema::dropIfExists('loan_guarantors');
        Schema::dropIfExists('loans');
        Schema::dropIfExists('loan_products');
    }
};
