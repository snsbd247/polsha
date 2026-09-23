<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\DataHealthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DataHealthController extends Controller
{
    public function __construct(private DataHealthService $health) {}

    public function summary(Request $request): JsonResponse
    {
        return response()->json($this->health->summary($request->integer('mouza_id') ?: null));
    }

    public function mouzas(): JsonResponse
    {
        return response()->json($this->health->mouzaTable());
    }

    public function items(Request $request, string $key): JsonResponse
    {
        return response()->json($this->health->items($key, $request->integer('mouza_id') ?: null, $this->perPage($request)));
    }
}
