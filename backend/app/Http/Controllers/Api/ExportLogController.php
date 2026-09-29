<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ExportLog;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Who exported or printed which list or report, and when (the Export Audit page). */
class ExportLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = ExportLog::query()->with('user:id,name_bn,name_en,username');
        if ($request->filled('search')) {
            $s = $request->query('search');
            $q->where(fn ($w) => $w->where('title', 'like', "%$s%")->orWhere('report_key', 'like', "%$s%")->orWhere('ip', 'like', "%$s%"));
        }
        foreach (['user_id', 'format'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('from')) {
            $q->where('created_at', '>=', $request->query('from').' 00:00:00');
        }
        if ($request->filled('to')) {
            $q->where('created_at', '<=', $request->query('to').' 23:59:59');
        }

        $today = now()->toDateString();

        return response()->json($q->orderByDesc('id')->paginate($this->perPage($request))->toArray() + [
            // the cards: all exports, today's, this month's and how many people exported
            'counts' => [
                'total' => ExportLog::count(),
                'today' => ExportLog::where('created_at', '>=', $today.' 00:00:00')->count(),
                'month' => ExportLog::where('created_at', '>=', now()->startOfMonth()->toDateTimeString())->count(),
                'users' => ExportLog::whereNotNull('user_id')->distinct()->count('user_id'),
                'rows' => (int) ExportLog::sum('row_count'),
            ],
            'formats' => Tr::map(ExportLog::FORMATS),
            'users' => DB::table('export_logs as e')->join('users as u', 'u.id', '=', 'e.user_id')
                ->distinct()->orderBy('u.name_bn')->get(['u.id', 'u.name_bn', 'u.name_en']),
        ]);
    }
}
