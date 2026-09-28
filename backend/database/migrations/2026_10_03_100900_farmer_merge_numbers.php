<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Merge requests get a number (MR-YYYY-001) and a snapshot of both records,
 * so the merge list can show them even after the merged-away record lost its NID.
 */
return new class extends Migration
{
    public function up(): void
    {
        $counts = [];
        foreach (DB::table('approval_requests')->where('action_key', 'farmer.merge')->orderBy('id')->get() as $r) {
            $p = json_decode($r->payload ?? '{}', true) ?: [];
            if (! empty($p['request_no'])) {
                continue;
            }
            $year = (int) substr((string) $r->created_at, 0, 4);
            $counts[$year] = ($counts[$year] ?? 0) + 1;
            $p['request_no'] = sprintf('MR-%d-%03d', $year, $counts[$year]);
            $p['snapshot'] ??= [
                'keep' => $this->snapshot($p['keep_id'] ?? 0),
                'remove' => $this->snapshot($p['remove_id'] ?? 0),
            ];
            DB::table('approval_requests')->where('id', $r->id)->update(['payload' => json_encode($p, JSON_UNESCAPED_UNICODE)]);
        }

        $year = (int) date('Y');
        if (! DB::table('sequences')->where('key', 'farmer_merge')->exists()) {
            DB::table('sequences')->insert([
                'key' => 'farmer_merge', 'label' => 'কৃষক মার্জ অনুরোধ', 'prefix' => 'MR-{YYYY}-', 'pad_length' => 3,
                'next_value' => ($counts[$year] ?? 0) + 1, 'reset_yearly' => true, 'current_year' => $year, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    private function snapshot(int $id): array
    {
        $f = DB::table('farmers')->where('id', $id)->first(['nid', 'mobile']);

        return ['nid' => $f?->nid, 'mobile' => $f?->mobile, 'member_no' => DB::table('members')->where('farmer_id', $id)->value('member_no')];
    }

    public function down(): void
    {
        DB::table('sequences')->where('key', 'farmer_merge')->delete();
    }
};
