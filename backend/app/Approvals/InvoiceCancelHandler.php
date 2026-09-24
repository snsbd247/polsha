<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Invoice;
use App\Services\IrrigationService;

/** irrigation.invoice_cancel — the bill stands until approved. */
class InvoiceCancelHandler implements ApprovalHandler
{
    public function __construct(private IrrigationService $irrigation) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->irrigation->cancel(Invoice::findOrFail($request->approvable_id), $request->payload['কারণ'] ?? null);
    }

    public function rejected(ApprovalRequest $request): void {}

    public function returned(ApprovalRequest $request): void {}
}
