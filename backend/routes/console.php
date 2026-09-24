<?php

use App\Models\MembershipApplication;
use App\Services\BackupService;
use App\Services\LedgerService;
use Illuminate\Validation\ValidationException;
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

// One-off (safe to re-run): admission fees of members admitted before the ledger existed.
Artisan::command('accounting:post-admission-fees', function (LedgerService $ledger) {
    $posted = $skipped = 0;
    MembershipApplication::where('status', 'approved')->whereNotNull('member_id')->where('admission_fee', '>', 0)
        ->with('member')->orderBy('id')->each(function ($app) use ($ledger, &$posted, &$skipped) {
            try {
                $ledger->postAdmissionFee($app) ? $posted++ : $skipped++;
            } catch (ValidationException $e) {
                $skipped++;
                $this->warn("{$app->application_no}: ".collect($e->errors())->flatten()->first());
            }
        });
    $this->info("Posted {$posted}, skipped {$skipped}.");
})->purpose('Post membership admission fees to the ledger');

Schedule::command('backup:run')->dailyAt('02:00')->withoutOverlapping();
Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->withoutOverlapping();
Schedule::command('sanctum:prune-expired --hours=24')->daily();
