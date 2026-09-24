<?php

namespace App\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Asset;
use App\Services\AssetService;

/** asset.disposal — the asset leaves the books only after approval. */
class AssetDisposalHandler implements ApprovalHandler
{
    public function __construct(private AssetService $assets) {}

    public function approved(ApprovalRequest $request): void
    {
        $this->assets->dispose(Asset::findOrFail($request->approvable_id));
    }

    public function rejected(ApprovalRequest $request): void
    {
        $this->assets->keep(Asset::findOrFail($request->approvable_id));
    }

    public function returned(ApprovalRequest $request): void
    {
        $this->assets->keep(Asset::findOrFail($request->approvable_id));
    }
}
