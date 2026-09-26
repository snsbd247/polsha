<?php

namespace App\Services;

use App\Models\Backup;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Symfony\Component\Process\Process;

class BackupService
{
    public const DIR = 'backups';

    /** Dump the database with mysqldump and store it gzipped on the private disk. */
    public function run(string $type = 'manual', ?int $userId = null): Backup
    {
        $filename = 'polsha-'.now()->format('Ymd-His').'.sql.gz';
        $disk = Storage::disk('local');
        $disk->makeDirectory(self::DIR);
        $this->dumpTo($disk->path(self::DIR.'/'.$filename));

        $backup = Backup::create([
            'filename' => $filename,
            'size' => $disk->size(self::DIR.'/'.$filename),
            'type' => $type,
            'created_by' => $userId,
        ]);
        AuditLogger::log('backup', 'create', $backup, null, ['filename' => $filename, 'type' => $type], null, $userId);

        return $backup;
    }

    public function prune(): int
    {
        $old = Backup::where('created_at', '<', now()->subDays(config('erp.backup.keep_days')))->get();
        foreach ($old as $backup) {
            Storage::disk('local')->delete(self::DIR.'/'.$backup->filename);
            $backup->delete();
        }

        return $old->count();
    }

    public function path(Backup $backup): string
    {
        return Storage::disk('local')->path(self::DIR.'/'.$backup->filename);
    }

    /** Dump the whole database (mysqldump) into a gzipped file. */
    public function dumpTo(string $gzPath): void
    {
        $db = $this->connection();
        $sqlPath = preg_replace('/\.gz$/', '', $gzPath);
        $process = new Process([
            config('erp.backup.mysqldump'),
            '--host='.$db['host'],
            '--port='.$db['port'],
            '--user='.$db['username'],
            '--single-transaction',
            '--routines',
            '--default-character-set=utf8mb4',
            '--result-file='.$sqlPath,
            $db['database'],
        ], null, $this->env($db), null, 600);
        $process->run();

        if (! $process->isSuccessful() || ! is_file($sqlPath)) {
            @unlink($sqlPath);
            throw new RuntimeException(__('ব্যাকআপ ব্যর্থ: ').trim($process->getErrorOutput()));
        }

        $this->gzip($sqlPath, $gzPath);
        unlink($sqlPath);
    }

    /**
     * Load a gzipped dump back with the mysql client. The dump drops and
     * recreates every table it contains, so the database returns to that moment.
     */
    public function restore(string $gzPath): void
    {
        $db = $this->connection();
        $process = new Process([
            config('erp.backup.mysql'),
            '--host='.$db['host'],
            '--port='.$db['port'],
            '--user='.$db['username'],
            '--default-character-set=utf8mb4',
            $db['database'],
        ], null, $this->env($db), null, 1800);
        $in = gzopen($gzPath, 'rb');
        $process->setInput((function () use ($in) {
            while (! gzeof($in)) {
                yield gzread($in, 1024 * 512);
            }
            gzclose($in);
        })());
        $process->run();

        if (! $process->isSuccessful()) {
            throw new RuntimeException(__('রিস্টোর ব্যর্থ: ').trim($process->getErrorOutput()));
        }
    }

    private function connection(): array
    {
        return config('database.connections.'.config('database.default'));
    }

    private function env(array $db): ?array
    {
        $env = $db['password'] !== '' ? ['MYSQL_PWD' => $db['password']] : [];
        if (PHP_OS_FAMILY === 'Windows') {
            // Winsock fails (error 10106) when SystemRoot is missing, which
            // happens under `artisan serve`'s filtered environment.
            $env['SystemRoot'] = getenv('SystemRoot') ?: 'C:\\Windows';
        }

        return $env ?: null;
    }

    /** Stream in chunks so large dumps don't exhaust shared-hosting memory limits. */
    private function gzip(string $source, string $target): void
    {
        $in = fopen($source, 'rb');
        $out = gzopen($target, 'wb6');
        while (! feof($in)) {
            gzwrite($out, fread($in, 1024 * 512));
        }
        fclose($in);
        gzclose($out);
    }
}
