<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('farmers', function (Blueprint $table) {
            $table->string('delete_reason', 20)->nullable()->after('merged_into_id');
            $table->string('delete_note', 300)->nullable()->after('delete_reason');
            $table->foreignId('deleted_by')->nullable()->after('delete_note')->constrained('users')->nullOnDelete();
            $table->timestamp('removed_at')->nullable()->after('deleted_by'); // deleted or merged away
            $table->index('removed_at');
        });

        // Existing deleted records: who deleted them and the typed reason come from the audit log.
        $logs = DB::table('audit_logs')->where('auditable_type', 'Farmer')->where('action', 'delete')->orderBy('id')->get()->keyBy('auditable_id');
        foreach (DB::table('farmers')->whereNotNull('deleted_at')->get(['id', 'deleted_at']) as $f) {
            DB::table('farmers')->where('id', $f->id)->update([
                'delete_reason' => 'other', 'delete_note' => $logs[$f->id]->description ?? null,
                'deleted_by' => $logs[$f->id]->user_id ?? null, 'removed_at' => $f->deleted_at,
            ]);
        }
        DB::table('farmers')->whereNotNull('merged_into_id')->update(['delete_reason' => 'merged', 'removed_at' => DB::raw('updated_at')]);
    }

    public function down(): void
    {
        Schema::table('farmers', function (Blueprint $table) {
            $table->dropIndex(['removed_at']);
            $table->dropConstrainedForeignId('deleted_by');
            $table->dropColumn(['delete_reason', 'delete_note', 'removed_at']);
        });
    }
};
