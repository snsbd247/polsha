<?php

namespace App\Services;

use App\Models\Backup;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Symfony\Component\Process\Process;
use ZipArchive;

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

    /** Largest attachment most mail services accept, with room for encoding. */
    public const EMAIL_LIMIT = 18 * 1024 * 1024;

    /**
     * Off-site copy: email the dump to the address in Settings, inside a
     * password-protected zip when a password is set. The outcome is kept on
     * the backup row; a failure never breaks the backup itself.
     */
    public function email(Backup $backup, ?string $to = null): bool
    {
        $to = trim((string) ($to ?? SettingService::get('backup_email')));
        if ($to === '') {
            return false;
        }
        $file = $this->path($backup);
        $zip = null;
        try {
            if (! is_file($file)) {
                throw new RuntimeException(__('ব্যাকআপ ফাইল পাওয়া যায়নি।'));
            }
            $password = (string) SettingService::get('backup_zip_password');
            if ($password !== '') {
                $zip = $this->encrypt($file, $backup->filename, $password);
            }
            $attach = $zip ?? $file;
            if (filesize($attach) > self::EMAIL_LIMIT) {
                throw new RuntimeException(__('ফাইল ইমেইলের জন্য বেশি বড় — ডাউনলোড করে রাখুন।'));
            }
            $society = SettingService::get('society_name_bn') ?: config('app.name');
            Mail::raw(
                __("স্বয়ংক্রিয় ব্যাকআপ: :society\nফাইল: :file\nসময়: :time\n\nএই ফাইল সমিতির সব তথ্য বহন করে — নিরাপদে রাখুন, কারও সাথে শেয়ার করবেন না।",
                    ['society' => $society, 'file' => basename($attach), 'time' => $backup->created_at?->format('d-m-Y H:i')]),
                fn ($m) => $m->to($to)->subject(__('ব্যাকআপ — :society — :date', ['society' => $society, 'date' => $backup->created_at?->format('d-m-Y')]))
                    ->attach($attach, ['as' => basename($attach)]),
            );
            $backup->update(['emailed_to' => $to, 'emailed_at' => now(), 'email_error' => null]);
            AuditLogger::log('backup', 'email', $backup, null, ['to' => $to]);

            return true;
        } catch (\Throwable $e) {
            $backup->update(['emailed_to' => $to, 'emailed_at' => null, 'email_error' => mb_substr($e->getMessage(), 0, 300)]);

            return false;
        } finally {
            if ($zip) {
                @unlink($zip);
            }
        }
    }

    /** A temporary AES-256 zip holding the dump. */
    private function encrypt(string $file, string $name, string $password): string
    {
        $zipPath = sys_get_temp_dir().DIRECTORY_SEPARATOR.preg_replace('/\.sql\.gz$/', '', $name).'.zip';
        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException(__('জিপ ফাইল তৈরি করা যায়নি।'));
        }
        $zip->addFile($file, $name);
        $zip->setEncryptionName($name, ZipArchive::EM_AES_256, $password);
        $zip->close();

        return $zipPath;
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
