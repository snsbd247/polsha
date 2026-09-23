<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\MembershipApplication;
use App\Services\MembershipService;

class MembershipAdmitHandler implements ApprovalHandler
{
    public function __construct(private MembershipService $membership) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->membership->admit($this->application($request), $request);
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
