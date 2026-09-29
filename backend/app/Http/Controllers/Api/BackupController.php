<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Backup;
use App\Services\AuditLogger;
use App\Services\BackupService;
use App\Services\SettingService;
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

    /** The off-site copy settings; the zip password itself is never sent back. */
    public function settings(): JsonResponse
    {
        return response()->json([
            'backup_email' => (string) SettingService::get('backup_email'),
            'zip_password_set' => (string) SettingService::get('backup_zip_password') !== '',
            'mailer' => config('mail.default'),
        ]);
    }

    public function saveSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'backup_email' => ['nullable', 'email', 'max:191'],
            'zip_password' => ['nullable', 'string', 'min:8', 'max:100'],
            'clear_zip_password' => ['sometimes', 'boolean'],
        ]);
        $values = ['backup_email' => (string) ($data['backup_email'] ?? '')];
        if ($request->boolean('clear_zip_password')) {
            $values['backup_zip_password'] = '';
        } elseif (($data['zip_password'] ?? '') !== '') {
            $values['backup_zip_password'] = $data['zip_password'];
        }
        SettingService::setMany($values);

        return $this->settings();
    }

    /** Email one backup now (a test, or a copy of an important one). */
    public function email(Backup $backup): JsonResponse
    {
        abort_if((string) SettingService::get('backup_email') === '', 422, __('আগে ব্যাকআপের ইমেইল ঠিকানা দিন।'));
        $ok = $this->backups->email($backup);
        $backup->refresh();

        return response()->json($backup->toArray() + [
            'message' => $ok ? __('ইমেইলে পাঠানো হয়েছে।') : __('পাঠানো যায়নি: :e', ['e' => $backup->email_error]),
        ], $ok ? 200 : 422);
    }

    public function download(Backup $backup)
    {
        $path = $this->backups->path($backup);
        abort_unless(is_file($path), 404);
        AuditLogger::log('backup', 'download', $backup);

        return response()->download($path);
    }
}
