<?php

namespace App\Services;

use App\Models\Member;
use App\Models\VoterList;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class VoterListService
{
    /**
     * Snapshot every member as of $cutoff. Eligible = active on the cutoff
     * date and admitted at least `voter_min_membership_months` before it.
     * Ineligible members are kept with a reason for the voter audit.
     */
    public function generate(string $title, string $cutoff, int $userId): VoterList
    {
        $cutoffDate = Carbon::parse($cutoff)->endOfDay();
        $minMonths = (int) SettingService::get('voter_min_membership_months', 0);

        return DB::transaction(function () use ($title, $cutoffDate, $minMonths, $userId) {
            $list = VoterList::create([
                'title' => $title,
                'cutoff_date' => $cutoffDate->toDateString(),
                'min_months' => $minMonths,
                'created_by' => $userId,
            ]);

            $members = Member::with(['farmer.village:id,name_bn', 'history'])
                ->where('admitted_on', '<=', $cutoffDate->toDateString())
                ->orderBy('member_no')
                ->get();

            $serial = 0;
            $eligible = 0;
            $rows = [];
            foreach ($members as $m) {
                $reason = $this->ineligibility($m, $cutoffDate, $minMonths);
                if ($reason === null) {
                    $eligible++;
                }
                $rows[] = [
                    'voter_list_id' => $list->id,
                    'member_id' => $m->id,
                    'serial' => $reason === null ? ++$serial : null,
                    'member_no' => $m->member_no,
                    'name' => $m->farmer->name_bn,
                    'father_name' => $m->farmer->father_name,
                    'village' => $m->farmer->village?->name_bn,
                    'eligible' => $reason === null,
                    'reason' => $reason,
                ];
            }
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('voter_list_items')->insert($chunk);
            }

            $list->update(['eligible_count' => $eligible, 'ineligible_count' => count($rows) - $eligible]);

            return $list;
        });
    }

    private function ineligibility(Member $m, Carbon $cutoff, int $minMonths): ?string
    {
        $status = $this->statusAt($m, $cutoff);
        if ($status !== Member::ACTIVE) {
            return $status === Member::CANCELLED ? __('সদস্যপদ বাতিল') : __('নিষ্ক্রিয় সদস্য');
        }
        if ($minMonths > 0 && $m->admitted_on->copy()->addMonths($minMonths)->greaterThan($cutoff)) {
            return __('সদস্যপদ :p0 মাস পূর্ণ হয়নি', ['p0' => $minMonths]);
        }

        return null;
    }

    /** Status on the cutoff date, replaying the history so back-dated lists stay correct. */
    private function statusAt(Member $m, Carbon $cutoff): string
    {
        $last = $m->history
            ->filter(fn ($h) => $h->effective_date->lessThanOrEqualTo($cutoff))
            ->sortBy([['effective_date', 'desc'], ['id', 'desc']])
            ->first();

        return $last?->to_status ?? $m->status;
    }
}
