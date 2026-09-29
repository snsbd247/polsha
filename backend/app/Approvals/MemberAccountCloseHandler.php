<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\MemberAccount;
use App\Services\MemberFundService;

/** savings.account_close / share.account_close — the account closes only after approval. */
class MemberAccountCloseHandler implements ApprovalHandler
{
    public function __construct(private MemberFundService $funds) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->funds->close(MemberAccount::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->funds->keepOpen(MemberAccount::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->rejected($request);
    }
}
