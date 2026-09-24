<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Receipt;
use App\Services\ReceiptService;

/** payment.receipt_cancel — reversal happens only after approval. */
class ReceiptCancelHandler implements ApprovalHandler
{
    public function __construct(private ReceiptService $receipts) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->receipts->cancel(Receipt::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->receipts->keep(Receipt::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->receipts->keep(Receipt::findOrFail($request->approvable_id));
    }
}
