<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\DistributionRun;
use App\Services\MemberFundService;

/** savings.profit / share.dividend — members are credited only after approval. */
class DistributionRunHandler implements ApprovalHandler
{
    public function __construct(private MemberFundService $funds) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->funds->postRun(DistributionRun::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->funds->rejectRun(DistributionRun::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }
}
