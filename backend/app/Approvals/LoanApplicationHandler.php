<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Loan;
use App\Services\LoanService;

/** loan.application — approved loans wait for disbursement. */
class LoanApplicationHandler implements ApprovalHandler
{
    public function __construct(private LoanService $loans) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->loans->approve(Loan::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->loans->reject(Loan::findOrFail($request->approvable_id));
    }

    /** A corrected application is simpler to enter fresh, so "returned" also closes it. */
    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }
}
