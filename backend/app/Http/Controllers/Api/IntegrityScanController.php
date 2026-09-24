<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\IntegrityScan;
use App\Services\IntegrityScanService;
use App\Services\LedgerIntegrityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IntegrityScanController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(IntegrityScan::with('creator:id,name_bn,name_en')->latest('id')
            ->select(['id', 'trigger', 'total_issues', 'errors', 'created_by', 'started_at', 'finished_at', 'created_at'])
            ->paginate($this->perPage($request)));
    }

    public function show(IntegrityScan $integrityScan): JsonResponse
    {
        return response()->json($integrityScan->load('creator:id,name_bn,name_en'));
    }

    public function store(Request $request, IntegrityScanService $scans): JsonResponse
    {
        return response()->json($scans->run('manual', $request->user()->id)->load('creator:id,name_bn,name_en'), 201);
    }

    /** Live ledger checks only (the accounting menu's "ledger integrity"). */
    public function ledger(LedgerIntegrityService $ledger): JsonResponse
    {
        return response()->json(['checks' => $ledger->run(), 'source_vs_ledger' => $ledger->sourceVsLedger(), 'checked_at' => now()->toDateTimeString()]);
    }
}
