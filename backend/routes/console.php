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
use Illuminate\Support\Str;
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

// ---- License (the private key never lives on the server or in the repo) ----
Artisan::command('license:keygen {--out=}', function () {
    $out = $this->option('out') ?: $this->ask('Where to save the private key (outside the repo)?');
    if (file_exists($out)) {
        return $this->error("{$out} already exists — refusing to overwrite.");
    }
    // Windows PHP needs an openssl.cnf: set OPENSSL_CONF if key generation fails.
    $opts = array_filter(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA, 'config' => getenv('OPENSSL_CONF') ?: null]);
    $key = openssl_pkey_new($opts);
    if (! $key || ! openssl_pkey_export($key, $pem, null, $opts)) {
        return $this->error('OpenSSL could not create a key: '.openssl_error_string());
    }
    file_put_contents($out, $pem);
    $this->info("Private key saved to {$out}. Put this public key in config/license.php:");
    $this->line(openssl_pkey_get_details($key)['key']);
})->purpose('Create the license signing key pair (vendor machine only)');

Artisan::command('license:issue {--key= : private key file} {--to= : licensee} {--expires= : YYYY-MM-DD} {--installation= : bind to one installation id}', function () {
    $pem = @file_get_contents((string) $this->option('key'));
    if (! $pem || ! $this->option('to') || ! strtotime((string) $this->option('expires'))) {
        return $this->error('--key, --to and --expires (YYYY-MM-DD) are required.');
    }
    $this->line(LicenseService::sign([
        'id' => (string) Str::uuid(),
        'to' => $this->option('to'),
        'expires' => date('Y-m-d', strtotime($this->option('expires'))),
        'issued' => now()->toDateString(),
        'installation' => $this->option('installation') ?: null,
    ], $pem));
})->purpose('Print a signed license key');

Artisan::command('license:install {key}', function () {
    if ($problem = LicenseService::problem($this->argument('key'))) {
        return $this->error($problem);
    }
    $s = LicenseService::install($this->argument('key'));
    $this->info("Installed: {$s['licensed_to']} until {$s['expires']} ({$s['state']}).");
})->purpose('Install a license key from the command line');

Artisan::command('license:status', function () {
    $this->line(json_encode(LicenseService::status() + ['installation_id' => LicenseService::installationId()], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
})->purpose('Show the license state');

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
