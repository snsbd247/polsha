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
        $db = config('database.connections.'.config('database.default'));
        $filename = 'polsha-'.now()->format('Ymd-His').'.sql.gz';
        $disk = Storage::disk('local');
        $disk->makeDirectory(self::DIR);
        $sqlPath = $disk->path(self::DIR.'/'.str_replace('.gz', '', $filename));

        $args = [
            config('erp.backup.mysqldump'),
            '--host='.$db['host'],
            '--port='.$db['port'],
            '--user='.$db['username'],
            '--single-transaction',
            '--routines',
            '--default-character-set=utf8mb4',
            '--result-file='.$sqlPath,
            $db['database'],
        ];
        $env = $db['password'] !== '' ? ['MYSQL_PWD' => $db['password']] : [];
        if (PHP_OS_FAMILY === 'Windows') {
            // Winsock fails (error 10106) when SystemRoot is missing, which
            // happens under `artisan serve`'s filtered environment.
            $env['SystemRoot'] = getenv('SystemRoot') ?: 'C:\\Windows';
        }
        $process = new Process($args, null, $env ?: null, null, 600);
        $process->run();

        if (! $process->isSuccessful() || ! is_file($sqlPath)) {
            @unlink($sqlPath);
            throw new RuntimeException(__('ব্যাকআপ ব্যর্থ: ').trim($process->getErrorOutput()));
        }

        $this->gzip($sqlPath, $disk->path(self::DIR.'/'.$filename));
        unlink($sqlPath);

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
