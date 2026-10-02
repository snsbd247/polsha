<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\IrrigationRate;
use Illuminate\Database\Eloquent\Builder;

/**
 * irrigation.rate_batch — a season's rates copied from an earlier season,
 * approved (or turned down) together. The request points at the season.
 */
class IrrigationRateBatchHandler implements ApprovalHandler
{
    public function approved(ApprovalRequest $request): void
    {
        $this->rates($request)->update(['status' => 'approved', 'approved_by' => auth()->id(), 'approved_at' => now()]);
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->rates($request)->update(['status' => 'rejected']);
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }

    /** This batch's rates: linked to the request, or (when no approval was needed) not linked yet. */
    private function rates(ApprovalRequest $request): Builder
    {
        return IrrigationRate::where('season_id', $request->approvable_id)->where('status', 'pending')
            ->where(fn ($q) => $q->where('approval_request_id', $request->id)->orWhereNull('approval_request_id'));
    }
}
