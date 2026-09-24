<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ExportLog;
use App\Services\ReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    public function __construct(private ReportService $reports) {}

    /** Report list for the report centre, filtered to what the user may open. */
    public function index(Request $request): JsonResponse
    {
        return response()->json(['categories' => $this->reports->categories(), 'reports' => $this->reports->catalog($request->user())]);
    }

    public function show(Request $request, string $key): JsonResponse
    {
        $this->authorizeReport($request, $key);

        return response()->json($this->reports->run($key, $request->query()));
    }

    /** The browser builds the Excel file / print page; it reports the export here for the audit trail. */
    public function logExport(Request $request, string $key): JsonResponse
    {
        $this->authorizeReport($request, $key);
        $data = $request->validate([
            'format' => ['required', 'in:'.implode(',', array_keys(ExportLog::FORMATS))],
            'filters' => ['nullable', 'array'],
            'rows' => ['required', 'integer', 'min:0'],
        ]);
        $this->reports->logExport($request->user(), $key, $data['format'], $data['filters'] ?? [], $data['rows'], $request->ip());

        return response()->json(['ok' => true], 201);
    }

    private function authorizeReport(Request $request, string $key): void
    {
        abort_unless($this->reports->exists($key), 404);
        abort_unless($this->reports->allowedFor($request->user(), $key), 403, __('এই রিপোর্ট দেখার অনুমতি নেই।'));
    }
}
