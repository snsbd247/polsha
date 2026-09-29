<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PrintLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Records receipt prints so reprints can be marked and audited. */
class PrintLogController extends Controller
{
    /** How many times a document was printed, and by whom. */
    public function index(Request $request): JsonResponse
    {
        [$type, $id] = $this->document($request);
        $rows = PrintLog::where('document_type', $type)->where('document_id', $id)->with('user:id,name_bn,name_en')->orderBy('copy_no')->get();

        return response()->json(['count' => $rows->count(), 'data' => $rows]);
    }

    public function store(Request $request): JsonResponse
    {
        [$type, $id] = $this->document($request);
        $log = DB::transaction(function () use ($type, $id, $request) {
            // numbered under a lock so two quick prints cannot share a copy number
            $last = PrintLog::where('document_type', $type)->where('document_id', $id)->lockForUpdate()->max('copy_no');

            return PrintLog::create([
                'document_type' => $type, 'document_id' => $id, 'copy_no' => (int) $last + 1,
                'user_id' => $request->user()->id, 'ip_address' => $request->ip(),
            ]);
        });

        return response()->json($log, 201);
    }

    /** @return array{0: string, 1: int} */
    private function document(Request $request): array
    {
        $data = $request->validate([
            'document_type' => ['required', Rule::in(array_keys(PrintLog::DOCUMENTS))],
            'document_id' => ['required', 'integer'],
        ]);
        [$model, $perms] = PrintLog::DOCUMENTS[$data['document_type']];
        abort_unless($request->user()->canAny($perms), 403, __('অনুমতি নেই'));
        abort_unless($model::whereKey($data['document_id'])->exists(), 404);

        return [$data['document_type'], (int) $data['document_id']];
    }
}
