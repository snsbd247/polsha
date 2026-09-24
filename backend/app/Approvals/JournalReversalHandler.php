<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Journal;
use App\Services\LedgerService;

/** accounting.reversal — nothing changes until approved. */
class JournalReversalHandler implements ApprovalHandler
{
    public function __construct(private LedgerService $ledger) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->ledger->reverse(Journal::findOrFail($request->approvable_id), $request->payload['কারণ'] ?? null);
    }

    public function rejected(ApprovalRequest $request): void {}

    public function returned(ApprovalRequest $request): void {}
}
