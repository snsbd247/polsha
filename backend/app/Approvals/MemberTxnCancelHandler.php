<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\MemberTransaction;
use App\Services\MemberFundService;

/** savings.txn_cancel / share.txn_cancel — the voucher is reversed only after approval. */
class MemberTxnCancelHandler implements ApprovalHandler
{
    public function __construct(private MemberFundService $funds) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->funds->cancel(MemberTransaction::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->funds->keep(MemberTransaction::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }
}
