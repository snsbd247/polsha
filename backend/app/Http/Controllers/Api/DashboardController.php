<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function index(Request $request, DashboardService $dashboard): JsonResponse
    {
        if ($request->boolean('refresh')) {
            DashboardService::flush();
        }

        return response()->json($dashboard->forUser($request->user()));
    }
}
