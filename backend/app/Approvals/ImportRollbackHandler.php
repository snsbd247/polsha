<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\ImportBatch;
use App\Services\ImportRollbackService;

/** import.rollback — an import batch is undone only after admin approval. */
class ImportRollbackHandler implements ApprovalHandler
{
    public function __construct(private ImportRollbackService $rollbacks) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->rollbacks->rollback(ImportBatch::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->rollbacks->keep(ImportBatch::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->rollbacks->keep(ImportBatch::findOrFail($request->approvable_id));
    }
}
