<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Backup;
use App\Services\AuditLogger;
use App\Services\BackupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class BackupController extends Controller
{
    public function __construct(private BackupService $backups) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json(Backup::with('creator:id,name_bn')->latest('id')->paginate($this->perPage($request)));
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $backup = $this->backups->run('manual', $request->user()->id);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 500);
        }

        return response()->json($backup, 201);
    }

    public function download(Backup $backup)
    {
        $path = $this->backups->path($backup);
        abort_unless(is_file($path), 404);
        AuditLogger::log('backup', 'download', $backup);

        return response()->download($path);
    }
}
