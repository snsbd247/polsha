<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ImportBatch;
use App\Services\ImportService;
use App\Support\CsvExport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ImportController extends Controller
{
    private const TYPES = ['farmers', 'lands'];

    public function __construct(private ImportService $imports) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json(ImportBatch::with('creator:id,name_bn')->latest('id')->paginate($this->perPage($request)));
    }

    public function show(ImportBatch $batch): JsonResponse
    {
        return response()->json($batch->load('creator:id,name_bn'));
    }

    public function template(string $type)
    {
        abort_unless(in_array($type, self::TYPES, true), 404);
        [$header, $sample] = $this->imports->templateRows($type);

        return CsvExport::download("{$type}-template.csv", $header, [$sample]);
    }

    public function preview(Request $request, string $type): JsonResponse
    {
        abort_unless(in_array($type, self::TYPES, true), 404);
        $this->authorizeType($request, $type);
        $request->validate(['file' => ['required', 'file', 'mimes:csv,txt', 'max:10240']], ['file.mimes' => 'শুধু CSV ফাইল দিন।']);

        return response()->json($this->imports->preview($type, $request->file('file'), $request->user()));
    }

    public function commit(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'uuid'], 'allow_similar' => ['boolean']]);

        return response()->json($this->imports->commit($data['token'], (bool) ($data['allow_similar'] ?? false), $request->user()));
    }

    /** Importing farmers also needs farmer.create; lands need land.create. */
    private function authorizeType(Request $request, string $type): void
    {
        abort_unless($request->user()->can($type === 'farmers' ? 'farmer.create' : 'land.create'), 403);
    }
}
