<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\IrrigationRate;

/** irrigation.rate — a proposed rate goes live only when approved. */
class IrrigationRateHandler implements ApprovalHandler
{
    public function approved(ApprovalRequest $request): void
    {
        IrrigationRate::whereKey($request->approvable_id)->where('status', 'pending')->first()
            ?->update(['status' => 'approved', 'approved_by' => auth()->id(), 'approved_at' => now()]);
    }

    public function rejected(ApprovalRequest $request): void
    {
        IrrigationRate::whereKey($request->approvable_id)->where('status', 'pending')->first()?->update(['status' => 'rejected']);
    }

    /** Nothing to correct in place — a fresh proposal is simpler — so "returned" also closes it. */
    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }
}
