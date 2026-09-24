<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\Farmer;
use App\Models\Loan;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MembershipApplication;
use App\Models\MembershipStatusHistory;
use App\Models\Sequence;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class MembershipService
{
    /** action_key => [allowed from-statuses, to-status] */
    public const STATUS_ACTIONS = [
        'deactivate' => [[Member::ACTIVE], Member::INACTIVE],
        'activate' => [[Member::INACTIVE], Member::ACTIVE],
        'cancel' => [[Member::ACTIVE, Member::INACTIVE], Member::CANCELLED],
        'reactivate' => [[Member::CANCELLED], Member::ACTIVE],
    ];

    public function __construct(private ApprovalService $approvals) {}

    /** Send a draft/returned application into the two-step approval flow. */
    public function submitApplication(MembershipApplication $app): MembershipApplication
    {
        if (! in_array($app->status, MembershipApplication::EDITABLE, true)) {
            throw ValidationException::withMessages(['status' => __('এই আবেদন এখন পাঠানো যাবে না।')]);
        }
        $this->assertFarmerCanApply($app->farmer, $app->id);

        return DB::transaction(function () use ($app) {
            $app->load('farmer', 'nominees');
            $app->update(['status' => 'pending']);

            $request = $this->approvals->submit(
                'membership.admit',
                __('সদস্যপদ আবেদন: ').$app->farmer->name_bn.' ('.$app->application_no.')',
                $app,
                [
                    'কৃষক' => $app->farmer->name_bn.' ('.$app->farmer->farmer_code.')',
                    'পিতা' => $app->farmer->father_name,
                    'আবেদনের তারিখ' => $app->applied_on->format('d/m/Y'),
                    'ভর্তি ফি' => $app->admission_fee,
                    'নির্ধারিত ফি' => $app->default_fee,
                    'ফি পরিবর্তনের কারণ' => $app->fee_override_reason,
                    'ফি পরিশোধ' => $app->fee_status === 'paid' ? __('পরিশোধিত') : __('বাকি'),
                    'নমিনি' => $app->nominees->map(fn ($n) => "{$n->name} ({$n->relation}, {$n->share_percent}%)")->implode(', '),
                ],
                null,
                (float) $app->admission_fee,
            );

            // With the rule disabled the handler has already admitted the member inline.
            $app->refresh()->update(['approval_request_id' => $request->id]);

            return $app;
        });
    }

    public function assertFarmerCanApply(Farmer $farmer, ?int $ignoreApplicationId = null): void
    {
        if (! $farmer->is_active || $farmer->merged_into_id) {
            throw ValidationException::withMessages(['farmer_id' => __('নিষ্ক্রিয় কৃষক আবেদন করতে পারবেন না।')]);
        }
        if ($farmer->member()->exists()) {
            throw ValidationException::withMessages(['farmer_id' => __('এই কৃষক ইতিমধ্যে সদস্য।')]);
        }
        $pending = MembershipApplication::where('farmer_id', $farmer->id)
            ->where('status', 'pending')
            ->when($ignoreApplicationId, fn ($q) => $q->where('id', '!=', $ignoreApplicationId))
            ->exists();
        if ($pending) {
            throw ValidationException::withMessages(['farmer_id' => __('এই কৃষকের একটি আবেদন ইতিমধ্যে অনুমোদনের অপেক্ষায় আছে।')]);
        }
    }

    /** Called by the approval handler once both steps approve. */
    public function admit(MembershipApplication $app, ?ApprovalRequest $request): Member
    {
        return DB::transaction(function () use ($app, $request) {
            $member = Member::create([
                'farmer_id' => $app->farmer_id,
                'member_no' => $this->nextMemberNo(),
                'admitted_on' => now()->toDateString(),
                'status' => Member::ACTIVE,
                'application_id' => $app->id,
            ]);
            $app->nominees()->update(['member_id' => $member->id]);
            $app->update(['status' => 'approved', 'member_id' => $member->id]);

            MembershipStatusHistory::create([
                'member_id' => $member->id,
                'action' => 'admit',
                'to_status' => Member::ACTIVE,
                'effective_date' => $member->admitted_on,
                'fee' => $app->admission_fee,
                'resolution_no' => $app->resolution_no,
                'approval_request_id' => $request?->id,
                'created_by' => $request?->requested_by,
            ]);

            return $member;
        });
    }

    /** Record a member from the old paper register with their original number. */
    public function createLegacy(Farmer $farmer, int $memberNo, string $admittedOn, ?string $remarks, int $userId): Member
    {
        if ($farmer->member()->exists()) {
            throw ValidationException::withMessages(['farmer_id' => __('এই কৃষক ইতিমধ্যে সদস্য।')]);
        }
        if (Member::where('member_no', $memberNo)->exists()) {
            throw ValidationException::withMessages(['member_no' => __('এই সদস্য নম্বর ইতিমধ্যে ব্যবহৃত।')]);
        }

        return DB::transaction(function () use ($farmer, $memberNo, $admittedOn, $remarks, $userId) {
            $member = Member::create([
                'farmer_id' => $farmer->id,
                'member_no' => $memberNo,
                'admitted_on' => $admittedOn,
                'status' => Member::ACTIVE,
                'is_legacy' => true,
            ]);
            MembershipStatusHistory::create([
                'member_id' => $member->id,
                'action' => 'legacy',
                'to_status' => Member::ACTIVE,
                'effective_date' => $admittedOn,
                'reason' => $remarks,
                'created_by' => $userId,
            ]);

            // Keep the auto sequence ahead of every legacy number.
            $seq = Sequence::where('key', 'member')->lockForUpdate()->first();
            if ($seq && $memberNo >= $seq->next_value) {
                $seq->update(['next_value' => $memberNo + 1]);
            }

            return $member;
        });
    }

    /** Open an approval request to change a member's status. */
    public function requestStatusChange(Member $member, string $action, array $data): ApprovalRequest
    {
        [$from, $to] = self::STATUS_ACTIONS[$action];
        if (! in_array($member->status, $from, true)) {
            throw ValidationException::withMessages(['action' => __('বর্তমান অবস্থায় এই পরিবর্তন করা যাবে না।')]);
        }
        $pending = ApprovalRequest::where('approvable_type', Member::class)->where('approvable_id', $member->id)
            ->where('status', ApprovalRequest::PENDING)->exists();
        if ($pending) {
            throw ValidationException::withMessages(['action' => __('এই সদস্যের একটি পরিবর্তন ইতিমধ্যে অনুমোদনের অপেক্ষায় আছে।')]);
        }
        if ($action === 'cancel') {
            $this->assertNothingOutstanding($member);
        }

        $member->loadMissing('farmer');
        $labels = ['deactivate' => __('নিষ্ক্রিয়করণ'), 'activate' => __('সক্রিয়করণ'), 'cancel' => __('সদস্যপদ বাতিল'), 'reactivate' => __('পুনর্বহাল')];

        return $this->approvals->submit(
            "member.$action",
            $labels[$action].': '.$member->farmer->name_bn.__(' (সদস্য নং ').$member->member_no.')',
            $member,
            [
                'status' => $to,
                'effective_date' => $data['effective_date'],
                'reason_type' => $data['reason_type'] ?? null,
                'reason' => $data['reason'],
                'resolution_no' => $data['resolution_no'] ?? null,
                'fee' => $data['fee'] ?? null,
            ],
            ['status' => $member->status],
            isset($data['fee']) ? (float) $data['fee'] : null,
        );
    }

    /** Called by the approval handler. */
    public function applyStatusChange(ApprovalRequest $request): void
    {
        $action = explode('.', $request->action_key)[1];
        $p = $request->payload;

        DB::transaction(function () use ($request, $action, $p) {
            $member = Member::whereKey($request->approvable_id)->lockForUpdate()->firstOrFail();
            if ($action === 'cancel') {
                $this->assertNothingOutstanding($member); // money may have moved since the request
            }
            $from = $member->status;
            $member->update(['status' => $p['status'], 'status_changed_on' => $p['effective_date']]);

            MembershipStatusHistory::create([
                'member_id' => $member->id,
                'action' => $action,
                'from_status' => $from,
                'to_status' => $p['status'],
                'effective_date' => $p['effective_date'],
                'reason_type' => $p['reason_type'] ?? null,
                'reason' => $p['reason'] ?? null,
                'resolution_no' => $p['resolution_no'] ?? null,
                'fee' => $p['fee'] ?? null,
                'approval_request_id' => $request->id,
                'created_by' => $request->requested_by,
            ]);
        });
    }

    /** Membership cannot be cancelled while savings, share or a loan is still open. */
    private function assertNothingOutstanding(Member $member): void
    {
        $balances = MemberAccount::where('member_id', $member->id)->where('balance', '>', 0)->pluck('kind')->all();
        $loan = Loan::where('member_id', $member->id)->whereIn('status', Loan::OPEN)->value('loan_no');
        $problems = array_filter([
            in_array('savings', $balances, true) ? __('সঞ্চয় হিসাবে জমা আছে') : null,
            in_array('share', $balances, true) ? __('শেয়ার হিসাবে জমা আছে') : null,
            $loan ? __('ঋণ চলমান (:no)', ['no' => $loan]) : null,
        ]);
        if ($problems) {
            throw ValidationException::withMessages(['action' => __('সদস্যপদ বাতিল করা যাবে না: :list। আগে নিষ্পত্তি করুন।', ['list' => implode(', ', $problems)])]);
        }
    }

    public function nextMemberNo(): int
    {
        // Sequence has no prefix/padding for members, so the formatted value is the number.
        $max = (int) Member::max('member_no');
        $next = (int) SequenceService::next('member');
        while ($next <= $max) { // guards against numbers inserted outside the sequence
            $next = (int) SequenceService::next('member');
        }

        return $next;
    }
}
