<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\MemberTransaction;
use App\Services\MemberFundService;

/** savings.opening|withdrawal|adjustment, share.opening|transfer|adjustment — posted only when approved. */
class MemberTxnHandler implements ApprovalHandler
{
    public function __construct(private MemberFundService $funds) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->funds->post(MemberTransaction::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->funds->reject(MemberTransaction::findOrFail($request->approvable_id));
    }

    /** A corrected request is simpler to enter fresh, so "returned" also closes it. */
    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }
}
