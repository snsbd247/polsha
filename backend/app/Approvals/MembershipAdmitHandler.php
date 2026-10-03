<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\MemberAccount;
use App\Models\MembershipApplication;
use App\Services\LedgerService;
use App\Services\MemberFundService;
use App\Services\MembershipService;
use App\Services\SettingService;

class MembershipAdmitHandler implements ApprovalHandler
{
    public function __construct(private MembershipService $membership, private LedgerService $ledger, private MemberFundService $funds) {}

    public function approved(ApprovalRequest $request): void
    {
        $app = $this->application($request);
        $member = $this->membership->admit($app, $request);
        $today = now()->toDateString();
        // Admission fee goes to the ledger on the day of admission.
        $this->ledger->postAdmissionFee($app->fresh(), $today);
        // The first shares were paid with the fee: they are bought into the new share account the same day.
        // With the fee still due, nothing was paid, so the shares wait for the member to pay.
        $shares = (int) $app->initial_shares;
        if ($app->fee_status === 'paid' && $shares > 0) {
            $account = MemberAccount::where('member_id', $member->id)->where('kind', 'share')->first();
            $unit = (float) SettingService::get('share_unit_price', 10) ?: 10.0;
            if ($account) {
                $this->funds->moneyIn($account, [
                    'date' => $today, 'amount' => round($shares * $unit, 2), 'method' => 'cash',
                    'remarks' => __('প্রাথমিক শেয়ার — আবেদন :no', ['no' => $app->application_no]),
                ]);
            }
        }
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->application($request)->update(['status' => 'rejected']);
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->application($request)->update(['status' => 'returned']);
    }

    private function application(ApprovalRequest $request): MembershipApplication
    {
        return MembershipApplication::findOrFail($request->approvable_id);
    }
}
