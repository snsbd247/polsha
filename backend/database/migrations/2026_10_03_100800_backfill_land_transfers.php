<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Ownership changes made before land transfers were their own records
 * (straight from the land profile) are copied into land_transfers as
 * approved transfers, so the transfer list shows the whole history.
 * Each change becomes one row: the main previous owner to the main new owner.
 */
return new class extends Migration
{
    public function up(): void
    {
        $events = DB::table('land_owners as n')
            ->join('land_owners as p', fn ($j) => $j->on('p.land_id', '=', 'n.land_id')->on('p.end_date', '=', 'n.start_date'))
            ->select('n.land_id', 'n.start_date')->distinct()->orderBy('n.start_date')->get();
        $seq = 0;
        foreach ($events as $e) {
            $before = DB::table('land_owners')->where('land_id', $e->land_id)->where('end_date', $e->start_date)->orderByDesc('share_percent')->get();
            $after = DB::table('land_owners')->where('land_id', $e->land_id)->where('start_date', $e->start_date)->orderByDesc('share_percent')->get();
            $from = $before->first();
            // the main receiver is the biggest new owner who was not an owner before
            $to = $after->first(fn ($o) => ! $before->contains('farmer_id', $o->farmer_id)) ?? $after->first();
            if (! $from || ! $to || $from->farmer_id === $to->farmer_id) {
                continue;
            }
            $stillOwns = $after->contains('farmer_id', $from->farmer_id);
            $year = substr((string) $e->start_date, 0, 4);
            DB::table('land_transfers')->insert([
                'transfer_no' => 'LT-'.$year.'-H'.str_pad((string) ++$seq, 4, '0', STR_PAD_LEFT),
                'land_id' => $e->land_id, 'from_farmer_id' => $from->farmer_id, 'to_farmer_id' => $to->farmer_id,
                'type' => $stillOwns ? 'partial' : 'full', 'share_percent' => $to->share_percent, 'reason' => 'other',
                'transfer_date' => $e->start_date, 'amount' => null, 'remarks' => $to->remarks, 'status' => 'approved',
                'created_by' => $to->created_by, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::table('land_transfers')->where('transfer_no', 'like', 'LT-%-H%')->delete();
    }
};
