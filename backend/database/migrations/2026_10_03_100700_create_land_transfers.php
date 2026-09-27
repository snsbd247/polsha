<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A land transfer as a record of its own: drafted, sent for approval and,
 * once approved, applied to the plot's owners (land_owners keeps the history).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('land_transfers', function (Blueprint $table) {
            $table->id();
            $table->string('transfer_no', 30)->unique();
            $table->foreignId('land_id')->constrained();
            $table->foreignId('from_farmer_id')->constrained('farmers');
            $table->foreignId('to_farmer_id')->constrained('farmers');
            $table->string('type', 10);            // full | partial
            $table->decimal('share_percent', 5, 2); // share of the whole plot that changes hands
            $table->string('reason', 20);          // sale | inheritance | gift | exchange | court | other
            $table->date('transfer_date');
            $table->decimal('amount', 15, 2)->nullable();
            $table->string('remarks', 500)->nullable();
            $table->string('status', 12)->default('draft'); // draft | pending | approved | rejected
            $table->foreignId('approval_request_id')->nullable()->constrained();
            $table->foreignId('created_by')->nullable()->constrained('users');
            $table->timestamps();
            $table->index(['land_id', 'status']);
        });

        if (! DB::table('sequences')->where('key', 'land_transfer')->exists()) {
            DB::table('sequences')->insert([
                'key' => 'land_transfer', 'label' => 'জমি হস্তান্তর', 'prefix' => 'LT-{YYYY}-', 'pad_length' => 4,
                'next_value' => 1, 'reset_yearly' => true, 'current_year' => (int) date('Y'), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        if (! DB::table('approval_rules')->where('action_key', 'land.transfer')->exists()) {
            DB::table('approval_rules')->insert([
                'action_key' => 'land.transfer', 'module' => 'land', 'label' => 'জমি হস্তান্তর',
                'steps' => json_encode([['manager']]), 'enabled' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('land_transfers');
        DB::table('sequences')->where('key', 'land_transfer')->delete();
        DB::table('approval_rules')->where('action_key', 'land.transfer')->delete();
    }
};
