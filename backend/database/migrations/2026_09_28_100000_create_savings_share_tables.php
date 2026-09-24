<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One savings and one share account per member — separate rows (kind),
        // separate numbers and separate ledger accounts; never mixed.
        Schema::create('member_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('kind', 10); // savings | share
            $table->foreignId('member_id')->constrained();
            $table->string('account_no', 30)->unique();
            $table->date('opened_on');
            $table->string('status', 10)->default('active'); // active | closed
            $table->decimal('balance', 15, 2)->default(0); // posted transactions only
            $table->string('remarks', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
            $table->unique(['kind', 'member_id']);
        });

        // Runs of profit (manual per member) and dividend (pro-rata on share capital).
        Schema::create('distribution_runs', function (Blueprint $table) {
            $table->id();
            $table->string('run_no', 30)->unique();
            $table->string('kind', 10); // profit | dividend
            $table->string('title', 200);
            $table->date('date');
            $table->date('basis_date')->nullable(); // dividend: share balances as of
            $table->decimal('pool_amount', 15, 2)->nullable(); // dividend: total to share out
            $table->decimal('total_amount', 15, 2)->default(0);
            $table->string('status', 10)->default('pending'); // pending | posted | rejected
            $table->string('remarks', 500)->nullable();
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('posted_at')->nullable();
            $table->timestamps();
        });

        Schema::create('member_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('txn_no', 30)->unique();
            $table->foreignId('member_account_id')->constrained();
            $table->string('kind', 10); // copy of the account's kind, for filtering
            $table->date('date');
            // savings: opening|deposit|withdrawal|adjustment|profit|dividend
            // share:   opening|purchase|transfer_in|transfer_out|adjustment
            $table->string('type', 15);
            $table->string('direction', 3); // in | out
            $table->decimal('amount', 15, 2);
            $table->decimal('balance_after', 15, 2)->nullable(); // set when posted
            $table->string('status', 15)->default('posted'); // pending | posted | rejected | cancel_pending | cancelled
            $table->string('method', 10)->nullable(); // cash | bank | other (money in/out only)
            $table->foreignId('fund_account_id')->nullable()->constrained('chart_of_accounts');
            $table->foreignId('counter_account_id')->nullable()->constrained('chart_of_accounts'); // adjustment
            $table->string('reference', 100)->nullable();
            $table->string('remarks', 500)->nullable();
            $table->foreignId('pair_id')->nullable()->constrained('member_transactions'); // share transfer other leg
            $table->foreignId('run_id')->nullable()->constrained('distribution_runs');
            $table->foreignId('journal_id')->nullable()->constrained();
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->string('cancel_reason', 300)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamp('posted_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->index(['member_account_id', 'status', 'date']);
            $table->index(['kind', 'type', 'date']);
        });

        Schema::create('distribution_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('run_id')->constrained('distribution_runs')->cascadeOnDelete();
            $table->foreignId('member_id')->constrained();
            $table->decimal('basis', 15, 2)->default(0); // savings / share balance used
            $table->decimal('amount', 15, 2);
            $table->foreignId('transaction_id')->nullable()->constrained('member_transactions');
            $table->timestamps();
            $table->unique(['run_id', 'member_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('distribution_items');
        Schema::dropIfExists('member_transactions');
        Schema::dropIfExists('distribution_runs');
        Schema::dropIfExists('member_accounts');
    }
};
