<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\LandTransfer;
use App\Services\LandTransferService;

class LandTransferHandler implements ApprovalHandler
{
    public function __construct(private LandTransferService $transfers) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->transfers->apply(LandTransfer::findOrFail($request->payload['transfer_id']), (int) $request->requested_by);
    }

    public function rejected(ApprovalRequest $request): void
    {
        LandTransfer::whereKey($request->payload['transfer_id'])->update(['status' => 'rejected']);
    }

    /** Sent back for correction: it becomes an editable draft again. */
    public function returned(ApprovalRequest $request): void
    {
        LandTransfer::whereKey($request->payload['transfer_id'])->update(['status' => 'draft']);
    }
}
