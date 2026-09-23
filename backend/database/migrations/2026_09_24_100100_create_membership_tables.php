<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farmer_id')->unique()->constrained();
            // Numeric so legacy numbers (96, 230, 5876, 10001) sort correctly.
            $table->unsignedInteger('member_no')->unique();
            $table->date('admitted_on');
            $table->string('status', 20)->default('active')->index(); // active | inactive | cancelled
            $table->boolean('is_legacy')->default(false);
            $table->date('status_changed_on')->nullable();
            $table->timestamps();
        });

        Schema::create('membership_applications', function (Blueprint $table) {
            $table->id();
            $table->string('application_no', 30)->unique();
            $table->foreignId('farmer_id')->constrained();
            $table->date('applied_on');
            $table->foreignId('proposer_member_id')->nullable()->constrained('members');
            $table->foreignId('seconder_member_id')->nullable()->constrained('members');
            $table->decimal('admission_fee', 15, 2);
            $table->decimal('default_fee', 15, 2);
            $table->string('fee_override_reason', 500)->nullable();
            $table->string('fee_status', 10)->default('paid'); // paid | due
            $table->unsignedInteger('initial_shares')->nullable();
            $table->string('form_scan')->nullable();
            $table->string('signature')->nullable();
            $table->string('resolution_no', 50)->nullable();
            $table->date('resolution_date')->nullable();
            $table->string('status', 20)->default('draft')->index(); // draft|pending|approved|rejected|returned|cancelled
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->foreignId('member_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        Schema::table('members', function (Blueprint $table) {
            $table->foreignId('application_id')->nullable()->after('is_legacy')->constrained('membership_applications');
        });

        Schema::create('membership_nominees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->nullable()->constrained('membership_applications')->cascadeOnDelete();
            $table->foreignId('member_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('relation', 30);
            $table->string('nid', 17)->nullable();
            $table->string('mobile', 11)->nullable();
            $table->decimal('share_percent', 5, 2);
            $table->timestamps();
        });

        Schema::create('membership_status_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('member_id')->constrained()->cascadeOnDelete();
            $table->string('action', 20); // admit | legacy | deactivate | activate | cancel | reactivate
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->date('effective_date');
            $table->string('reason_type', 30)->nullable();
            $table->string('reason', 1000)->nullable();
            $table->string('resolution_no', 50)->nullable();
            $table->decimal('fee', 15, 2)->nullable();
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        Schema::create('voter_lists', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->date('cutoff_date');
            $table->unsignedSmallInteger('min_months')->default(0);
            $table->unsignedInteger('eligible_count')->default(0);
            $table->unsignedInteger('ineligible_count')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
        });

        // Snapshot: names are copied so the printed list never changes later.
        Schema::create('voter_list_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('voter_list_id')->constrained()->cascadeOnDelete();
            $table->foreignId('member_id')->constrained();
            $table->unsignedInteger('serial')->nullable();
            $table->unsignedInteger('member_no');
            $table->string('name');
            $table->string('father_name');
            $table->string('village')->nullable();
            $table->boolean('eligible');
            $table->string('reason')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('voter_list_items');
        Schema::dropIfExists('voter_lists');
        Schema::dropIfExists('membership_status_history');
        Schema::dropIfExists('membership_nominees');
        Schema::table('members', fn (Blueprint $t) => $t->dropConstrainedForeignId('application_id'));
        Schema::dropIfExists('membership_applications');
        Schema::dropIfExists('members');
    }
};
