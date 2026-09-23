<?php

use App\Services\BackupService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

/*
| cPanel cron (every minute):
|   * * * * * cd /home/USER/api && php artisan schedule:run >> /dev/null 2>&1
| Shared hosting has no long-running queue worker, so queued jobs are
| drained from the scheduler instead.
*/

Artisan::command('backup:run {--type=auto}', function (BackupService $backups) {
    $backup = $backups->run($this->option('type'));
    $pruned = $backups->prune();
    $this->info("Backup {$backup->filename} created; {$pruned} old backup(s) removed.");
})->purpose('Dump the database and prune old backups');

Schedule::command('backup:run')->dailyAt('02:00')->withoutOverlapping();
Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->withoutOverlapping();
Schedule::command('sanctum:prune-expired --hours=24')->daily();
