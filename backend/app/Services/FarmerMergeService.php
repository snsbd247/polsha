<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\CombinedPayment;
use App\Models\Farmer;
use App\Models\FarmerDocument;
use App\Models\FarmerFamilyMember;
use App\Models\Household;
use App\Models\Invoice;
use App\Models\LandCultivation;
use App\Models\LandOwner;
use App\Models\Loan;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MembershipApplication;
use App\Models\MemberTransaction;
use App\Models\Patwari;
use App\Models\PublicPaymentRequest;
use App\Models\Receipt;
use App\Models\VoterListItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class FarmerMergeService
{
    /** Fields the reviewer may pick from either record. */
    public const MERGEABLE = [
        'name_bn', 'name_en', 'father_name', 'mother_name', 'spouse_name', 'gender', 'date_of_birth',
        'nid', 'birth_reg_no', 'mobile', 'alt_mobile', 'photo', 'village_id', 'mouza_id', 'para',
        'post_office', 'household_id', 'household_relation', 'occupation', 'remarks',
        'email', 'post_code', 'blood_group', 'education_level', 'farmer_type',
    ];

    /**
     * Farmer-linked records the reviewer may choose to move. Savings, loans and
     * voter entries hang on the member record, so they always follow membership.
     */
    public const TRANSFERABLE = ['land', 'irrigation'];

    /** Why the two records are one person — shown on the merge list. */
    public const REASONS = [
        'duplicate' => 'ডুপ্লিকেট রেকর্ড (একই ব্যক্তি)',
        'name_variation' => 'নামের ভিন্নতা',
        'spelling' => 'বানানের ভিন্নতা',
        'registration' => 'নিবন্ধনের সময় দুবার এন্ট্রি',
        'different_name' => 'একই ব্যক্তি (ভিন্ন নাম)',
        'multiple' => 'একাধিক নিবন্ধন',
        'same_nid' => 'একই NID',
        'other' => 'অন্যান্য',
    ];

    public function __construct(private ApprovalService $approvals) {}

    /** Counts of what each record carries, shown on the merge screen. */
    public static function related(Farmer $f): array
    {
        $memberId = Member::where('farmer_id', $f->id)->value('id');

        return [
            'land' => DB::table('land_owners')->where('farmer_id', $f->id)->pluck('land_id')
                ->merge(DB::table('land_cultivations')->where('farmer_id', $f->id)->pluck('land_id'))->unique()->count(),
            'irrigation' => Invoice::where('farmer_id', $f->id)->count(),
            'savings' => $memberId ? MemberTransaction::whereIn('member_account_id', MemberAccount::where('member_id', $memberId)->where('kind', 'savings')->select('id'))->count() : 0,
            'loan' => $memberId ? Loan::where('member_id', $memberId)->count() : 0,
            'membership' => (bool) $memberId,
            'voter' => $memberId ? VoterListItem::where('member_id', $memberId)->count() : 0,
        ];
    }

    /**
     * @param  array<string,'keep'|'remove'>  $choices  which record each field's value comes from
     * @param  list<string>|null  $transfer  TRANSFERABLE groups to move; null = all
     */
    public function request(Farmer $keep, Farmer $remove, array $choices, ?array $transfer = null, string $reason = 'duplicate', ?string $note = null, ?string $requestNo = null): ApprovalRequest
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
            [
                'request_no' => $requestNo ?? SequenceService::next('farmer_merge'),
                'keep_id' => $keep->id, 'remove_id' => $remove->id, 'values' => $values,
                'transfer' => array_values(array_intersect(self::TRANSFERABLE, $transfer ?? self::TRANSFERABLE)),
                'reason' => $reason, 'reason_note' => $note,
                // the merged-away record loses its NID, so the list keeps what both looked like
                'snapshot' => ['keep' => self::snapshot($keep), 'remove' => self::snapshot($remove)],
            ],
            ['keep' => $keep->farmer_code, 'remove' => $remove->farmer_code],
        );
    }

    /** A pending request changed by its sender: the old one goes, the new one keeps its number. */
    public function replace(ApprovalRequest $old, Farmer $keep, Farmer $remove, array $choices, ?array $transfer, string $reason, ?string $note): ApprovalRequest
    {
        return DB::transaction(function () use ($old, $keep, $remove, $choices, $transfer, $reason, $note) {
            $no = $old->payload['request_no'] ?? null;
            $this->withdraw($old, 'edit');

            return $this->request($keep, $remove, $choices, $transfer, $reason, $note, $no);
        });
    }

    /** Remove a request that is still waiting; decided ones stay as history. */
    public function withdraw(ApprovalRequest $r, string $why = 'delete'): void
    {
        if ($r->action_key !== 'farmer.merge' || $r->status !== ApprovalRequest::PENDING) {
            throw ValidationException::withMessages(['status' => __('শুধু অপেক্ষমাণ মার্জ অনুরোধ বদলানো বা মুছা যায়।')]);
        }
        AuditLogger::log('farmer', 'merge_request_'.$why, $r, ['request_no' => $r->payload['request_no'] ?? null, 'keep_id' => $r->payload['keep_id'] ?? null, 'remove_id' => $r->payload['remove_id'] ?? null]);
        $r->delete();
    }

    public static function snapshot(Farmer $f): array
    {
        return ['nid' => $f->nid, 'mobile' => $f->mobile, 'member_no' => Member::where('farmer_id', $f->id)->value('member_no')];
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
        $requestedBy = $request->requested_by;

        DB::transaction(function () use ($p, $requestedBy) {
            $keep = Farmer::lockForUpdate()->findOrFail($p['keep_id']);
            $remove = Farmer::lockForUpdate()->findOrFail($p['remove_id']);
            $this->assertMergeableAtApply($keep, $remove);

            // Free unique NID before the kept record may take it.
            $remove->update(['nid' => null, 'merged_into_id' => $keep->id, 'is_active' => false,
                'delete_reason' => 'merged', 'deleted_by' => $requestedBy, 'removed_at' => now()]);
            $keep->update(array_intersect_key($p['values'], array_flip(self::MERGEABLE)));

            FarmerDocument::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            MembershipApplication::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            Member::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            Household::where('head_farmer_id', $remove->id)->update(['head_farmer_id' => $keep->id]);
            Patwari::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            FarmerFamilyMember::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);

            // Requests made before the transfer choice existed moved nothing else.
            $transfer = $p['transfer'] ?? [];
            if (in_array('land', $transfer, true)) {
                LandOwner::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
                LandCultivation::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
            }
            if (in_array('irrigation', $transfer, true)) {
                foreach ([Invoice::class, Receipt::class, CombinedPayment::class, PublicPaymentRequest::class] as $model) {
                    $model::where('farmer_id', $remove->id)->update(['farmer_id' => $keep->id]);
                }
            }

            AuditLogger::log('farmer', 'merge', $keep, ['removed' => $remove->farmer_code], ['kept' => $keep->farmer_code, 'transfer' => $transfer]);
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
