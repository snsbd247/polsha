<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = AuditLog::query()->with('user:id,name_bn,username');

        foreach (['user_id', 'module', 'action', 'auditable_id'] as $field) {
            if ($request->filled($field)) {
                $q->where($field, $request->query($field));
            }
        }
        if ($request->filled('from')) {
            $q->where('created_at', '>=', $request->date('from')->startOfDay());
        }
        if ($request->filled('to')) {
            $q->where('created_at', '<=', $request->date('to')->endOfDay());
        }

        $today = now()->startOfDay();

        return response()->json($q->latest('id')->paginate($this->perPage($request))->toArray() + [
            // the cards: everything logged, today's entries, who worked today, and today's deletions
            'counts' => [
                'total' => AuditLog::count(),
                'today' => AuditLog::where('created_at', '>=', $today)->count(),
                'users_today' => AuditLog::where('created_at', '>=', $today)->whereNotNull('user_id')->distinct()->count('user_id'),
                'deletes_today' => AuditLog::where('created_at', '>=', $today)->whereIn('action', ['delete', 'deleted', 'purge'])->count(),
            ],
        ]);
    }

    public function show(AuditLog $auditLog): JsonResponse
    {
        return response()->json($auditLog->load('user:id,name_bn,username'));
    }

    public function meta(): JsonResponse
    {
        return response()->json([
            'modules' => Tr::map(config('erp.modules')),
            'actions' => AuditLog::query()->distinct()->orderBy('action')->pluck('action'),
        ]);
    }
}
