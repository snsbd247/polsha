<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Services\FarmerMergeService;

class FarmerMergeHandler implements ApprovalHandler
{
    public function __construct(private FarmerMergeService $merge) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->merge->apply($request);
    }

    public function rejected(ApprovalRequest $request): void {}

    public function returned(ApprovalRequest $request): void {}
}
