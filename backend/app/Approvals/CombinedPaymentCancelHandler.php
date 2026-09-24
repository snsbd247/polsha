<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\CombinedPayment;
use App\Services\CombinedPaymentService;

/** payment.combined_cancel — every part is reversed together after approval. */
class CombinedPaymentCancelHandler implements ApprovalHandler
{
    public function __construct(private CombinedPaymentService $payments) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->payments->cancel(CombinedPayment::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->payments->keep(CombinedPayment::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->payments->keep(CombinedPayment::findOrFail($request->approvable_id));
    }
}
