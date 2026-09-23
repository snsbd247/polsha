<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;

/**
 * One handler per approval action_key (registered in config/erp.php
 * 'approval_handlers'). The engine calls it once the request reaches a
 * final state; handlers apply or discard the proposed change.
 */
interface ApprovalHandler
{
    public function approved(ApprovalRequest $request): void;

    public function rejected(ApprovalRequest $request): void;

    /** Sent back to the requester for correction. */
    public function returned(ApprovalRequest $request): void;
}
