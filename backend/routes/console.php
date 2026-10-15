<?php

use App\Models\MembershipApplication;
use App\Services\AssetService;
use App\Services\BackupService;
use App\Services\IntegrityScanService;
use App\Services\LedgerService;
use App\Services\LicenseService;
use App\Services\SmsService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Validation\ValidationException;

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
    // the nightly one also goes off-site, when an address is set
    if ($this->option('type') === 'auto' && $backups->email($backup)) {
        $this->info("Emailed to {$backup->emailed_to}.");
    } elseif ($backup->email_error) {
        $this->warn("Email failed: {$backup->email_error}");
    }
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

// Monthly straight-line depreciation; catches up any month that was missed.
Artisan::command('assets:depreciate {--period=}', function (AssetService $assets) {
    $period = $this->option('period') ?: now()->subMonthNoOverflow()->format('Y-m');
    $runs = $assets->depreciate($period);
    foreach ($runs as $key => $r) {
        $this->line(($r['skipped'] ?? false) ? "{$key}: skipped (accounting month closed)" : "{$key}: {$r['count']} asset(s), {$r['total']} — {$r['voucher']}");
    }
    $this->info($runs ? 'Done.' : 'Nothing to depreciate.');
})->purpose('Post monthly depreciation of fixed assets up to a month (default: last month)');

Artisan::command('sms:process {--limit=100}', function (SmsService $sms) {
    $r = $sms->process((int) $this->option('limit'));
    $this->info("Sent {$r['sent']}, failed {$r['failed']}, logged only {$r['logged']}, still pending {$r['pending']}.");
})->purpose('Send waiting SMS from the outbox');

Artisan::command('sms:reminders', function (SmsService $sms) {
    $this->info($sms->queueReminders().' reminder(s) queued.');
})->purpose('Queue irrigation/loan due-date reminder SMS');

Artisan::command('integrity:scan', function (IntegrityScanService $scans) {
    $scan = $scans->run('auto');
    $this->info("Scan #{$scan->id}: {$scan->total_issues} issue(s).");
})->purpose('Run the data + ledger integrity scan and keep the result');

Schedule::command('backup:run')->dailyAt('02:00')->withoutOverlapping();
Schedule::command('assets:depreciate')->monthlyOn(1, '03:00')->withoutOverlapping();
Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->withoutOverlapping();
Schedule::command('sanctum:prune-expired --hours=24')->daily();
Schedule::command('sms:process')->everyMinute()->withoutOverlapping();
Schedule::command('sms:reminders')->dailyAt('09:00')->withoutOverlapping();
Schedule::command('integrity:scan')->dailyAt('01:30')->withoutOverlapping();

// ---- License (checked against the vendor's license server; answers are signed) ----
Artisan::command('license:activate {key}', function (LicenseService $licenses) {
    $r = $licenses->activate($this->argument('key'));
    $r['ok'] ? $this->info($r['message']) : $this->error($r['message']);
})->purpose('Activate a license key for this domain (APP_URL)');

Artisan::command('license:verify {--force}', function (LicenseService $licenses) {
    $r = $licenses->verify((bool) $this->option('force'));
    $this->line(($r['ok'] ? 'OK' : 'NOT OK').($r['message'] ? ' — '.$r['message'] : ''));
})->purpose('Ask the license server about the stored key');

Artisan::command('license:status', function (LicenseService $licenses) {
    $this->line(json_encode($licenses->status() + ['installation_id' => LicenseService::installationId()], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
})->purpose('Show the license state');

// keeps the answer fresh even on days nobody signs in
Schedule::command('license:verify --force')->everySixHours()->withoutOverlapping();

// Lets the System page show whether cron is really running.
Schedule::call(fn () => Cache::forever('scheduler.heartbeat', now()->toIso8601String()))->everyMinute()->name('scheduler-heartbeat');

// Demo data: one year of activity in every module, removable in one step.
Artisan::command('demo:seed {--farmers=100}', function (App\Services\DemoDataService $demo) {
    $started = microtime(true);
    $r = $demo->seed((int) $this->option('farmers'), fn (string $m) => $this->line($m));
    $this->info(sprintf('ডেমো ডাটা বসানো শেষ: %d কৃষক, %d সদস্য, %d টি কাজ, %.1f মিনিট। মুছতে: php artisan demo:purge',
        $r['farmers'], $r['members'], $r['calls'], (microtime(true) - $started) / 60));
})->purpose('Load one year of demo data (snapshot first; demo:purge removes it)');

Artisan::command('demo:purge {--force}', function (App\Services\DemoDataService $demo) {
    $demo->purge((bool) $this->option('force'), fn (string $m) => $this->line($m));
})->purpose('Remove the demo data by loading back the pre-demo snapshot');

// every division, district, upazila and union of Bangladesh (safe to run again; existing places are kept)
Artisan::command('locations:import-bd', function (\App\Services\BdLocationImporter $importer) {
    $added = $importer->run();
    $this->info(sprintf('Added: %d divisions, %d districts, %d upazilas, %d unions.', $added['divisions'], $added['districts'], $added['upazilas'], $added['unions']));
})->purpose('Import every division, district, upazila and union of Bangladesh');
