<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\WaterBill;
use App\Services\WaterService;

/** water.bill_cancel — the bill stands until approved. */
class WaterBillCancelHandler implements ApprovalHandler
{
    public function __construct(private WaterService $water) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->water->cancel(WaterBill::findOrFail($request->approvable_id), $request->payload['কারণ'] ?? null);
    }

    public function rejected(ApprovalRequest $request): void {}

    public function returned(ApprovalRequest $request): void {}
}
