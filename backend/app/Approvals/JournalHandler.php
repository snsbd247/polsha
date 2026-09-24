<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Journal;
use App\Services\LedgerService;

/** accounting.journal — manual journal and opening-balance vouchers. */
class JournalHandler implements ApprovalHandler
{
    public function __construct(private LedgerService $ledger) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->ledger->approve(Journal::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        Journal::whereKey($request->approvable_id)->where('status', 'pending')->update(['status' => 'rejected']);
    }

    public function returned(ApprovalRequest $request): void
    {
        Journal::whereKey($request->approvable_id)->where('status', 'pending')->update(['status' => 'returned']);
    }
}
