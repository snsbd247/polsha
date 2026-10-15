<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Backup;
use App\Services\LicenseService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class SystemController extends Controller
{
    /** License state plus what support needs to know about this installation (settings page). */
    public function license(): JsonResponse
    {
        $heartbeat = Cache::get('scheduler.heartbeat');
        $backup = Backup::latest('id')->first(['id', 'filename', 'size', 'type', 'created_at']);
        $free = @disk_free_space(storage_path());
        $total = @disk_total_space(storage_path());

        return response()->json([
            'license' => app(LicenseService::class)->status(),
            'installation_id' => LicenseService::installationId(),
            'system' => [
                'app_version' => config('license.app_version'),
                'php' => PHP_VERSION,
                'laravel' => app()->version(),
                'database' => DB::connection()->getDriverName().' '.$this->dbVersion(),
                'disk_free' => $free === false ? null : (int) $free,
                'disk_total' => $total === false ? null : (int) $total,
                'last_backup' => $backup,
                'scheduler_heartbeat' => $heartbeat,
                // cron runs every minute; a few minutes of silence means it is not set up
                'scheduler_ok' => $heartbeat && now()->diffInMinutes($heartbeat, true) <= 5,
                'timezone' => config('app.timezone'),
            ],
        ]);
    }

    private function dbVersion(): string
    {
        try {
            return DB::connection()->getDriverName() === 'sqlite'
                ? (string) DB::scalar('select sqlite_version()')
                : (string) DB::scalar('select version()');
        } catch (\Throwable) {
            return '';
        }
    }
}
