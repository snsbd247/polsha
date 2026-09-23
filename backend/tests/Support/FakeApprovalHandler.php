<?php

namespace Tests\Support;

use App\Approvals\ApprovalHandler;
use App\Models\ApprovalRequest;

class FakeApprovalHandler implements ApprovalHandler
{
    public static array $calls = [];

    public function approved(ApprovalRequest $request): void
    {
        self::$calls[] = ['approved', $request->id];
    }

    public function rejected(ApprovalRequest $request): void
    {
        self::$calls[] = ['rejected', $request->id];
    }

    public function returned(ApprovalRequest $request): void
    {
        self::$calls[] = ['returned', $request->id];
    }
}
