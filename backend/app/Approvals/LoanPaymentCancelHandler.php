<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\LoanPayment;
use App\Services\LoanService;

/** loan.payment_cancel — the voucher is reversed only after approval. */
class LoanPaymentCancelHandler implements ApprovalHandler
{
    public function __construct(private LoanService $loans) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->loans->cancelPayment(LoanPayment::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->loans->keepPayment(LoanPayment::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }
}
