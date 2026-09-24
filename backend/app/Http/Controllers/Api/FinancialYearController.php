<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\FinancialYearService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FinancialYearController extends Controller
{
    public function __construct(private FinancialYearService $years) {}

    public function index(): JsonResponse
    {
        return response()->json($this->years->years());
    }

    public function preview(string $fy): JsonResponse
    {
        return response()->json($this->years->preview($fy));
    }

    public function close(Request $request, string $fy): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500'], 'confirm' => ['required', 'accepted']]);
        $close = $this->years->close($fy, $data['note'] ?? null, $request->user()->id);

        return response()->json($close->load('journal:id,voucher_no'), 201);
    }
}
