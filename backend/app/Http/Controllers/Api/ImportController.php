<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ImportBatch;
use App\Services\ImportRollbackService;
use App\Services\Imports\FinanceImporter;
use App\Services\ImportService;
use App\Support\CsvExport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ImportController extends Controller
{
    public function __construct(private ImportService $imports, private ImportRollbackService $rollbacks) {}

    /** Import audit: every batch, with who, how much and its rollback state. */
    public function index(Request $request): JsonResponse
    {
        $q = ImportBatch::with(['creator:id,name_bn,name_en', 'rolledBackBy:id,name_bn,name_en', 'approvalRequest:id,status'])
            ->when($request->query('type'), fn ($q, $t) => $q->where('type', $t))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('from'), fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
            ->when($request->query('to'), fn ($q, $d) => $q->whereDate('created_at', '<=', $d))
            ->latest('id');

        return response()->json($q->paginate($this->perPage($request)));
    }

    public function show(ImportBatch $batch): JsonResponse
    {
        $batch->load(['creator:id,name_bn,name_en', 'rolledBackBy:id,name_bn,name_en', 'approvalRequest:id,status']);

        return response()->json($batch->toArray() + [
            'blockers' => $batch->status === 'completed' && $batch->imported_rows > 0 ? $this->rollbacks->blockers($batch) : [],
        ]);
    }

    /** Import types the user may run, with their fields and a sample row (for the xlsx template). */
    public function types(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'opening_date' => FinanceImporter::openingDate(),
            'types' => collect(ImportService::TYPES)->map(fn ($t, $key) => [
                'key' => $key, 'label' => __($t[0]), 'money' => $t[2], 'allowed' => $this->imports->canImport($user, $key),
                'columns' => $this->imports->columns($key), 'template' => $this->imports->templateRows($key),
            ])->values(),
        ]);
    }

    public function template(string $type)
    {
        abort_unless(isset(ImportService::TYPES[$type]), 404);
        [$header, $sample] = $this->imports->templateRows($type);

        return CsvExport::download("{$type}-template.csv", $header, [$sample]);
    }

    public function upload(Request $request, string $type): JsonResponse
    {
        $this->authorizeType($request, $type);
        $request->validate(['file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:10240']], ['file.mimes' => __('শুধু CSV বা Excel (.xlsx) ফাইল দিন।')]);

        return response()->json($this->imports->upload($type, $request->file('file'), $request->user()));
    }

    public function validateMapping(Request $request): JsonResponse
    {
        $data = $request->validate(['upload_token' => ['required', 'uuid'], 'mapping' => ['required', 'array'], 'mapping.*' => ['nullable', 'integer', 'min:0']]);

        return response()->json($this->imports->validateMapped($data['upload_token'], $data['mapping'], $request->user()));
    }

    public function preview(Request $request, string $type): JsonResponse
    {
        $this->authorizeType($request, $type);
        $request->validate(['file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:10240']], ['file.mimes' => __('শুধু CSV বা Excel (.xlsx) ফাইল দিন।')]);

        return response()->json($this->imports->preview($type, $request->file('file'), $request->user()));
    }

    public function commit(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'uuid'], 'allow_similar' => ['boolean']]);

        return response()->json($this->imports->commit($data['token'], (bool) ($data['allow_similar'] ?? false), $request->user()));
    }

    public function rollback(Request $request, ImportBatch $batch): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);
        $approval = $this->rollbacks->requestRollback($batch, $data['reason']);

        return response()->json(['batch' => $batch->fresh(), 'approval' => $approval->only(['id', 'status'])]);
    }

    /** Each type also needs its module's create permission (farmer.create, savings.create, …). */
    private function authorizeType(Request $request, string $type): void
    {
        validator()->make(['type' => $type], ['type' => [Rule::in(array_keys(ImportService::TYPES))]])->validate();
        abort_unless($this->imports->canImport($request->user(), $type), 403);
    }
}
