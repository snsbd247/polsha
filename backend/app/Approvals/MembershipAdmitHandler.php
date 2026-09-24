<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\MembershipApplication;
use App\Services\LedgerService;
use App\Services\MembershipService;

class MembershipAdmitHandler implements ApprovalHandler
{
    public function __construct(private MembershipService $membership, private LedgerService $ledger) {}

    public function approved(ApprovalRequest $request): void
    {
        $app = $this->application($request);
        $this->membership->admit($app, $request);
        // Admission fee goes to the ledger on the day of admission.
        $this->ledger->postAdmissionFee($app->fresh(), now()->toDateString());
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
