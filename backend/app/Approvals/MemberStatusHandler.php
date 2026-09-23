<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Services\MembershipService;

/** Handles member.deactivate / activate / cancel / reactivate. */
class MemberStatusHandler implements ApprovalHandler
{
    public function __construct(private MembershipService $membership) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->membership->applyStatusChange($request);
    }

    // Nothing was changed while pending, so there is nothing to undo.
    public function rejected(ApprovalRequest $request): void {}

    public function returned(ApprovalRequest $request): void {}
}
