<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\Farmer;
use App\Models\FarmerDocument;
use App\Models\Household;
use App\Models\Member;
use App\Models\MembershipApplication;
use App\Models\Patwari;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class FarmerMergeService
{
    /** Fields the reviewer may pick from either record. */
    public const MERGEABLE = [
        'name_bn', 'name_en', 'father_name', 'mother_name', 'spouse_name', 'gender', 'date_of_birth',
        'nid', 'birth_reg_no', 'mobile', 'alt_mobile', 'photo', 'village_id', 'mouza_id', 'para',
        'post_office', 'household_id', 'household_relation', 'occupation', 'remarks',
    ];

    public function __construct(private ApprovalService $approvals) {}

    /**
     * @param  array<string,'keep'|'remove'>  $choices  which record each field's value comes from
     */
    public function request(Farmer $keep, Farmer $remove, array $choices): ApprovalRequest
    {
        $this->assertMergeable($keep, $remove);

        $values = [];
        foreach (self::MERGEABLE as $field) {
            $values[$field] = ($choices[$field] ?? 'keep') === 'remove' ? $remove->{$field} : $keep->{$field};
        }
        $values = array_map(fn ($v) => $v instanceof \DateTimeInterface ? $v->format('Y-m-d') : $v, $values);

        return $this->approvals->submit(
            'farmer.merge',
            __('কৃষক মার্জ: :p0 → :p1 (:p2)', ['p0' => $remove->farmer_code, 'p1' => $keep->farmer_code, 'p2' => $keep->name_bn]),
            $keep,
            ['keep_id' => $keep->id, 'remove_id' => $remove->id, 'values' => $values],
            ['keep' => $keep->farmer_code, 'remove' => $remove->farmer_code],
        );
    }

    public function assertMergeable(Farmer $keep, Farmer $remove): void
    {
        if ($keep->id === $remove->id) {
            throw ValidationException::withMessages(['remove_id' => __('একই কৃষককে মার্জ করা যায় না।')]);
        }
        if ($keep->merged_into_id || $remove->merged_into_id) {
            throw ValidationException::withMessages(['remove_id' => __('একটি রেকর্ড ইতিমধ্যে মার্জ হয়েছে।')]);
        }
        if ($keep->member()->exists() && $remove->member()->exists()) {
            throw ValidationException::withMessages(['remove_id' => __('দুজনই সদস্য। আগে একজনের সদস্যপদ বাতিল করুন।')]);
        }
        $pending = ApprovalRequest::where('action_key', 'farmer.merge')->where('status', ApprovalRequest::PENDING)->get()
            ->contains(fn ($r) => array_intersect([$keep->id, $remove->id], [$r->payload['keep_id'] ?? 0, $r->payload['remove_id'] ?? 0]));
        if ($pending) {
            throw ValidationException::withMessages(['remove_id' => __('এই কৃষকদের একটি মার্জ অনুরোধ ইতিমধ্যে অপেক্ষমাণ।')]);
        }
    }

    /** Called by the approval handler. */
    public function apply(ApprovalRequest $request): void
    {
        $p = $request->payload;

        DB::transaction(function () use ($p) {
            $keep = Farmer::lockForUpdate()->findOrFail($p['keep_id']);
            $remove = Farmer::lockForUpdate()->findOrFail($p['remove_id']);
            $this->assertMergeableAtApply($keep, $remove);

            // Free unique NID before the kept record may take it.
            $remove->update(['nid' => null, 'merged_into_id' => $keep->id, 'is_active' => false]);
            $keep->update(array_intersect_key($p['values'], array_flip(self::MERGEABLE)));

            FarmerDocument::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            MembershipApplication::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            Member::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            Household::where('head_farmer_id', $remove->id)->update(['head_farmer_id' => $keep->id]);
            Patwari::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);

            AuditLogger::log('farmer', 'merge', $keep, ['removed' => $remove->farmer_code], ['kept' => $keep->farmer_code]);
        });
    }

    private function assertMergeableAtApply(Farmer $keep, Farmer $remove): void
    {
        if ($keep->merged_into_id || $remove->merged_into_id) {
            throw ValidationException::withMessages(['remove_id' => __('একটি রেকর্ড ইতিমধ্যে মার্জ হয়েছে।')]);
        }
        if (Member::whereIn('farmer_id', [$keep->id, $remove->id])->count() > 1) {
            throw ValidationException::withMessages(['remove_id' => __('দুজনই সদস্য। আগে একজনের সদস্যপদ বাতিল করুন।')]);
        }
    }
}
