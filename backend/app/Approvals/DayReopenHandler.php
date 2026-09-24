<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\DayClose;
use App\Services\DayCloseService;

/** cash.day_reopen — the day opens for cash entries again only after approval. */
class DayReopenHandler implements ApprovalHandler
{
    public function __construct(private DayCloseService $days) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->days->reopen(DayClose::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->days->keepClosed(DayClose::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->days->keepClosed(DayClose::findOrFail($request->approvable_id));
    }
}
