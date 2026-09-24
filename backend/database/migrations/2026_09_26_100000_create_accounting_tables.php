<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chart_of_accounts', function (Blueprint $table) {
            $table->id();
            // Stable handle for accounts the code posts to (cash_irrigation, admission_fee_income …).
            $table->string('key', 50)->nullable()->unique();
            $table->string('code', 20)->unique();
            $table->string('name_bn', 150);
            $table->string('name_en', 150)->nullable();
            $table->string('type', 20)->index(); // asset|liability|equity|income|expense
            $table->foreignId('parent_id')->nullable()->constrained('chart_of_accounts');
            $table->boolean('is_postable')->default(true); // false = group header
            $table->boolean('is_system')->default(false); // can't be deleted/retyped
            $table->boolean('is_active')->default(true);
            $table->string('description', 500)->nullable();
            $table->timestamps();
        });

        Schema::create('accounting_periods', function (Blueprint $table) {
            $table->id();
            $table->string('period_key', 7)->unique(); // YYYY-MM
            $table->string('fiscal_year', 9)->nullable();
            $table->date('start_date');
            $table->date('end_date');
            $table->string('status', 10)->default('open'); // open|closed
            $table->foreignId('closed_by')->nullable()->constrained('users');
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();
        });

        Schema::create('journals', function (Blueprint $table) {
            $table->id();
            $table->string('voucher_no', 30)->unique();
            $table->string('voucher_type', 20)->index(); // journal|opening|receipt|payment|contra
            $table->date('date')->index();
            $table->string('narration', 500)->nullable();
            $table->string('module', 30)->nullable()->index();
            $table->nullableMorphs('source');
            $table->foreignId('period_id')->nullable()->constrained('accounting_periods');
            $table->string('status', 20)->default('posted')->index(); // pending|posted|rejected|returned|reversed
            $table->decimal('amount', 15, 2)->default(0);
            $table->foreignId('reversal_of_id')->nullable()->constrained('journals');
            $table->foreignId('reversed_by_id')->nullable()->constrained('journals');
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->foreignId('posted_by')->nullable()->constrained('users');
            $table->timestamp('posted_at')->nullable();
            $table->timestamps();
        });

        Schema::create('journal_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('journal_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained('chart_of_accounts');
            $table->decimal('debit', 15, 2)->default(0);
            $table->decimal('credit', 15, 2)->default(0);
            $table->string('remarks', 255)->nullable();
            $table->timestamp('reconciled_at')->nullable();
            $table->foreignId('reconciled_by')->nullable()->constrained('users');
            $table->index(['account_id', 'journal_id']);
        });

        Schema::create('bank_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->unique()->constrained('chart_of_accounts');
            $table->string('bank_name', 150);
            $table->string('branch_name', 150)->nullable();
            $table->string('account_no', 50);
            $table->string('account_type', 20)->default('current'); // current|savings|fdr
            $table->date('opened_on')->nullable();
            $table->date('fdr_maturity_date')->nullable();
            $table->decimal('fdr_interest_rate', 6, 2)->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('remarks', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bank_accounts');
        Schema::dropIfExists('journal_lines');
        Schema::dropIfExists('journals');
        Schema::dropIfExists('accounting_periods');
        Schema::dropIfExists('chart_of_accounts');
    }
};
