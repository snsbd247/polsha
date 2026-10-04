<?php

namespace App\Services;

use App\Models\Account;
use App\Models\AccountingPeriod;
use App\Models\ApprovalRequest;
use App\Models\AssetCategory;
use App\Models\AuditLog;
use App\Models\BankReconciliation;
use App\Models\CombinedPaymentPart;
use App\Models\District;
use App\Models\DistributionRun;
use App\Models\Division;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\IrrigationType;
use App\Models\Journal;
use App\Models\JournalLine;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Loan;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\MembershipApplication;
use App\Models\Receipt;
use App\Models\Sequence;
use App\Models\SmsLog;
use App\Models\User;
use App\Support\Bn;
use Closure;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use SplPriorityQueue;

/**
 * One year of realistic demo data for every module, created through the
 * system's own API (so validation, approvals and ledger postings are the
 * real ones) by a set of demo users acting in their roles.
 *
 * A database snapshot is taken first; demo:purge loads it back, which
 * removes every trace of the demo data at once.
 */
class DemoDataService
{
    public const SETTING = 'demo_data';

    private const ROLES = [
        'admin' => ['admin', 'ডেমো অ্যাডমিন', 'Demo Admin'],
        'manager' => ['manager', 'ডেমো ম্যানেজার', 'Demo Manager'],
        'president' => ['president', 'ডেমো সভাপতি', 'Demo President'],
        'accountant' => ['accountant', 'ডেমো হিসাবরক্ষক', 'Demo Accountant'],
        'cashier' => ['cashier', 'ডেমো ক্যাশিয়ার', 'Demo Cashier'],
        'irrigation' => ['irrigation_officer', 'ডেমো সেচ কর্মকর্তা', 'Demo Irrigation Officer'],
        'member' => ['member_officer', 'ডেমো সদস্য কর্মকর্তা', 'Demo Member Officer'],
        'loan' => ['loan_officer', 'ডেমো ঋণ কর্মকর্তা', 'Demo Loan Officer'],
        'asset' => ['asset_officer', 'ডেমো সম্পদ কর্মকর্তা', 'Demo Asset Officer'],
        'field' => ['field_collector', 'ডেমো মাঠকর্মী', 'Demo Field Collector'],
        'water' => ['water_officer', 'ডেমো পানি কর্মকর্তা', 'Demo Water Officer'],
    ];

    /** @var array<string, User> */
    private array $users = [];

    /** @var array<int, string> user id → bearer token */
    private array $tokens = [];

    private SplPriorityQueue $queue;

    /** @var list<Sequence> yearly counters as they stood before the demo */
    private array $counters = [];

    private int $seq = 0;

    private Carbon $start;

    private string $today;

    private int $calls = 0;

    /** @var Closure(string):void */
    private Closure $log;

    // what the simulation has built so far
    private array $villages = [];      // [id, name_bn, name_en, mouza_id]

    private array $farmers = [];       // id => [village index, gender, name]

    private array $members = [];       // farmer id => member id

    private array $accounts = [];      // member id => ['savings' => id, 'share' => id]

    private array $products = [];

    private array $irrigationTypes = [];

    private array $landTypes = [];

    private int $bankAccountId = 0;

    private int $bankId = 0;            // bank_accounts.id of the main bank account

    private int $mobileAccountId = 0;   // ledger account of the bKash merchant account

    private array $assetIds = [];      // asset name => id

    private array $books = [];         // printed receipt books: [book data, …]

    private int $legacyNo = 0;         // next number from the issued receipt book

    private int $legacyEnd = 0;

    private ?array $publicSettings = null;

    private float $unit = 10;

    public function __construct(private BackupService $backups) {}

    public function seeded(): ?array
    {
        $v = SettingService::get(self::SETTING);

        return is_array($v) && ! empty($v['snapshot']) ? $v : null;
    }

    /** @param  Closure(string):void  $log */
    public function seed(int $farmers, Closure $log): array
    {
        if ($this->seeded()) {
            throw new RuntimeException('ডেমো ডাটা আগেই বসানো আছে। নতুন করে বসাতে আগে demo:purge চালান।');
        }
        // a snapshot of a half-migrated database could not be put back cleanly
        $ran = DB::table('migrations')->pluck('migration')->flip();
        if (collect(glob(database_path('migrations/*.php')))->contains(fn ($f) => ! isset($ran[basename($f, '.php')]))) {
            throw new RuntimeException('কিছু মাইগ্রেশন বাকি আছে; আগে php artisan migrate চালান।');
        }
        $this->log = $log;
        mt_srand(20260926);
        $this->today = now()->toDateString();
        $this->start = now()->subYear()->addDay()->startOfDay();
        $this->queue = new SplPriorityQueue;
        $this->queue->setExtractFlags(SplPriorityQueue::EXTR_DATA);

        // 1. snapshot of the database as it is now — demo:purge returns to it
        $dir = 'demo';
        Storage::disk('local')->makeDirectory($dir);
        $snapshot = $dir.'/pre-demo-'.now()->format('Ymd-His').'.sql.gz';
        ($this->log)('ডাটাবেসের স্ন্যাপশট নেওয়া হচ্ছে…');
        $this->backups->dumpTo(Storage::disk('local')->path($snapshot));
        $seededAt = now()->toDateTimeString();
        $smsBefore = (int) SmsLog::max('id');

        try {
            $this->makeUsers();
            SettingService::putQuiet(self::SETTING, ['snapshot' => $snapshot, 'seeded_at' => $seededAt, 'users' => collect($this->users)->pluck('id')->all()]);
            // the system clock follows the simulated day, so join dates, audit times etc. land on it
            $this->counters = Sequence::where('reset_yearly', true)->get(['key', 'current_year', 'next_value'])->all();
            Carbon::setTestNow($this->start->copy()->setTime(10, 0));
            $this->resumeCounters($this->start->year);
            $this->setup($farmers);
            $this->run();
            $this->finish($smsBefore);
        } catch (\Throwable $e) {
            ($this->log)('ত্রুটি: '.$e->getMessage());
            ($this->log)('স্ন্যাপশট থেকে আগের অবস্থায় ফেরানো হচ্ছে…');
            $this->backups->restore(Storage::disk('local')->path($snapshot));
            Cache::flush();
            throw $e;
        } finally {
            Carbon::setTestNow();
            foreach ($this->users as $u) {
                $u->tokens()->delete();
            }
        }

        // demo users stay (their names are on the records) but cannot sign in
        User::whereIn('id', collect($this->users)->pluck('id'))->update(['is_active' => false]);
        Cache::flush();

        return ['calls' => $this->calls, 'farmers' => count($this->farmers), 'members' => count($this->members), 'snapshot' => $snapshot];
    }

    /** Load the pre-demo snapshot back. Refuses when real work was recorded after the demo, unless forced. */
    public function purge(bool $force, Closure $log): void
    {
        $info = $this->seeded() ?? throw new RuntimeException('কোনো ডেমো ডাটা বসানো নেই।');
        $path = Storage::disk('local')->path($info['snapshot']);
        if (! is_file($path)) {
            throw new RuntimeException('স্ন্যাপশট ফাইল পাওয়া যায়নি: '.$info['snapshot']);
        }
        $real = AuditLog::where('created_at', '>', $info['seeded_at'])->whereNotNull('user_id')
            ->whereNotIn('user_id', $info['users'] ?? [])
            // signing in to look at the demo is not work that would be lost
            ->whereNotIn('action', ['login', 'logout', 'login_failed'])->count();
        if ($real > 0 && ! $force) {
            throw new RuntimeException("ডেমোর পর অন্য ব্যবহারকারীরা {$real}টি কাজ করেছেন; সেগুলোও মুছে যাবে। নিশ্চিত হলে --force দিয়ে চালান।");
        }
        // what the society set up since the snapshot is not demo data: keep it
        $settings = DB::table('settings')->where('key', '!=', self::SETTING)->get();
        $people = DB::table('users')->whereNotIn('id', $info['users'] ?? [])->get();
        $roles = DB::table('model_has_roles')->where('model_type', User::class)->whereIn('model_id', $people->pluck('id'))->get();

        $log('ডেমোর আগের স্ন্যাপশট ফেরানো হচ্ছে…');
        $this->backups->restore($path);
        $this->catchUpSchema($path, $log);
        // the country's places may have come in after the snapshot was taken; bring them back
        app(BdLocationImporter::class)->run();
        $this->keepCurrent($settings, $people, $roles);
        $this->dropOrphanUploads();
        Cache::flush();
        $log('ডেমো ডাটা মুছে ফেলা হয়েছে (সেটিংস ও ব্যবহারকারীদের লগইন যেমন ছিল তেমন আছে)।');
    }

    /** Settings and the real users' sign-in (password, roles) as they were just before the purge. */
    private function keepCurrent($settings, $people, $roles): void
    {
        foreach ($settings as $s) {
            DB::table('settings')->updateOrInsert(['key' => $s->key], ['value' => $s->value, 'created_at' => $s->created_at, 'updated_at' => $s->updated_at]);
        }
        $columns = array_flip(Schema::getColumnListing('users'));
        foreach ($people as $u) {
            $row = array_intersect_key((array) $u, $columns);
            DB::table('users')->updateOrInsert(['id' => $u->id], $row);
        }
        foreach ($roles as $r) {
            DB::table('model_has_roles')->insertOrIgnore((array) $r);
        }
        app(\Spatie\Permission\PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /** Photos and papers of farmers, lands and applications that no longer exist. */
    private function dropOrphanUploads(): void
    {
        $disk = Storage::disk('local');
        $dirs = ['farmer-docs' => 'farmers', 'farmers' => 'farmers', 'land-docs' => 'lands', 'membership' => 'membership_applications'];
        foreach ($dirs as $dir => $table) {
            if (Schema::hasTable($table) && DB::table($table)->doesntExist()) {
                $disk->deleteDirectory($dir);
            }
        }
        if (Schema::hasTable('import_batches') && DB::table('import_batches')->doesntExist()) {
            $disk->deleteDirectory('imports');
        }
    }

    /**
     * The snapshot predates any release deployed while the demo was loaded, so
     * restoring it rolls the schema back too. Tables it does not know about
     * are dropped and the newer migrations run again.
     */
    private function catchUpSchema(string $snapshot, Closure $log): void
    {
        preg_match_all('/CREATE TABLE `([^`]+)`/', implode('', gzfile($snapshot) ?: []), $m);
        $known = array_flip($m[1]);
        // only this app's own database — the server may host other databases
        $db = DB::connection()->getDatabaseName();
        $own = array_filter(Schema::getTables(), fn ($t) => ($t['schema'] ?? $db) === $db);
        $extra = array_filter(array_column($own, 'name'), fn ($t) => ! isset($known[$t]));
        if ($extra) {
            Schema::withoutForeignKeyConstraints(fn () => array_map(fn ($t) => Schema::drop($t), $extra));
        }
        // a snapshot can hold an empty table whose migration it does not record; let that migration make it afresh
        $ran = DB::table('migrations')->pluck('migration')->flip();
        foreach (glob(database_path('migrations/*.php')) as $file) {
            if (isset($ran[basename($file, '.php')])) {
                continue;
            }
            preg_match_all("/Schema::create\\('([^']+)'/", (string) file_get_contents($file), $made);
            foreach ($made[1] as $table) {
                if (Schema::hasTable($table) && DB::table($table)->doesntExist()) {
                    Schema::withoutForeignKeyConstraints(fn () => Schema::drop($table));
                }
            }
        }
        Artisan::call('migrate', ['--force' => true]);
        $log('ডাটাবেসের কাঠামো হালনাগাদ করা হয়েছে।');
    }

    // ------------------------------------------------------------------ plumbing

    private function makeUsers(): void
    {
        foreach (self::ROLES as $key => [$role, $bn, $en]) {
            $u = User::create([
                'name_bn' => $bn, 'name_en' => $en, 'username' => 'demo_'.$key.'_'.Str::lower(Str::random(4)),
                'password' => Str::random(40), 'is_active' => true, 'must_change_password' => false,
                'mobile' => '019'.mt_rand(10000000, 99999999),
            ]);
            $u->assignRole($role);
            $this->users[$key] = $u;
            $this->tokens[$u->id] = $u->createToken('demo')->plainTextToken;
        }
        // the admin also enters old-book members and the demo area, and brings the paper records in through Import
        $this->users['admin']->givePermissionTo(['member.admin', 'member.view', 'location.create', 'mouza.create', 'farmer.view', 'farmer.delete',
            'farmer.create', 'farmer.edit', 'land.create', 'land.edit', 'land.view', 'savings.create', 'share.create', 'loan.create', 'irrigation.create', 'payment.create']);
        // the accountant prepares year-end distributions and account closings; the manager approves them
        $this->users['accountant']->givePermissionTo(['savings.view', 'share.view', 'savings.edit', 'share.edit']);
    }

    /** Call the API as a demo user; any error stops the run. */
    private function api(string $as, string $method, string $uri, array $data = [], array $files = []): array
    {
        $user = $this->users[$as];
        $server = ['HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$this->tokens[$user->id], 'HTTP_ACCEPT_LANGUAGE' => 'bn'];
        $request = match (true) {
            $method === 'GET' => Request::create('/api/'.$uri, 'GET', $data, [], [], $server),
            $files !== [] => Request::create('/api/'.$uri, $method, $data, [], $files, $server),
            default => Request::create('/api/'.$uri, $method, [], [], [], $server + ['CONTENT_TYPE' => 'application/json'], json_encode($data)),
        };
        $response = app(Kernel::class)->handle($request);
        app('auth')->forgetGuards();
        $this->calls++;
        if ($this->calls % 250 === 0) {
            ($this->log)("  … {$this->calls}টি কাজ হয়েছে");
        }
        if ($response->getStatusCode() >= 400) {
            throw new RuntimeException("$method /api/$uri → {$response->getStatusCode()}: ".Str::limit((string) $response->getContent(), 600));
        }

        return json_decode((string) $response->getContent(), true) ?? [];
    }

    /** Approve every remaining step with whichever demo approver may act. */
    private function approve(?int $requestId): void
    {
        if (! $requestId) {
            return;
        }
        $svc = app(ApprovalService::class);
        for ($i = 0; $i < 6; $i++) {
            $req = ApprovalRequest::find($requestId);
            if (! $req || $req->status !== ApprovalRequest::PENDING) {
                return;
            }
            $by = collect(['manager', 'president', 'admin', 'accountant'])->first(fn ($k) => $svc->canAct($this->users[$k], $req));
            if (! $by) {
                throw new RuntimeException("অনুমোদন #$requestId: কোনো ডেমো অনুমোদনকারী পাওয়া যায়নি");
            }
            $this->api($by, 'POST', "approvals/$requestId/decide", ['decision' => 'approve']);
        }
    }

    /** Like api(), for steps the real data may refuse (a scan of an unknown code, a month that cannot close yet); the run goes on. */
    private function tryApi(string $as, string $method, string $uri, array $data = [], bool $quiet = false, array $files = []): ?array
    {
        try {
            return $this->api($as, $method, $uri, $data, $files);
        } catch (RuntimeException $e) {
            $quiet || ($this->log)('  (বাদ গেল) '.Str::limit($e->getMessage(), 220));

            return null;
        }
    }

    /**
     * Bring paper records in the way an operator does: a CSV through the
     * Import screen (preview, then commit). Returns the import batch.
     *
     * @param  list<string>  $header
     * @param  list<list<string|int|float|null>>  $rows
     */
    private function import(string $type, string $filename, array $header, array $rows): array
    {
        $path = tempnam(sys_get_temp_dir(), 'demo-import');
        $fh = fopen($path, 'w');
        fwrite($fh, "\xEF\xBB\xBF");
        fputcsv($fh, $header);
        foreach ($rows as $r) {
            fputcsv($fh, array_map(fn ($v) => (string) $v, $r));
        }
        fclose($fh);
        try {
            $preview = $this->api('admin', 'POST', "imports/$type/preview", [], ['file' => new UploadedFile($path, $filename, 'text/csv', null, true)]);
            $batch = $this->api('admin', 'POST', 'imports/commit', ['token' => $preview['token'], 'allow_similar' => true]);
        } finally {
            @unlink($path);
        }
        ($this->log)("  ইমপোর্ট ($type): {$batch['imported_rows']}/{$batch['total_rows']} সারি");

        return $batch;
    }

    private function dmy(Carbon|string $date): string
    {
        return Carbon::parse($date)->format('d/m/Y');
    }

    private function mobile(): string
    {
        return '01'.mt_rand(3, 9).str_pad((string) mt_rand(0, 99999999), 8, '0', STR_PAD_LEFT);
    }

    private function at(Carbon|string $date, Closure $fn): void
    {
        $d = $date instanceof Carbon ? $date->toDateString() : $date;
        if ($d > $this->today) {
            return;
        }
        $this->queue->insert([$d, $fn], [-(int) str_replace('-', '', $d), -(++$this->seq)]);
    }

    private function run(): void
    {
        ($this->log)('এক বছরের লেনদেন চালানো হচ্ছে…');
        $month = '';
        while (! $this->queue->isEmpty()) {
            [$date, $fn] = $this->queue->extract();
            if (substr($date, 0, 7) !== $month) {
                if (substr($date, 0, 4) !== substr($month, 0, 4)) {
                    $this->resumeCounters((int) substr($date, 0, 4));
                }
                $month = substr($date, 0, 7);
                ($this->log)("  মাস $month");
            }
            Carbon::setTestNow(Carbon::parse($date)->setTime(mt_rand(9, 16), mt_rand(0, 59)));
            $fn($date);
        }
    }

    /**
     * Yearly counters only expect time to move forward. The demo clock starts
     * a year back, so on reaching the year the counters were already in, carry
     * on from where the real numbers stood instead of restarting at 1.
     */
    private function resumeCounters(int $year): void
    {
        foreach ($this->counters as $c) {
            if ((int) $c->current_year === $year) {
                Sequence::where('key', $c->key)->update(['current_year' => $year, 'next_value' => $c->next_value]);
            }
        }
    }

    private function day(Carbon $from, int $min, int $max): Carbon
    {
        return $from->copy()->addDays(mt_rand($min, $max));
    }

    private function pick(array $items)
    {
        return $items[array_rand($items)];
    }

    private function chance(float $p): bool
    {
        return mt_rand() / mt_getrandmax() < $p;
    }

    private function money(int $min, int $max, int $step = 50): int
    {
        return (int) (round(mt_rand($min, $max) / $step) * $step);
    }

    private function balance(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    // ------------------------------------------------------------------ the year

    private function setup(int $count): void
    {
        $d0 = $this->start->toDateString();
        ($this->log)('এলাকা, মৌজা, মৌসুম, হিসাব ও কৃষক তৈরি হচ্ছে…');
        $this->unit = (float) SettingService::get('share_unit_price', 10) ?: 10.0;
        $this->irrigationTypes = IrrigationType::where('is_active', true)->orderBy('id')->limit(3)->pluck('id')->all();
        $this->landTypes = LandType::where('is_active', true)->orderBy('sort_order')->limit(4)->pluck('id')->all();

        $this->area();
        $this->openingCash($d0);
        $bank = $this->api('accountant', 'POST', 'bank-accounts', [
            'bank_name' => 'সোনালী ব্যাংক (ডেমো)', 'branch_name' => 'শিবপুর', 'account_no' => '0200'.mt_rand(100000, 999999), 'account_type' => 'savings', 'opened_on' => $d0,
        ]);
        [$this->bankId, $this->bankAccountId] = [(int) $bank['id'], (int) $bank['account_id']];
        // online (bKash) payments from the public page land here
        $this->mobileAccountId = (int) $this->api('accountant', 'POST', 'bank-accounts', [
            'bank_name' => 'বিকাশ মার্চেন্ট (ডেমো)', 'account_no' => '017'.mt_rand(10000000, 99999999), 'account_type' => 'current', 'opened_on' => $d0,
        ])['account_id'];
        $this->receiptBooks($d0);
        $this->loanProducts();
        // of the farmers, 6 come in through the Import screen and 2 are restored after a wrong deletion (see deletions())
        $imported = min(6, max(0, $count - 3));
        $this->makeFarmers(max(1, $count - $imported - 2));
        $this->importFarmers($imported);
        $this->patwaris();
        $this->makeLands();
        $this->importLands();
        $this->households();
        $this->legacyMembers($d0);
        $this->importLoans($d0);
        $this->legacyDues($d0);
        $this->applications();
        $this->seasons();
        $this->assets();
        $this->oldAssets();
        $this->monthly();
        $this->statusChanges();
        $this->voterLists();
        $this->deletions();
        $this->landTransfers();
        $this->loans();
        $this->journals();
        $this->receiptCancels();
        $this->qrScans();
        $this->exportLogs();
        $this->publicPayments();
        $this->distributions();
        $this->accountClosures();
        $this->pendingWithdrawals();
        $this->fieldCollections();
        $this->waterSupply();
        $this->monthEnds();
        $this->recent();
        $this->extras();
    }
    /**
     * The last ten days are busy, so every screen that opens on "this month"
     * or "today" has something on it even early in a month: deposits, share
     * buys, combined payments, office costs, a withdrawal now and then, two
     * new loans (the one applied for today still waits for approval).
     */
    private function recent(): void
    {
        $today = Carbon::parse($this->today);
        for ($back = 9; $back >= 0; $back--) {
            $day = $today->copy()->subDays($back);
            $this->at($day, function (string $d) use ($back) {
                $members = array_values($this->members);
                shuffle($members);
                foreach (array_slice($members, 0, mt_rand(4, 7)) as $memberId) {
                    $this->moneyIn($memberId, 'savings', $d, $this->money(200, 2000));
                }
                $this->moneyIn($members[0] ?? 0, 'share', $d, (int) ($this->unit * mt_rand(5, 25)));
                for ($k = mt_rand(2, 3); $k > 0; $k--) {
                    $this->combined($d);
                }
                if ($back % 2 === 0) {
                    $this->expense('cash_society', $this->pick(['office_expense', 'other_expense']), $this->money(300, 1500), $this->pick(['অফিসের চা-নাস্তা ও আপ্যায়ন', 'স্টেশনারি কেনা', 'যাতায়াত খরচ']), $d);
                }
                if ($back % 3 === 0) {
                    $this->expense('cash_irrigation', 'other_expense', $this->money(500, 2500), $this->pick(['ড্রেন পরিষ্কারের শ্রমিক মজুরি', 'পাম্পের যন্ত্রাংশ মেরামত', 'নালা মেরামতের মজুরি']), $d);
                    $this->withdrawal($d);
                }
            });
        }
        $this->at($today->copy()->subDays(6), fn (string $d) => $this->loan($d, 'monthly'));
        $this->at($today, fn (string $d) => $this->loan($d, 'monthly'));
    }

    /**
     * Records no money passes through: scanned papers on farmers and lands,
     * notes on lands, remarks on approvals, receipt prints (one a reprint),
     * and a pair of look-alike farmers marked "not the same person".
     */
    private function extras(): void
    {
        $this->at(Carbon::parse($this->today)->subDays(3), function () {
            $pdf = function (string $name): UploadedFile {
                $path = tempnam(sys_get_temp_dir(), 'demo-doc');
                file_put_contents($path, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

                return new UploadedFile($path, $name, 'application/pdf', null, true);
            };
            $farmers = array_keys($this->farmers);
            foreach (array_slice($farmers, 0, 12) as $i => $fid) {
                $type = ['nid_front', 'nid_back', 'photo', 'land_deed'][$i % 4];
                $this->tryApi('admin', 'POST', "farmers/$fid/documents", ['type' => $type, 'remarks' => $type === 'land_deed' ? 'মূল দলিলের স্ক্যান কপি' : null], false, ['file' => $pdf("$type-$fid.pdf")]);
            }
            $lands = Land::whereIn('id', Land::query()->latest('id')->limit(40)->pluck('id'))->inRandomOrder()->limit(12)->pluck('id')->all();
            foreach ($lands as $i => $lid) {
                $type = ['khatian', 'map', 'mutation', 'deed'][$i % 4];
                $this->tryApi('admin', 'POST', "lands/$lid/documents", ['type' => $type, 'title' => ['খতিয়ানের সার্টিফাইড কপি', 'দাগের নকশা (মৌজা ম্যাপ)', 'নামজারি খতিয়ান', 'রেজিস্ট্রি দলিল'][$i % 4]], false, ['file' => $pdf("$type-$lid.pdf")]);
                if ($i % 2 === 0) {
                    $this->tryApi('admin', 'POST', "lands/$lid/notes", ['note' => $this->pick(['আইলের সীমানা নিয়ে প্রতিবেশীর সাথে কথা হয়েছে — মিটমাট', 'বর্ষায় নিচু অংশে পানি জমে', 'নালার পাশের জমি, সেচ সহজ', 'মালিক বিদেশে, ভাই দেখাশোনা করেন'])]);
                }
            }
            foreach (ApprovalRequest::latest('id')->limit(8)->get() as $k => $req) {
                $this->tryApi($k % 2 ? 'manager' : 'accountant', 'POST', "approvals/{$req->id}/comments", ['body' => $this->pick(['কাগজপত্র দেখা হয়েছে, ঠিক আছে।', 'জামিনদারের সম্মতিপত্র ফাইলে রাখা হয়েছে।', 'সভাপতির সাথে কথা বলে সিদ্ধান্ত।', 'পরের সভায় জানানো হবে।'])], true);
            }
            foreach (Receipt::latest('id')->limit(10)->pluck('id') as $k => $rid) {
                $this->tryApi('cashier', 'POST', 'print-logs', ['document_type' => 'receipt', 'document_id' => $rid], true);
                if ($k === 0) {
                    $this->tryApi('cashier', 'POST', 'print-logs', ['document_type' => 'receipt', 'document_id' => $rid], true); // a reprint
                }
            }
            foreach (MemberTransaction::latest('id')->limit(5)->pluck('id') as $tid) {
                $this->tryApi('cashier', 'POST', 'print-logs', ['document_type' => 'member_transaction', 'document_id' => $tid], true);
            }
            // a namesake in the same village (same name and father, a different man): saved after the warning, then marked "not the same person"
            $twin = Farmer::whereIn('id', array_keys($this->farmers))->where('gender', 'male')->whereNotNull('father_name')->inRandomOrder()->first();
            if ($twin) {
                $v = collect($this->villages)->firstWhere('id', $twin->village_id) ?? $this->villages[0];
                $this->tryApi('member', 'POST', 'farmers', [
                    'name_bn' => $twin->name_bn, 'name_en' => $twin->name_en, 'father_name' => $twin->father_name, 'gender' => 'male',
                    'date_of_birth' => Carbon::create(mt_rand(1960, 2000), mt_rand(1, 12), mt_rand(1, 28))->toDateString(),
                    'nid' => (string) mt_rand(1000000000, 9999999999), 'mobile' => $this->mobile(),
                    'village_id' => $v['id'], 'mouza_id' => $v['mouza_id'], 'para' => 'নতুন পাড়া', 'occupation' => 'farmer',
                    'confirm_duplicate' => true,
                ], true);
            }
            $pair = $this->tryApi('admin', 'GET', 'farmers/duplicates', [], true)['data'][0] ?? null;
            if ($pair && isset($pair['a']['id'], $pair['b']['id'])) {
                $this->tryApi('admin', 'POST', 'farmers-duplicates/dismiss', ['a' => $pair['a']['id'], 'b' => $pair['b']['id']], true);
            }
        });
    }


    /**
     * For the last two months a field collector goes round the villages with
     * a phone every few days; the cashier receives the cash at the office
     * about once a week. The latest collections are still in hand.
     */
    private function fieldCollections(): void
    {
        $today = Carbon::parse($this->today);
        for ($back = 60; $back >= 1; $back -= mt_rand(2, 4)) {
            $this->at($today->copy()->subDays($back), function () {
                $ids = array_keys($this->farmers);
                shuffle($ids);
                $done = 0;
                foreach ($ids as $fid) {
                    if ($done >= mt_rand(3, 6)) {
                        break;
                    }
                    $d = $this->api('field', 'GET', 'field/dues', ['farmer_id' => $fid]);
                    $owed = round(($d['loan']['payable'] ?? false ? $d['loan']['due_now'] : 0) + $d['irrigation']['due'] + $d['share']['due'], 2);
                    $amount = $owed > 0 ? min($owed, $this->money(300, 3000)) : ($d['member_active'] ? $this->money(200, 1000) : 0);
                    if ($amount <= 0) {
                        continue;
                    }
                    // a member whose account was closed meanwhile is skipped, as the collector would
                    if ($this->tryApi('field', 'POST', 'field/collect', ['farmer_id' => $fid, 'amount' => $amount], true)) {
                        $done++;
                    }
                }
            });
        }
        for ($back = 56; $back >= 4; $back -= mt_rand(5, 8)) {
            $this->at($today->copy()->subDays($back), fn (string $d) => $this->tryApi('cashier', 'POST', 'field/deposits', [
                'collector_id' => $this->users['field']->id, 'date' => $d, 'note' => $this->pick([null, 'সন্ধ্যায় গুনে জমা', 'হাটবারের আদায়']),
            ], true));
        }
    }

    private function area(): void
    {
        $division = Division::where('name_bn', 'ঢাকা')->first() ?? Division::firstOrFail();
        $district = District::where('name_bn', 'গাজীপুর')->first() ?? District::where('division_id', $division->id)->firstOrFail();
        $upazila = $this->api('admin', 'POST', 'locations/upazilas', ['district_id' => $district->id, 'name_bn' => 'শিবপুর (ডেমো)', 'name_en' => 'Shibpur (Demo)']);
        $union = $this->api('admin', 'POST', 'locations/unions', ['upazila_id' => $upazila['id'], 'name_bn' => 'শিবপুর', 'name_en' => 'Shibpur']);
        foreach ([['শিবপুর', 'Shibpur'], ['দুর্গাপুর', 'Durgapur'], ['কমলাপুর', 'Kamalpur'], ['রামপুর', 'Rampur']] as $i => [$bn, $en]) {
            $village = $this->api('admin', 'POST', 'locations/villages', ['union_id' => $union['id'], 'name_bn' => $bn, 'name_en' => $en]);
            $mouza = $this->api('admin', 'POST', 'mouzas', ['union_id' => $union['id'], 'name_bn' => $bn, 'name_en' => $en, 'jl_no' => (string) (301 + $i), 'village_ids' => [$village['id']]]);
            $this->villages[] = ['id' => $village['id'], 'bn' => $bn, 'en' => $en, 'mouza_id' => $mouza['id'], 'path' => [$division->id, $district->id, $upazila['id'], $union['id'], $village['id']]];
        }
    }

    private function openingCash(string $date): void
    {
        $j = $this->api('accountant', 'POST', 'journals', [
            'voucher_type' => 'opening', 'date' => $date, 'narration' => 'ডেমো: প্রারম্ভিক নগদ',
            'lines' => [
                ['account_id' => Account::byKey('cash_society')->id, 'debit' => 600000, 'credit' => 0],
                ['account_id' => Account::byKey('cash_irrigation')->id, 'debit' => 40000, 'credit' => 0],
                ['account_id' => Account::byKey('cash_misc')->id, 'debit' => 400000, 'credit' => 0],
                ['account_id' => Account::byKey('opening_balance_equity')->id, 'debit' => 0, 'credit' => 1040000],
            ],
        ]);
        $this->approve(Journal::whereKey($j['id'])->value('approval_request_id'));
    }

    private function loanProducts(): void
    {
        $suffix = strtoupper(Str::random(3));
        $this->products['monthly'] = $this->api('manager', 'POST', 'loan-products', [
            'code' => 'DAG-'.$suffix, 'name_bn' => 'কৃষি ঋণ (মাসিক)', 'name_en' => 'Agri loan (monthly)', 'category' => 'agriculture',
            'max_amount' => 60000, 'savings_multiplier' => 3, 'interest_rate' => 12, 'interest_method' => 'flat', 'frequency' => 'monthly',
            'installments' => 12, 'penalty_type' => 'fixed', 'penalty_rate' => 50, 'grace_days' => 7, 'guarantors_required' => 1, 'is_active' => true,
        ])['id'];
        $this->products['season'] = $this->api('manager', 'POST', 'loan-products', [
            'code' => 'DSN-'.$suffix, 'name_bn' => 'মৌসুমি ঋণ (ফসল তোলার পর)', 'name_en' => 'Seasonal loan', 'category' => 'agriculture',
            'max_amount' => 30000, 'savings_multiplier' => 3, 'interest_rate' => 10, 'interest_method' => 'flat', 'frequency' => 'one_time',
            'installments' => 1, 'term_months' => 6, 'penalty_type' => 'percent', 'penalty_rate' => 2, 'grace_days' => 15, 'guarantors_required' => 1, 'is_active' => true,
        ])['id'];
    }

    private function makeFarmers(int $count): void
    {
        $mobiles = [];
        $nids = [];
        for ($i = 0; $i < $count; $i++) {
            $vi = $i % count($this->villages);
            $v = $this->villages[$vi];
            $male = $this->chance(0.78);
            [$bn, $en] = DemoNames::person($male);
            [$fBn, $fEn] = DemoNames::person(true);
            [$mBn] = DemoNames::person(false);
            do {
                $mobile = '01'.mt_rand(3, 9).str_pad((string) mt_rand(0, 99999999), 8, '0', STR_PAD_LEFT);
            } while (isset($mobiles[$mobile]));
            $mobiles[$mobile] = true;
            do {
                $nid = (string) mt_rand(1000000000, 9999999999);
            } while (isset($nids[$nid]));
            $nids[$nid] = true;
            $family = [];
            if ($this->chance(0.6)) {
                [$sBn] = DemoNames::person(! $male);
                $family[] = ['name' => $sBn, 'relation' => 'spouse', 'occupation' => $male ? 'গৃহিণী' : 'কৃষক'];
            }
            for ($k = 0, $n = mt_rand(0, 2); $k < $n; $k++) {
                $son = $this->chance(0.55);
                [$cBn] = DemoNames::person($son);
                $family[] = ['name' => $cBn, 'relation' => $son ? 'son' : 'daughter', 'occupation' => $this->pick(['ছাত্র', 'কৃষক', 'চাকরিজীবী'])];
            }
            $r = $this->api('member', 'POST', 'farmers', [
                'name_bn' => $bn, 'name_en' => $en, 'father_name' => $fBn, 'mother_name' => $mBn,
                'spouse_name' => $family && $family[0]['relation'] === 'spouse' ? $family[0]['name'] : null,
                'gender' => $male ? 'male' : 'female', 'date_of_birth' => Carbon::create(mt_rand(1955, 2002), mt_rand(1, 12), mt_rand(1, 28))->toDateString(),
                'nid' => $this->chance(0.85) ? $nid : null, 'mobile' => $this->chance(0.9) ? $mobile : null,
                'village_id' => $v['id'], 'mouza_id' => $v['mouza_id'], 'para' => $this->pick(['উত্তর পাড়া', 'দক্ষিণ পাড়া', 'মধ্য পাড়া', 'পূর্ব পাড়া', 'পশ্চিম পাড়া']),
                'post_office' => $v['bn'], 'post_code' => '1720', 'occupation' => $male ? $this->pick(['farmer', 'farmer', 'farmer', 'farmer', 'business', 'labour']) : $this->pick(['housewife', 'farmer']),
                'blood_group' => $this->chance(0.6) ? $this->pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'A-', 'B-']) : null,
                'education_level' => $this->pick(['none', 'primary', 'primary', 'secondary', 'secondary', 'higher_secondary', 'graduate']),
                'farmer_type' => $this->pick(['owner_cultivator', 'owner_cultivator', 'owner', 'sharecropper', 'tenant', 'labourer']),
                'family' => $family, 'confirm_duplicate' => true,
            ]);
            $this->farmers[$r['id']] = ['village' => $vi, 'male' => $male, 'name' => $bn];
        }
        ($this->log)('  '.count($this->farmers).' জন কৃষক');
    }

    /** Land-record keepers for the demo mouzas; long-serving ones joined years before the demo year. */
    private function patwaris(): void
    {
        $mouzas = array_column($this->villages, 'mouza_id');
        $farmerIds = array_keys($this->farmers);
        for ($i = 0; $i < 8; $i++) {
            [$bn] = DemoNames::person(true);
            $picked = array_values(array_unique([$mouzas[$i % count($mouzas)], $mouzas[mt_rand(0, count($mouzas) - 1)]]));
            $data = [
                'name' => $bn, 'father_name' => DemoNames::person(true)[0],
                'mobile' => '01'.mt_rand(3, 9).str_pad((string) mt_rand(0, 99999999), 8, '0', STR_PAD_LEFT),
                'nid' => (string) mt_rand(1000000000, 9999999999),
                // two of them are local farmers too
                'farmer_id' => $i < 2 ? $farmerIds[$i * 7] : null,
                'mouza_ids' => $picked, 'start_date' => Carbon::create(mt_rand(2018, 2024), mt_rand(1, 12), mt_rand(1, 28))->toDateString(),
                'is_active' => true,
            ];
            $p = $this->api('member', 'POST', 'patwaris', $data);
            if ($i === 7) {
                // retired later in the year: set inactive, mouzas stay on record
                $this->at($this->day($this->start, 120, 250), fn (string $d) => $this->api('member', 'PUT', "patwaris/{$p['id']}", ['is_active' => false, 'start_date' => $d] + $data));
            }
        }
    }

    private function makeLands(): void
    {
        $byVillage = [];
        foreach ($this->farmers as $id => $f) {
            $byVillage[$f['village']][] = $id;
        }
        $dag = 1000;
        $lands = 0;
        foreach ($this->farmers as $id => $f) {
            $n = $this->pick([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3]);
            for ($k = 0; $k < $n; $k++) {
                $v = $this->villages[$f['village']];
                $cultivated = $this->chance(0.92);
                $borga = $cultivated && $this->chance(0.22);
                $tenant = $borga ? $this->pick(array_values(array_diff($byVillage[$f['village']], [$id]))) : $id;
                $this->api('irrigation', 'POST', 'lands', [
                    'mouza_id' => $v['mouza_id'], 'survey' => $this->pick(['RS', 'RS', 'BS', 'SA']), 'khatian_no' => (string) mt_rand(100, 999), 'dag_no' => (string) ($dag += mt_rand(1, 7)),
                    'area' => mt_rand(8, 165), 'area_unit' => 'decimal', 'land_type_id' => $this->pick($this->landTypes),
                    'irrigation_type_id' => $this->pick($this->irrigationTypes), 'status' => $cultivated ? 'cultivated' : 'fallow',
                    'owners' => [['farmer_id' => $id, 'share_percent' => 100]], 'owned_since' => Carbon::create(mt_rand(1995, 2021), mt_rand(1, 12), 1)->toDateString(),
                    'cultivation' => $cultivated ? ($borga
                        // borga agreements run 3 years at a 50–75% crop share; some ran out and were never renewed
                        ? ['farmer_id' => $tenant, 'type' => 'borga', 'start_date' => ($st = Carbon::create(mt_rand(2020, 2024), mt_rand(1, 12), 1))->toDateString(),
                            'contract_end' => $st->copy()->addYears(3)->subDay()->toDateString(), 'share_percent' => $this->pick([50, 50, 60, 70, 75]),
                            'terms' => 'ফসলের ভাগে বর্গা']
                        : ['farmer_id' => $tenant, 'type' => 'own', 'start_date' => Carbon::create(mt_rand(2018, 2024), 1, 1)->toDateString()]) : null,
                    'confirm_duplicate' => true,
                ]);
                $lands++;
            }
        }
        ($this->log)("  $lands টি জমি");
    }

    private function legacyMembers(string $d0): void
    {
        $no = max(100, (int) Member::max('member_no')) + mt_rand(1, 5);
        $ids = array_keys($this->farmers);
        shuffle($ids);
        $savings = $shares = [];
        foreach (array_slice($ids, 0, (int) round(count($ids) * 0.55)) as $i => $fid) {
            $no += mt_rand(1, 4);
            $m = $this->api('admin', 'POST', 'members/legacy', [
                'farmer_id' => $fid, 'member_no' => $no, 'admitted_on' => Carbon::create(mt_rand(2012, 2024), mt_rand(1, 12), mt_rand(1, 28))->min($this->start->copy()->subMonth())->toDateString(),
            ]);
            $this->members[$fid] = $m['id'];
            if ($i < 10) {
                // the last pages of the old ledger were typed into a sheet and imported
                $this->openAccounts($m['id'], $d0);
                $savings[] = [$no, $this->money(500, 25000), $this->dmy($d0), 'পুরোনো খাতা নং '.Bn::toBnDigits((string) mt_rand(2, 6)).', পৃষ্ঠা '.Bn::toBnDigits((string) mt_rand(10, 90))];
                $shares[] = [$no, $this->money(500, 6000, 10), $this->dmy($d0), ''];
            } else {
                $this->openAccounts($m['id'], $d0, $this->money(500, 25000), $this->money(500, 6000, 10));
            }
        }
        ($this->log)('  '.count($this->members).' জন পুরোনো সদস্য');
        if ($savings) {
            $this->import('savings_opening', 'savings-opening-old-ledger.csv', ['সদস্য নং', 'জের', 'তারিখ', 'মন্তব্য'], $savings);
            $this->import('share_opening', 'share-opening-old-ledger.csv', ['সদস্য নং', 'শেয়ার মূলধন', 'তারিখ', 'মন্তব্য'], $shares);
        }
    }

    /** Printed receipt books: one with the irrigation collector, one in stock, one reported lost. */
    private function receiptBooks(string $d0): void
    {
        $top = max(5000, (int) DB::table('receipt_books')->max('end_no'),
            (int) Receipt::whereNotNull('legacy_no')->pluck('legacy_no')->filter(fn ($n) => ctype_digit((string) $n))->max());
        $base = (int) (ceil(($top + 1) / 100) * 100) + 1;
        $collector = $this->users['irrigation']->id;
        $this->books = [
            ['book_no' => 'ডেমো-'.Bn::toBnDigits('01'), 'start_no' => $base, 'end_no' => $base + 99, 'issued_to' => $collector, 'issued_on' => $d0, 'status' => 'issued', 'note' => 'সেচ আদায়ের মাঠ রশিদ'],
            ['book_no' => 'ডেমো-'.Bn::toBnDigits('02'), 'start_no' => $base + 100, 'end_no' => $base + 199, 'issued_to' => null, 'issued_on' => null, 'status' => 'stock', 'note' => null],
            ['book_no' => 'ডেমো-'.Bn::toBnDigits('03'), 'start_no' => $base + 200, 'end_no' => $base + 249, 'issued_to' => $this->users['cashier']->id, 'issued_on' => $d0, 'status' => 'lost', 'note' => 'বইটি হারিয়ে গেছে — থানায় জিডি করা হয়েছে'],
        ];
        foreach ($this->books as $k => $b) {
            $this->books[$k]['id'] = $this->api('admin', 'POST', 'receipt-books', $b)['id'];
        }
        [$this->legacyNo, $this->legacyEnd] = [$base, $base + 99];
        // half way through the year the first book is used up and the second one goes out
        $this->at($this->start->copy()->addDays(190), function (string $d) use ($collector) {
            $this->api('admin', 'PUT', "receipt-books/{$this->books[0]['id']}", array_merge($this->books[0], ['status' => 'closed', 'note' => 'বই শেষ — জমা নেওয়া হয়েছে']));
            $this->api('admin', 'PUT', "receipt-books/{$this->books[1]['id']}", array_merge($this->books[1], ['status' => 'issued', 'issued_to' => $collector, 'issued_on' => $d]));
            [$this->legacyNo, $this->legacyEnd] = [$this->books[1]['start_no'], $this->books[1]['end_no']];
        });
    }

    /** The next serial from the receipt book in use; now and then a leaf is spoilt and skipped. */
    private function nextLegacyNo(): ?string
    {
        if (! $this->legacyNo || $this->legacyNo > $this->legacyEnd) {
            return null;
        }
        $no = $this->legacyNo;
        $this->legacyNo += $this->chance(0.08) ? 2 : 1;

        return (string) $no;
    }

    /** A handful of farmers were on a spreadsheet from the field survey and came in through Import. */
    private function importFarmers(int $n): void
    {
        if ($n <= 0) {
            return;
        }
        $upazila = DB::table('upazilas')->where('id', $this->villages[0]['path'][2])->value('name_bn');
        $union = DB::table('unions')->where('id', $this->villages[0]['path'][3])->value('name_bn');
        $rows = $nids = [];
        for ($i = 0; $i < $n; $i++) {
            $vi = mt_rand(0, count($this->villages) - 1);
            $male = $this->chance(0.7);
            [$bn, $en] = DemoNames::person($male);
            $nid = (string) mt_rand(1000000000, 9999999999);
            $nids[$nid] = $vi;
            $rows[] = [$bn, $en, DemoNames::person(true)[0], DemoNames::person(false)[0], $male ? 'পুরুষ' : 'মহিলা', $nid, $this->mobile(),
                $upazila, $union, $this->villages[$vi]['bn'], (string) (301 + $vi), $this->pick(['উত্তর পাড়া', 'দক্ষিণ পাড়া', 'মধ্য পাড়া'])];
        }
        $this->import('farmers', 'field-survey-farmers.csv', ['নাম', 'ইংরেজি নাম', 'পিতার নাম', 'মাতার নাম', 'লিঙ্গ', 'nid', 'মোবাইল', 'উপজেলা', 'ইউনিয়ন', 'গ্রাম', 'মৌজা JL', 'পাড়া'], $rows);
        foreach (Farmer::whereIn('nid', array_keys($nids))->get(['id', 'nid', 'name_bn', 'gender']) as $f) {
            $this->farmers[$f->id] = ['village' => $nids[$f->nid], 'male' => $f->gender === 'male', 'name' => $f->name_bn];
        }
    }

    /** Their plots came in the same way, from the land sheet. */
    private function importLands(): void
    {
        $farmers = Farmer::whereIn('id', array_keys($this->farmers))->whereNotNull('import_batch_id')->get(['id', 'farmer_code']);
        if ($farmers->isEmpty()) {
            return;
        }
        $upazila = DB::table('upazilas')->where('id', $this->villages[0]['path'][2])->value('name_bn');
        $types = LandType::whereIn('id', $this->landTypes)->pluck('name_bn')->all();
        $rows = [];
        $dag = 5000 + mt_rand(0, 50);
        foreach ($farmers as $f) {
            $vi = $this->farmers[$f->id]['village'];
            $rows[] = [$upazila, (string) (301 + $vi), 'RS', (string) mt_rand(100, 999), (string) ($dag += mt_rand(1, 9)), (string) mt_rand(15, 120), 'decimal',
                $this->pick($types), 'cultivated', "{$f->farmer_code}:100", '01/01/'.mt_rand(2005, 2020), $f->farmer_code, 'নিজ'];
        }
        $this->import('lands', 'field-survey-lands.csv', ['উপজেলা', 'মৌজা JL', 'জরিপ', 'খতিয়ান', 'দাগ', 'পরিমাণ', 'একক', 'জমির ধরন', 'অবস্থা', 'মালিক', 'মালিকানার তারিখ', 'চাষি', 'চাষের ধরন'], $rows);
    }

    /** Families: a head and the relatives who farm with them. */
    private function households(): void
    {
        $byVillage = [];
        foreach ($this->farmers as $id => $f) {
            $byVillage[$f['village']][] = $id;
        }
        $taken = [];
        $made = 0;
        foreach ($byVillage as $ids) {
            shuffle($ids);
            foreach ($ids as $head) {
                if ($made >= (int) round(count($this->farmers) * 0.22) || isset($taken[$head])) {
                    continue;
                }
                $others = array_values(array_filter($ids, fn ($x) => $x !== $head && ! isset($taken[$x])));
                if (! $others || ! $this->chance(0.5)) {
                    continue;
                }
                $h = $this->api('member', 'POST', 'households', ['head_farmer_id' => $head, 'remarks' => $this->chance(0.3) ? 'একই বাড়িতে বসবাস' : null]);
                $taken[$head] = true;
                foreach (array_slice($others, 0, mt_rand(1, 2)) as $fid) {
                    $male = $this->farmers[$fid]['male'];
                    $this->api('member', 'POST', "households/{$h['id']}/members", [
                        'farmer_id' => $fid, 'relation' => $this->pick($male ? ['son', 'son', 'brother', 'father'] : ['spouse', 'spouse', 'daughter', 'mother', 'sister']),
                    ]);
                    $taken[$fid] = true;
                }
                $made++;
            }
        }
        ($this->log)("  $made টি খানা");
    }

    /** Loans running from before the system, taken over from the old loan register. */
    private function importLoans(string $d0): void
    {
        $code = DB::table('loan_products')->where('id', $this->products['monthly'])->value('code');
        $rows = [];
        foreach (array_slice(array_values($this->members), 12, 4) as $k => $memberId) {
            $amount = $this->pick([18000, 24000, 30000, 36000]);
            $rows[] = [Member::whereKey($memberId)->value('member_no'), $code, $amount, $this->dmy($this->start->copy()->subMonths(mt_rand(3, 5))->day(mt_rand(1, 25))),
                '', (int) round($amount * $this->pick([0.6, 0.7, 0.8]) / 100) * 100, '', 'পুরনো-'.Bn::toBnDigits((string) (101 + $k))];
        }
        $batch = $this->import('loan_opening', 'old-loan-register.csv', ['সদস্য নং', 'ঋণের ধরন', 'মূল ঋণ', 'বিতরণের তারিখ', 'প্রথম কিস্তির তারিখ', 'বকেয়া আসল', 'বকেয়া সুদ', 'পুরনো ঋণ নং'], $rows);
        foreach (Loan::where('import_batch_id', $batch['id'])->pluck('id') as $id) {
            $this->repayments($id);
        }
    }

    /**
     * Last year's irrigation bills that were still open on paper, and the
     * collector's old receipts against some of them.
     */
    private function legacyDues(string $d0): void
    {
        $s = $this->start->copy()->subMonths(10);
        $e = $s->copy()->addDays(110);
        $name = 'বোরো '.Bn::toBnDigits((string) $s->year).' (পুরনো খাতা, ডেমো)';
        $this->api('irrigation', 'POST', 'seasons', [
            'name_bn' => $name, 'code' => 'DEMO-OLD'.$s->format('y'), 'type' => 'rabi', 'crop' => 'ধান', 'start_date' => $s->toDateString(), 'end_date' => $e->toDateString(),
            'due_date' => $e->copy()->addDays(30)->toDateString(), 'status' => 'closed', 'remarks' => 'সফটওয়্যার চালুর আগের মৌসুম — বকেয়া ইমপোর্ট করা',
        ]);
        $lands = Land::whereIn('mouza_id', array_column($this->villages, 'mouza_id'))->whereHas('cultivation')->inRandomOrder()->limit(18)->get(['id', 'land_code', 'area_decimal']);
        $rows = [];
        foreach ($lands as $l) {
            $amount = max(300, (int) round((float) $l->area_decimal * 28 / 10) * 10);
            $rows[] = [$l->land_code, $name, $amount, $this->pick([0, 0, (int) round($amount / 2 / 10) * 10]), $this->dmy($e->copy()->subDays(mt_rand(5, 25)))];
        }
        $batch = $this->import('legacy_irrigation', 'old-irrigation-dues.csv', ['জমির কোড', 'মৌসুম', 'বিলের টাকা', 'আদায়', 'বিলের তারিখ'], $rows);

        $paid = [];
        foreach (Invoice::where('import_batch_id', $batch['id'])->whereColumn('paid_amount', '<', 'amount')->with('farmer:id,name_bn')->limit(7)->get() as $inv) {
            $no = $this->nextLegacyNo();
            if ($no) {
                $paid[] = [$no, $this->dmy($d0), $inv->invoice_no, min($inv->dueAmount(), $this->money(300, 1500)), 'নগদ', $inv->farmer?->name_bn, ''];
            }
        }
        if ($paid) {
            $this->import('payments', 'collector-old-receipts.csv', ['পুরনো রশিদ নং', 'তারিখ', 'ইনভয়েস নং', 'টাকা', 'মাধ্যম', 'প্রদানকারী', 'মন্তব্য'], $paid);
        }
    }

    /** Savings + share accounts; carried-over balances enter as approved opening balances. */
    private function openAccounts(int $memberId, string $date, int $savings = 0, int $share = 0): void
    {
        foreach (['savings' => $savings, 'share' => $share] as $kind => $opening) {
            // the membership opened them already; older snapshots may still lack one
            $id = MemberAccount::where('member_id', $memberId)->where('kind', $kind)->value('id')
                ?? $this->api('cashier', 'POST', "funds/$kind/accounts", ['member_id' => $memberId, 'opened_on' => $date])['id'];
            $a = ['id' => $id];
            $this->accounts[$memberId][$kind] = $id;
            if ($opening > 0) {
                $t = $this->api('cashier', 'POST', "funds/$kind/accounts/{$a['id']}/transactions", [
                    'type' => 'opening', 'date' => $date, 'amount' => $opening, 'method' => null, 'fund_account_id' => null, 'counter_account_id' => null,
                    'remarks' => 'পুরোনো খাতা থেকে জের',
                ]);
                $this->approve(MemberTransaction::whereKey($t['id'])->value('approval_request_id'));
            }
        }
    }

    private function applications(): void
    {
        $candidates = array_values(array_diff(array_keys($this->farmers), array_keys($this->members)));
        shuffle($candidates);
        $fee = (float) SettingService::get('admission_fee', 0);
        $span = $this->start->diffInDays(Carbon::parse($this->today)) - 8;
        foreach (array_slice($candidates, 0, 42) as $i => $fid) {
            $on = $this->day($this->start, 12, (int) $span);
            $outcome = match (true) {
                $i < 30 => 'approve', $i < 33 => 'reject', $i < 35 => 'return', $i < 39 => 'pending', default => 'draft',
            };
            $this->at($on, function (string $date) use ($fid, $fee, $outcome) {
                $male = $this->farmers[$fid]['male'];
                [$nominee] = DemoNames::person(! $male);
                $shares = mt_rand(5, 30);
                $app = $this->api('member', 'POST', 'membership-applications', [
                    'farmer_id' => $fid, 'applied_on' => $date, 'admission_fee' => $fee > 0 ? $fee : 500,
                    'fee_override_reason' => $fee > 0 ? null : 'সভার সিদ্ধান্ত অনুযায়ী',
                    'fee_status' => $this->chance(0.85) ? 'paid' : 'due', 'initial_shares' => $shares,
                    'remarks' => $this->chance(0.3) ? 'প্রস্তাবক সদস্যের সুপারিশে' : null,
                    'nominees' => [['name' => $nominee, 'relation' => $male ? 'স্ত্রী' : 'স্বামী', 'share_percent' => 100]],
                    'submit' => $outcome !== 'draft',
                ]);
                if (in_array($outcome, ['draft', 'pending'], true)) {
                    if ($outcome === 'pending' && $this->chance(0.5) && $app['approval_request_id']) {
                        $this->api('manager', 'POST', "approvals/{$app['approval_request_id']}/decide", ['decision' => 'approve']);
                    }

                    return;
                }
                $decideOn = Carbon::parse($date)->addDays(mt_rand(3, 9));
                $this->at($decideOn, function (string $d) use ($app, $outcome, $fid, $shares) {
                    if ($outcome === 'approve') {
                        $this->approve($app['approval_request_id']);
                        $memberId = Member::where('farmer_id', $fid)->value('id');
                        $this->members[$fid] = $memberId;
                        $this->openAccounts($memberId, $d);
                        // a paid fee brings the first shares in with the approval; a due one buys them now
                        if (MembershipApplication::whereKey($app['id'])->value('fee_status') !== 'paid') {
                            $this->moneyIn($memberId, 'share', $d, (int) ($shares * $this->unit));
                        }
                        $this->moneyIn($memberId, 'savings', $d, $this->money(300, 2000));
                    } else {
                        $this->api('manager', 'POST', "approvals/{$app['approval_request_id']}/decide", [
                            'decision' => $outcome, 'remarks' => $outcome === 'reject' ? 'জমির কাগজপত্র যাচাই করা যায়নি' : 'নমিনির NID সংযুক্ত করুন',
                        ]);
                    }
                });
            });
        }
    }

    private function moneyIn(int $memberId, string $kind, string $date, int $amount): void
    {
        $acc = $this->accounts[$memberId][$kind] ?? null;
        if (! $acc || $amount <= 0 || Member::whereKey($memberId)->value('status') !== Member::ACTIVE) {
            return;
        }
        $this->api('cashier', 'POST', "funds/$kind/accounts/$acc/transactions", [
            'type' => $kind === 'savings' ? 'deposit' : 'purchase', 'date' => $date, 'amount' => $amount, 'method' => 'cash',
            'fund_account_id' => null, 'counter_account_id' => null,
        ]);
    }

    private function seasons(): void
    {
        $plans = [[0, 115], [135, 245], [265, 400]];
        $names = [11 => 'বোরো', 12 => 'বোরো', 1 => 'বোরো', 2 => 'বোরো', 3 => 'আউশ', 4 => 'আউশ', 5 => 'আউশ', 6 => 'আউশ', 7 => 'আমন', 8 => 'আমন', 9 => 'আমন', 10 => 'আমন'];
        foreach ($plans as $i => [$from, $to]) {
            $s = $this->start->copy()->addDays($from);
            $e = $this->start->copy()->addDays($to);
            $this->at($s, function (string $date) use ($s, $e, $names, $i) {
                $name = $names[$s->month].' '.Bn::toBnDigits($s->year).' (ডেমো)';
                $season = $this->api('irrigation', 'POST', 'seasons', [
                    'name_bn' => $name, 'code' => 'DEMO-'.$s->format('ym'), 'type' => str_contains($name, 'বোরো') ? 'rabi' : 'kharif',
                    'crop' => 'ধান', 'start_date' => $s->toDateString(), 'end_date' => $e->toDateString(),
                    'due_date' => $e->copy()->addDays(30)->toDateString(), 'status' => 'open',
                ]);
                foreach ($this->irrigationTypes as $k => $type) {
                    $rate = $this->api('irrigation', 'POST', 'irrigation-rates', [
                        'season_id' => $season['id'], 'irrigation_type_id' => $type, 'rate' => [30, 24, 15][$k] + $i, 'effective_from' => $date,
                    ]);
                    $this->approve($rate['approval_request_id'] ?? null);
                }
                // bills go out a month into the season, mouza by mouza
                $this->at($s->copy()->addDays(30), function (string $d) use ($season) {
                    foreach ($this->villages as $v) {
                        $this->api('irrigation', 'POST', 'invoices/bulk', ['season_id' => $season['id'], 'mouza_id' => $v['mouza_id'], 'invoice_date' => $d]);
                    }
                    $this->collections($season['id'], $d);
                });
                if ($e->toDateString() < $this->today) {
                    $this->at($e->copy()->addDays(31), fn () => $this->api('irrigation', 'PUT', "seasons/{$season['id']}", [
                        'name_bn' => $name, 'code' => $season['code'], 'type' => $season['type'], 'crop' => 'ধান', 'start_date' => $s->toDateString(), 'end_date' => $e->toDateString(),
                        'due_date' => $e->copy()->addDays(30)->toDateString(), 'status' => 'closed',
                    ]));
                }
            });
        }
    }

    /** Most farmers pay within the season, some in two parts, some stay due. */
    private function collections(int $seasonId, string $invoiceDate): void
    {
        foreach (Invoice::where('season_id', $seasonId)->where('status', '!=', 'cancelled')->get(['id', 'farmer_id', 'amount']) as $inv) {
            $roll = mt_rand(1, 100);
            if ($roll > 85) {
                continue; // stays due
            }
            $first = Carbon::parse($invoiceDate)->addDays(mt_rand(5, 75));
            $amount = (float) $inv->amount;
            $part = $roll > 70 ? round($amount / 2) : $amount;
            $this->at($first, fn (string $d) => $this->receipt($inv->farmer_id, $inv->id, $part, $d));
            if ($part < $amount && $this->chance(0.6)) {
                $this->at($first->copy()->addDays(mt_rand(20, 60)), fn (string $d) => $this->receipt($inv->farmer_id, $inv->id, $amount - $part, $d));
            }
        }
    }

    private function receipt(int $farmerId, int $invoiceId, float $amount, string $date): void
    {
        $due = (float) Invoice::whereKey($invoiceId)->value(DB::raw('amount - paid_amount'));
        $amount = min($amount, $due);
        if ($amount <= 0) {
            return;
        }
        // out in the field the collector writes a printed receipt; the office enters it later with that number
        $legacy = $this->chance(0.12) ? $this->nextLegacyNo() : null;
        $this->api('irrigation', 'POST', 'receipts', [
            'farmer_id' => $farmerId, 'date' => $date, 'method' => 'cash',
            'reference' => null, 'items' => [['invoice_id' => $invoiceId, 'amount' => $amount]],
            'is_legacy' => $legacy !== null, 'legacy_no' => $legacy,
        ]);
    }

    private function assets(): void
    {
        $cat = AssetCategory::pluck('id', 'code');
        $list = [
            [5, 'গভীর নলকূপ পাম্প (২ কিউসেক)', 'PUMP', 185000, 'শিবপুর মাঠ'],
            [9, 'সেচের পাইপলাইন (১২০০ ফুট)', 'PIPE', 64000, 'দুর্গাপুর মাঠ'],
            [20, 'অফিসের আসবাবপত্র', 'FURN', 28000, 'অফিস'],
            [40, 'কম্পিউটার ও প্রিন্টার', 'OFFICE', 52000, 'অফিস'],
            [150, 'অগভীর নলকূপ পাম্প', 'PUMP', 72000, 'কমলাপুর মাঠ'],
        ];
        foreach ($list as [$offset, $name, $code, $cost, $place]) {
            if (! isset($cat[$code])) {
                continue;
            }
            $this->at($this->start->copy()->addDays($offset), function (string $d) use ($name, $code, $cost, $place, $cat) {
                if (! $this->ensureCash('cash_society', $cost, $d)) {
                    return;
                }
                $a = $this->api('asset', 'POST', 'assets', [
                    'name_bn' => $name, 'category_id' => $cat[$code], 'purchase_date' => $d, 'cost' => $cost, 'salvage_value' => round($cost * 0.05),
                    'acquisition' => 'purchase', 'method' => 'cash', 'location' => 'অফিস গুদাম', 'supplier' => 'মেসার্স কৃষি যন্ত্রপাতি',
                ]);
                $this->assetLife($code, (int) $a['id'], Carbon::parse($d));
                if (in_array($code, ['PUMP', 'PIPE'], true)) {
                    $install = Carbon::parse($d)->addDays(mt_rand(3, 10));
                    $this->at($install, fn (string $x) => $this->api('asset', 'POST', "assets/{$a['id']}/movements", ['type' => 'install', 'date' => $x, 'to_location' => $place]));
                    // six-monthly servicing: done ones cost money, the next one waits
                    $due = Carbon::parse($d)->addMonths(4);
                    $this->at($due, function (string $x) use ($a) {
                        if (! $this->ensureCash('cash_society', 6000, $x)) {
                            return;
                        }
                        $job = $this->api('asset', 'POST', "assets/{$a['id']}/maintenances", ['kind' => 'service', 'title' => 'ইঞ্জিন সার্ভিসিং ও তেল বদল', 'due_on' => $x, 'repeat_months' => 6]);
                        $this->api('asset', 'POST', "assets/maintenances/{$job['id']}/complete", ['done_on' => $x, 'cost' => $this->money(1500, 6000), 'method' => 'cash']);
                    });
                }
            });
        }
    }

    /** What happens to each asset after it is bought: moves, repairs, a change of condition. */
    private function assetLife(string $code, int $id, Carbon $bought): void
    {
        $seen = $this->assetIds[$code] ?? 0;
        $this->assetIds[$code] = $seen + 1;
        $move = fn (array $data) => fn (string $d) => $this->api('asset', 'POST', "assets/$id/movements", ['date' => $d] + $data);
        $repair = function (Carbon $on, string $why, string $job, ?int $back) use ($id, $move) {
            $this->at($on, $move(['type' => 'repair', 'note' => $why]));
            $this->at($on->copy()->addDays(1), function (string $d) use ($id, $job, $back) {
                $m = $this->api('asset', 'POST', "assets/$id/maintenances", ['kind' => 'repair', 'title' => $job, 'due_on' => $d]);
                if ($back === null) {
                    return; // still at the workshop
                }
                $this->at(Carbon::parse($d)->addDays($back), function (string $x) use ($m) {
                    $cost = $this->money(2500, 9000);
                    if ($this->ensureCash('cash_society', $cost, $x)) {
                        $this->api('asset', 'POST', "assets/maintenances/{$m['id']}/complete", ['done_on' => $x, 'cost' => $cost, 'method' => 'cash']);
                    }
                });
            });
            if ($back !== null) {
                $this->at($on->copy()->addDays($back + 2), $move(['type' => 'repaired', 'note' => 'মেরামত শেষে ফেরত এসেছে']));
            }
        };
        match (true) {
            $code === 'PUMP' && $seen === 0 => $repair($this->start->copy()->addDays(200), 'মোটর পুড়ে গেছে — ওয়ার্কশপে পাঠানো হলো', 'মোটর রিওয়াইন্ডিং ও বিয়ারিং বদল', 9),
            $code === 'PUMP' => $repair(Carbon::parse($this->today)->subDays(6), 'পানি কম উঠছে — ইমপেলার পরীক্ষা', 'ইমপেলার ও সিল বদল', null),
            $code === 'PIPE' => $this->at($bought->copy()->addDays(100), $move(['type' => 'transfer', 'to_location' => 'রামপুর মাঠ', 'custodian' => 'পাম্প চালক', 'note' => 'রামপুর মাঠে সেচের চাহিদা বেশি'])),
            $code === 'OFFICE' => [
                $this->at($bought->copy()->addDays(70), $move(['type' => 'transfer', 'to_location' => 'সভাপতির কক্ষ', 'custodian' => $this->users['president']->name_bn])),
                $this->at($bought->copy()->addDays(230), $move(['type' => 'condition', 'condition' => 'fair', 'note' => 'প্রিন্টারের কালি ঝাপসা'])),
            ],
            default => null,
        };
    }

    /**
     * Two things the society owned before the system: the old shallow
     * machine is sold once the new pump runs, the broken furniture written off.
     */
    private function oldAssets(): void
    {
        $cat = AssetCategory::pluck('id', 'code');
        $old = [];
        foreach ([['PUMP', 'পুরনো স্যালো মেশিন (২০১৯)', 45000, 24000, 'শিবপুর মাঠ'], ['FURN', 'পুরনো কাঠের আলমারি ও টেবিল', 14000, 10500, 'অফিস']] as [$code, $name, $cost, $dep, $place]) {
            if (isset($cat[$code])) {
                $old[$code] = $this->api('asset', 'POST', 'assets', [
                    'name_bn' => $name, 'category_id' => $cat[$code], 'purchase_date' => Carbon::create(2019, mt_rand(1, 12), mt_rand(1, 28))->toDateString(), 'cost' => $cost,
                    'salvage_value' => round($cost * 0.05), 'acquisition' => 'opening', 'opening_depreciation' => $dep, 'location' => $place,
                ])['id'];
            }
        }
        if (isset($old['PUMP'])) {
            $this->at($this->start->copy()->addDays(160), function (string $d) use ($old) {
                $r = $this->api('asset', 'POST', "assets/{$old['PUMP']}/dispose", [
                    'type' => 'sale', 'date' => $d, 'price' => $this->money(12000, 18000, 500), 'method' => 'cash', 'buyer' => DemoNames::person(true)[0],
                    'reason' => 'নতুন গভীর নলকূপ চালু হওয়ায় পুরনো মেশিন বিক্রি',
                ]);
                $this->approve($r['id'] ?? null);
            });
        }
        if (isset($old['FURN'])) {
            $this->at($this->start->copy()->addDays(235), function (string $d) use ($old) {
                $r = $this->api('asset', 'POST', "assets/{$old['FURN']}/dispose", ['type' => 'writeoff', 'date' => $d, 'reason' => 'উইপোকায় নষ্ট — ব্যবহারের অযোগ্য']);
                $this->approve($r['id'] ?? null);
            });
        }
    }

    /** Savings, shares, withdrawals, office costs, bank deposits and depreciation, month by month. */
    private function monthly(): void
    {
        for ($m = $this->start->copy()->startOfMonth(); $m->toDateString() <= $this->today; $m->addMonth()) {
            $month = $m->copy();
            // depreciation for last month, early in the month
            if ($month->gt($this->start)) {
                $this->at($month->copy()->addDays(1), fn () => $this->api('asset', 'POST', 'assets/depreciation', ['period' => $month->copy()->subMonth()->format('Y-m')]));
            }
            $this->at($month->copy()->addDays(4), fn (string $d) => $this->expense('cash_society', 'office_expense', 18000, 'অফিস কর্মচারীদের বেতন', $d));
            $this->at($month->copy()->addDays(14), fn (string $d) => $this->expense('cash_society', 'office_expense', $this->money(1800, 3500), 'অফিসের বিদ্যুৎ ও ইন্টারনেট বিল', $d));
            $this->at($month->copy()->addDays(17), fn (string $d) => $this->expense('cash_irrigation', 'other_expense', $this->money(4000, 9000), 'সেচ পাম্পের বিদ্যুৎ বিল', $d));
            $this->at($month->copy()->addDays(21), fn (string $d) => $this->expense('cash_society', 'other_expense', $this->money(400, 1600), 'অফিসের স্টেশনারি ও আপ্যায়ন', $d));
            $this->at($month->copy()->addDays(24), fn (string $d) => $this->bankDeposit($d));

            // savings and share, per member alive that month
            $this->at($month->copy()->addDays(2), function () use ($month) {
                foreach ($this->accounts as $memberId => $acc) {
                    if ($this->chance(0.55)) {
                        $this->at($month->copy()->addDays(mt_rand(3, 27)), fn (string $d) => $this->moneyIn($memberId, 'savings', $d, $this->money(200, 2500)));
                    }
                    if ($this->chance(0.07)) {
                        $this->at($month->copy()->addDays(mt_rand(3, 27)), fn (string $d) => $this->moneyIn($memberId, 'share', $d, (int) ($this->unit * mt_rand(5, 40))));
                    }
                }
                for ($k = 0; $k < 5; $k++) {
                    $this->at($month->copy()->addDays(mt_rand(5, 26)), fn (string $d) => $this->withdrawal($d));
                }
                for ($k = 0; $k < 4; $k++) {
                    $this->at($month->copy()->addDays(mt_rand(5, 26)), fn (string $d) => $this->combined($d));
                }
            });
        }
    }

    private function expense(string $fund, string $account, int $amount, string $narration, string $date): void
    {
        if ($this->balance($fund) < $amount + 1000) {
            return;
        }
        $this->api('cashier', 'POST', 'funds/payment', [
            'fund_account_id' => Account::byKey($fund)->id, 'counter_account_id' => Account::byKey($account)->id,
            'amount' => $amount, 'date' => $date, 'narration' => $narration,
        ]);
    }

    private function bankDeposit(string $date): void
    {
        foreach (['cash_society' => [150000, 60000], 'cash_irrigation' => [70000, 40000], 'cash_water' => [30000, 20000]] as $fund => [$keep, $amount]) {
            if ($this->balance($fund) > $keep) {
                $this->api('manager', 'POST', 'funds/transfer', [
                    'fund_account_id' => Account::byKey($fund)->id, 'to_account_id' => $this->bankAccountId, 'amount' => $amount, 'date' => $date,
                    'narration' => 'ব্যাংকে জমা',
                ]);
            }
        }
    }

    /** Bring money back from the bank when the cash box runs short; false when even that is not enough. */
    private function ensureCash(string $fund, float $amount, string $date): bool
    {
        $short = $amount + 10000 - $this->balance($fund);
        if ($short <= 0) {
            return true;
        }
        $take = ceil(($short + 20000) / 1000) * 1000;
        if (app(LedgerService::class)->balance($this->bankAccountId) < $take) {
            return false;
        }
        $this->api('manager', 'POST', 'funds/transfer', [
            'fund_account_id' => $this->bankAccountId, 'to_account_id' => Account::byKey($fund)->id, 'amount' => $take, 'date' => $date,
            'narration' => 'ব্যাংক থেকে নগদ উত্তোলন',
        ]);

        return true;
    }

    private function withdrawal(string $date, bool $approve = true): void
    {
        $acc = MemberAccount::where('kind', 'savings')->whereIn('id', array_column($this->accounts, 'savings'))->where('balance', '>', 3000)
            ->whereHas('member', fn ($m) => $m->where('status', Member::ACTIVE))->inRandomOrder()->first();
        if (! $acc) {
            return;
        }
        $amount = $this->money(500, (int) max(600, min(8000, $acc->available() * 0.4)));
        if (! $this->ensureCash('cash_society', $amount, $date)) {
            return;
        }
        $t = $this->api('cashier', 'POST', "funds/savings/accounts/{$acc->id}/transactions", [
            'type' => 'withdrawal', 'date' => $date, 'amount' => $amount, 'method' => 'cash',
            'fund_account_id' => null, 'counter_account_id' => null,
        ]);
        $approve && $this->approve(MemberTransaction::whereKey($t['id'])->value('approval_request_id'));
    }

    /** A member pays a round sum at the counter; the system splits it over dues. */
    private function combined(string $date): void
    {
        // not a member whose account is closed or closing: the counter would refuse the money
        $fid = Member::whereIn('id', array_values($this->members))->where('status', Member::ACTIVE)
            ->whereDoesntHave('accounts', fn ($q) => $q->where('status', '!=', 'active'))->inRandomOrder()->value('farmer_id');
        if (! $fid) {
            return;
        }
        $this->api('cashier', 'POST', 'combined-payments', [
            'farmer_id' => $fid, 'date' => $date, 'amount' => $this->money(500, 3000, 100), 'method' => 'cash',
        ]);
    }

    /** A few members go quiet during the year (and one comes back), so inactive members and excluded voters exist. */
    private function statusChanges(): void
    {
        $span = $this->start->diffInDays(Carbon::parse($this->today)) - 30;
        for ($i = 0; $i < 9; $i++) {
            $this->at($this->day($this->start, 40, (int) $span), function (string $d) use ($i) {
                $memberId = Member::whereIn('id', array_values($this->members))->where('status', Member::ACTIVE)
                    ->whereNotIn('id', Loan::whereIn('status', Loan::OPEN)->pluck('member_id'))->inRandomOrder()->value('id');
                if (! $memberId) {
                    return;
                }
                $r = $this->api('member', 'POST', "members/$memberId/status", [
                    'action' => 'deactivate', 'effective_date' => $d,
                    'reason' => $this->pick(['টানা ছয় মাস সঞ্চয় জমা দেননি', 'এলাকার বাইরে চলে গেছেন', 'সভায় অনুপস্থিত ও যোগাযোগ নেই']),
                ]);
                $this->approve($r['approval_id'] ?? null);
                if ($i === 0) {
                    $this->at(Carbon::parse($d)->addDays(60), function (string $x) use ($memberId) {
                        $r = $this->api('member', 'POST', "members/$memberId/status", ['action' => 'activate', 'effective_date' => $x, 'reason' => 'বকেয়া সঞ্চয় জমা দিয়ে আবার সক্রিয়']);
                        $this->approve($r['approval_id'] ?? null);
                    });
                }
            });
        }
    }

    /**
     * Records entered by mistake over the year: deleted with a reason, a couple
     * restored, one removed for good, and two duplicates merged into the real farmer.
     */
    private function deletions(): void
    {
        $span = $this->start->diffInDays(Carbon::parse($this->today)) - 5;
        $plan = ['duplicate', 'duplicate', 'duplicate', 'wrong_data', 'wrong_data', 'wrong_data', 'not_farmer', 'not_farmer',
            'duplicate', 'wrong_data', 'merge', 'merge', 'restore', 'restore', 'purge'];
        foreach ($plan as $i => $what) {
            // the last few land in the current month so "deleted this month" is not empty
            $date = $i >= 12 ? Carbon::parse($this->today)->subDays(mt_rand(0, 8)) : $this->day($this->start, 30, (int) $span);
            $this->at($date, function (string $d) use ($what) {
                $real = array_rand($this->farmers);
                $copy = $this->farmers[$real];
                $v = $this->villages[$copy['village']];
                // a duplicate re-enters an existing farmer; other mistakes are someone new
                [$bn, $en] = in_array($what, ['duplicate', 'merge'], true) ? [$copy['name'], null] : DemoNames::person(true);
                $f = $this->api('member', 'POST', 'farmers', [
                    'name_bn' => $bn, 'name_en' => $en, 'father_name' => DemoNames::person(true)[0], 'gender' => 'male',
                    'mobile' => '01'.mt_rand(3, 9).str_pad((string) mt_rand(0, 99999999), 8, '0', STR_PAD_LEFT),
                    'village_id' => $v['id'], 'mouza_id' => $v['mouza_id'], 'occupation' => 'farmer', 'confirm_duplicate' => true,
                ]);
                if ($what === 'merge') {
                    $r = $this->api('member', 'POST', 'farmers-merge', ['keep_id' => $real, 'remove_id' => $f['id'], 'choices' => [], 'reason' => ['duplicate', 'spelling', 'name_variation', 'registration', 'multiple'][mt_rand(0, 4)]]);
                    $this->approve($r['approval_id'] ?? null);

                    return;
                }
                $reason = ['duplicate' => 'একই কৃষক দুবার এন্ট্রি হয়েছে', 'wrong_data' => 'নাম ও মোবাইল ভুল লেখা হয়েছিল', 'not_farmer' => 'চাষাবাদ করেন না, ভুলে যুক্ত হয়েছিল'];
                $code = in_array($what, ['restore', 'purge'], true) ? 'wrong_data' : $what;
                $this->api('admin', 'DELETE', "farmers/{$f['id']}", ['reason_code' => $code, 'reason' => $reason[$code]]);
                if ($what === 'restore') {
                    $this->api('admin', 'POST', "farmers/{$f['id']}/restore");
                } elseif ($what === 'purge') {
                    $this->api('admin', 'DELETE', "farmers-deleted/{$f['id']}");
                }
            });
        }
    }

    /**
     * Land sales, inheritance and gifts over the year through the transfer
     * form: most approved by the manager, a few still waiting, a few rejected.
     */
    private function landTransfers(): void
    {
        $span = $this->start->diffInDays(Carbon::parse($this->today)) - 3;
        $plan = array_merge(array_fill(0, 14, 'approve'), array_fill(0, 4, 'pending'), array_fill(0, 3, 'reject'));
        foreach ($plan as $i => $outcome) {
            // the waiting ones are recent
            $date = $outcome === 'pending' ? Carbon::parse($this->today)->subDays(mt_rand(1, 20)) : $this->day($this->start, 20, (int) $span);
            $this->at($date, function (string $d) use ($outcome) {
                $land = DB::table('land_owners')->join('lands', 'lands.id', '=', 'land_owners.land_id')->whereNull('lands.deleted_at')
                    ->whereNull('land_owners.end_date')->where('land_owners.start_date', '<', $d)
                    ->whereNotIn('lands.id', DB::table('land_transfers')->where('status', 'pending')->select('land_id'))
                    ->inRandomOrder()->first(['lands.id', 'land_owners.farmer_id', 'land_owners.share_percent']);
                $buyer = array_rand($this->farmers);
                if (! $land || $buyer === $land->farmer_id) {
                    return;
                }
                $partial = $this->chance(0.35) && $land->share_percent > 20;
                $reason = $this->pick(['sale', 'sale', 'sale', 'inheritance', 'gift', 'exchange']);
                $r = $this->api('irrigation', 'POST', 'land-transfers', [
                    'land_id' => $land->id, 'from_farmer_id' => $land->farmer_id, 'to_farmer_id' => $buyer,
                    'type' => $partial ? 'partial' : 'full', 'share_percent' => $partial ? $this->pick([25, 30, 40, 50]) : null,
                    'reason' => $reason, 'transfer_date' => $d,
                    'amount' => $reason === 'sale' ? $this->money(150000, 900000, 10000) : null,
                    'remarks' => $reason === 'sale' ? 'দলিল নং '.Bn::toBnDigits((string) mt_rand(1000, 9999)) : null,
                    'submit' => true,
                ]);
                if ($outcome === 'approve') {
                    $this->approve($r['approval_id'] ?? null);
                } elseif ($outcome === 'reject' && ($r['approval_id'] ?? null)) {
                    $this->api('manager', 'POST', "approvals/{$r['approval_id']}/decide", ['decision' => 'reject', 'remarks' => 'দলিলের কপি অস্পষ্ট — নতুন কপি দিন']);
                }
            });
        }
    }

    /** The annual general meeting list, and a fresh list for the coming election. */
    private function voterLists(): void
    {
        $agm = $this->start->copy()->addDays(95);
        $this->at($agm, fn (string $d) => $this->api('admin', 'POST', 'voter-lists', ['title' => 'বার্ষিক সাধারণ সভা '.Bn::toBnDigits($agm->year).' — ভোটার তালিকা (ডেমো)', 'cutoff_date' => $d]));
        $recent = Carbon::parse($this->today)->subDays(12);
        $this->at($recent, fn (string $d) => $this->api('admin', 'POST', 'voter-lists', ['title' => 'ব্যবস্থাপনা কমিটি নির্বাচন '.Bn::toBnDigits($recent->year).' — ভোটার তালিকা (ডেমো)', 'cutoff_date' => $d]));
    }

    private function loans(): void
    {
        $span = $this->start->diffInDays(Carbon::parse($this->today)) - 20;
        // about one loan for every four farmers over the year
        for ($i = 0, $n = max(3, (int) round(count($this->farmers) / 3.6)); $i < $n; $i++) {
            $on = $this->day($this->start, 20, (int) $span);
            $kind = $this->chance(0.75) ? 'monthly' : 'season';
            $this->at($on, fn (string $d) => $this->loan($d, $kind));
        }
    }

    private function loan(string $date, string $kind): void
    {
        $product = $this->products[$kind];
        $members = array_values($this->members);
        shuffle($members);
        foreach (array_slice($members, 0, 12) as $memberId) {
            if (Loan::where('member_id', $memberId)->whereIn('status', Loan::OPEN)->exists() || Member::whereKey($memberId)->value('status') !== Member::ACTIVE) {
                continue;
            }
            $limit = (float) $this->api('loan', 'GET', 'loans/eligibility', ['member_id' => $memberId, 'product_id' => $product])['limit'];
            if ($limit < 5000) {
                continue;
            }
            $active = Member::whereIn('id', $members)->where('status', Member::ACTIVE)->pluck('id')->all();
            $guarantor = collect($active)->first(fn ($g) => $g !== $memberId && app(LoanService::class)->guaranteeCount($g) < (int) SettingService::get('loan_max_guarantees', 2));
            if (! $guarantor) {
                return;
            }
            $amount = min($limit, $this->money(5000, 45000, 500));
            $loan = $this->api('loan', 'POST', 'loans', [
                'member_id' => $memberId, 'product_id' => $product, 'applied_on' => $date, 'amount' => $amount,
                'purpose' => $this->pick(['বোরো ধান চাষ', 'সার ও বীজ কেনা', 'সেচ খরচ', 'গাভী পালন', 'সবজি চাষ', 'পাওয়ার টিলার মেরামত']),
                'guarantors' => [['member_id' => $guarantor]],
            ]);
            $approveOn = Carbon::parse($date)->addDays(mt_rand(1, 4));
            $this->at($approveOn, function (string $d) use ($loan) {
                $this->approve(Loan::whereKey($loan['id'])->value('approval_request_id'));
                $this->at(Carbon::parse($d)->addDays(mt_rand(1, 3)), function (string $x) use ($loan) {
                    if (! $this->ensureCash('cash_society', (float) Loan::whereKey($loan['id'])->value('amount'), $x)) {
                        $this->api('loan', 'POST', "loans/{$loan['id']}/cancel", ['reason' => 'তহবিলে পর্যাপ্ত টাকা নেই']);

                        return;
                    }
                    $this->api('loan', 'POST', "loans/{$loan['id']}/disburse", ['date' => $x, 'method' => 'cash', 'fund_account_id' => null]);
                    $this->repayments($loan['id']);
                });
            });

            return;
        }
    }

    /** Most borrowers pay on time, some late, a few stop paying. */
    private function repayments(int $loanId): void
    {
        $style = $this->pick(['ontime', 'ontime', 'ontime', 'ontime', 'ontime', 'ontime', 'late', 'late', 'stop']);
        $stopAfter = mt_rand(2, 5);
        foreach (Loan::findOrFail($loanId)->schedule()->orderBy('seq')->get() as $n => $inst) {
            if ($style === 'stop' && $n >= $stopAfter) {
                return;
            }
            $when = $inst->due_date->copy()->addDays($style === 'late' ? mt_rand(10, 40) : mt_rand(-5, 3))
                // instalments that fell due before the system (imported loans) are paid off in the first weeks
                ->max($this->start->copy()->addDays(mt_rand(3, 25)));
            $this->at($when, function (string $d) use ($inst, $loanId) {
                $inst->refresh();
                $loan = Loan::find($loanId);
                if (! $loan || $loan->status !== 'active' || $inst->outstanding() <= 0) {
                    return;
                }
                $pos = app(LoanService::class)->position($loan, $d);
                $this->api('cashier', 'POST', "loans/$loanId/payments", [
                    'date' => $d, 'amount' => round(min($pos['payoff'], $inst->outstanding() + $pos['penalty_due']), 2), 'method' => 'cash', 'fund_account_id' => null,
                ]);
            });
        }
    }

    /** Decide one approval step with whichever demo approver may act on it. */
    private function decide(?int $requestId, string $decision, string $remarks): void
    {
        $req = $requestId ? ApprovalRequest::find($requestId) : null;
        if (! $req) {
            return;
        }
        $by = collect(['manager', 'president', 'admin', 'accountant'])->first(fn ($k) => app(ApprovalService::class)->canAct($this->users[$k], $req));
        $by && $this->api($by, 'POST', "approvals/$requestId/decide", ['decision' => $decision, 'remarks' => $remarks]);
    }

    /** Manual vouchers: corrections, two wrong entries reversed, one waiting and one sent back. */
    private function journals(): void
    {
        $span = (int) $this->start->diffInDays(Carbon::parse($this->today));
        $post = fn (string $d, array $lines, string $narration) => $this->api('accountant', 'POST', 'journals', [
            'voucher_type' => 'journal', 'date' => $d, 'narration' => $narration,
            'lines' => array_map(fn ($l) => ['account_id' => Account::byKey($l[0])->id, 'debit' => $l[1], 'credit' => $l[2]], $lines),
        ]);
        $approved = fn (array $j) => $this->approve(Journal::whereKey($j['id'])->value('approval_request_id'));
        for ($k = mt_rand(35, 50); $k < $span - 20; $k += mt_rand(45, 70)) {
            $this->at($this->start->copy()->addDays($k), function (string $d) use ($post, $approved) {
                $amt = $this->money(300, 1500);
                $approved($post($d, [['office_expense', $amt, 0], ['other_expense', 0, $amt]], 'সংশোধনী: অফিসের খরচ ভুলে অন্যান্য খরচে লেখা হয়েছিল'));
            });
        }
        foreach ([100, 255] as $k) {
            $this->at($this->start->copy()->addDays($k), function (string $d) use ($post, $approved) {
                $amt = $this->money(1000, 4000, 100);
                $j = $post($d, [['other_expense', $amt, 0], ['other_income', 0, $amt]], 'অফিস ঘর ভাড়ার সমন্বয়');
                $approved($j);
                $this->at(Carbon::parse($d)->addDays(mt_rand(2, 6)), function () use ($j) {
                    $r = $this->api('accountant', 'POST', "journals/{$j['id']}/reverse", ['reason' => 'ভুল খাতে পোস্ট হয়েছিল — সঠিক এন্ট্রি আলাদা দেওয়া হবে']);
                    $this->approve($r['id'] ?? null);
                });
            });
        }
        $this->at(Carbon::parse($this->today)->subDays(3), fn (string $d) => $post($d, [['office_expense', 2400, 0], ['accounts_payable', 0, 2400]], 'বিদ্যুৎ বিল বকেয়া (প্রদেয়)'));
        $this->at(Carbon::parse($this->today)->subDays(2), function (string $d) use ($post) {
            $j = $post($d, [['other_expense', 1800, 0], ['accounts_payable', 0, 1800]], 'বার্ষিক নিরীক্ষা ফি (প্রদেয়)');
            $this->decide(Journal::whereKey($j['id'])->value('approval_request_id'), 'return', 'নিরীক্ষকের বিলের কপি সংযুক্ত করুন');
        });
    }

    /** Receipts written by mistake are cancelled through approval; the latest request still waits. */
    private function receiptCancels(): void
    {
        $plan = [[60, true], [130, true], [210, true], [290, true]];
        $plan[] = [(int) $this->start->diffInDays(Carbon::parse($this->today)) - 4, false];
        foreach ($plan as [$k, $approve]) {
            $this->at($this->start->copy()->addDays($k), function (string $d) use ($approve) {
                $parts = CombinedPaymentPart::where('source_type', (new Receipt)->getMorphClass())->pluck('source_id');
                $r = Receipt::where('status', 'active')->where('module', 'irrigation')->whereDate('date', '>=', Carbon::parse($d)->subDays(15))
                    ->whereNotIn('id', $parts)->inRandomOrder()->first();
                if (! $r) {
                    return;
                }
                $req = $this->api('irrigation', 'POST', "receipts/{$r->id}/cancel", ['reason' => $this->pick(['ভুল কৃষকের নামে রশিদ কাটা হয়েছিল', 'টাকার অঙ্ক ভুল লেখা হয়েছিল', 'একই টাকার রশিদ দুবার কাটা হয়েছে'])]);
                $approve && $this->approve($req['id'] ?? null);
            });
        }
    }

    /** Staff scan the QR on cards, receipts and asset tags; now and then a code that is not ours. */
    private function qrScans(): void
    {
        $span = (int) $this->start->diffInDays(Carbon::parse($this->today));
        for ($k = 10; $k <= $span; $k += mt_rand(3, 8)) {
            $this->at($this->start->copy()->addDays($k), function () {
                $type = $this->pick(['farmer', 'farmer', 'farmer', 'land', 'receipt', 'receipt', 'member', 'asset', 'combined']);
                $code = match ($type) {
                    'farmer' => Farmer::whereIn('id', array_keys($this->farmers))->inRandomOrder()->value('farmer_code'),
                    'land' => Land::whereIn('mouza_id', array_column($this->villages, 'mouza_id'))->inRandomOrder()->value('land_code'),
                    'receipt' => Receipt::whereNotNull('verify_token')->inRandomOrder()->value('verify_token'),
                    'combined' => DB::table('combined_payments')->whereNotNull('verify_token')->inRandomOrder()->value('verify_token'),
                    'member' => Member::whereIn('id', array_values($this->members))->inRandomOrder()->value('member_no'),
                    'asset' => DB::table('assets')->inRandomOrder()->value('asset_code'),
                };
                if ($this->chance(0.06)) {
                    [$type, $code] = ['farmer', 'F-9'.mt_rand(10000, 99999)];
                }
                if ($code) {
                    $this->tryApi($this->pick(['cashier', 'irrigation', 'irrigation', 'member', 'asset', 'manager']), 'POST', 'qr/resolve',
                        ['type' => $type, 'code' => (string) $code, 'source' => $this->pick(['camera', 'camera', 'manual', 'link'])], true);
                }
            });
        }
    }

    /** Reports downloaded or printed over the year, as the export audit records them. */
    private function exportLogs(): void
    {
        $plan = [
            'manager' => ['invoices', 'irrigation_due', 'members', 'loans', 'loan_due', 'savings_balance', 'irrigation_collection', 'farmers'],
            'accountant' => ['trial_balance', 'income_statement', 'balance_sheet', 'cash_book', 'income_expense_cashbook'],
            'admin' => ['audit_activity', 'login_history', 'farmers', 'approvals'],
        ];
        $span = (int) $this->start->diffInDays(Carbon::parse($this->today));
        for ($k = 15; $k <= $span; $k += mt_rand(3, 8)) {
            $this->at($this->start->copy()->addDays($k), function () use ($plan) {
                $as = array_rand($plan);
                $this->tryApi($as, 'POST', 'reports/'.$this->pick($plan[$as]).'/export-log', [
                    'format' => $this->pick(['xlsx', 'xlsx', 'csv', 'print']), 'rows' => mt_rand(12, 420), 'filters' => [],
                ]);
            });
        }
    }

    /**
     * The public payment page is switched on for the last two months:
     * farmers pay by bKash/Nagad and send the transaction ID; the office
     * verifies most, rejects a couple, and the newest still wait.
     */
    private function publicPayments(): void
    {
        $keys = ['public_payment_enabled', 'public_payment_bkash', 'public_payment_nagad', 'public_payment_rocket', 'public_payment_note'];
        $this->publicSettings = array_combine($keys, array_map(fn ($k) => SettingService::get($k), $keys));
        $today = Carbon::parse($this->today);
        $this->at($today->copy()->subDays(56), fn () => $this->api('admin', 'PUT', 'public-payments/settings', [
            'public_payment_enabled' => true, 'public_payment_bkash' => '01'.mt_rand(700000000, 999999999), 'public_payment_nagad' => '01'.mt_rand(700000000, 999999999),
            'public_payment_rocket' => null, 'public_payment_note' => 'Send Money করে ট্রানজেকশন আইডি দিয়ে এখানে জমা দিন।',
        ]));
        $i = 0;
        for ($back = 52; $back >= 0; $back -= mt_rand(2, 5)) {
            $outcome = $back <= 3 ? 'pending' : (++$i % 5 === 0 ? 'reject' : 'verify');
            $this->at($today->copy()->subDays($back), function (string $d) use ($outcome) {
                $inv = Invoice::whereIn('status', ['unpaid', 'partial'])->whereIn('farmer_id', array_keys($this->farmers))->inRandomOrder()->first();
                $amount = $inv ? min(floor($inv->dueAmount() / 50) * 50, $this->money(500, 3000, 100)) : 0;
                if ($amount < 100) {
                    return;
                }
                $farmer = Farmer::find($inv->farmer_id);
                $trx = strtoupper(Str::random(10));
                $this->api('cashier', 'POST', 'public/payments', [
                    'farmer_code' => $farmer->farmer_code, 'payer_name' => $farmer->name_bn, 'mobile' => $farmer->mobile ?: $this->mobile(),
                    'method' => $this->pick(['bkash', 'bkash', 'nagad']), 'sender_number' => $this->mobile(), 'trx_id' => $trx, 'amount' => $amount, 'paid_on' => $d,
                ]);
                $id = DB::table('public_payment_requests')->where('trx_id', $trx)->value('id');
                $this->at(Carbon::parse($d)->addDays(mt_rand(1, 2)), function () use ($id, $outcome) {
                    $ok = $outcome === 'verify' && $this->tryApi('accountant', 'POST', "public-payments/$id/verify", ['fund_account_id' => $this->mobileAccountId]);
                    if (! $ok) {
                        $this->api('cashier', 'POST', "public-payments/$id/reject", ['reason' => $outcome === 'verify' ? 'টাকার পরিমাণ বকেয়ার সাথে মিলছে না' : 'এই ট্রানজেকশন আইডি বিকাশ স্টেটমেন্টে পাওয়া যায়নি']);
                    }
                });
            });
        }
    }

    /** At the year end the AGM shares out profit on savings and a dividend on shares. */
    private function distributions(): void
    {
        $end = $this->lastFiscalYearEnd();
        if (! $end) {
            return;
        }
        $this->at($end->copy()->addDays(5), function () use ($end) {
            $fy = Bn::toBnDigits(($end->year - 1).'-'.substr((string) $end->year, 2));
            $rows = $this->api('accountant', 'GET', 'distributions/profit/preview')['rows'] ?? [];
            $items = collect($rows)->filter(fn ($r) => ($r['member_status'] ?? null) === Member::ACTIVE && $r['basis'] > 0)
                ->map(fn ($r) => ['member_id' => $r['member_id'], 'amount' => round($r['basis'] * 0.04)])->filter(fn ($r) => $r['amount'] > 0)->values()->all();
            if ($items) {
                $r = $this->api('accountant', 'POST', 'distributions/profit', ['title' => "সঞ্চয়ের মুনাফা $fy (৪%)", 'date' => $end->toDateString(), 'remarks' => 'বার্ষিক সাধারণ সভার সিদ্ধান্ত অনুযায়ী', 'items' => $items]);
                $this->approve(DistributionRun::whereKey($r['id'])->value('approval_request_id'));
            }
            $r = $this->api('accountant', 'POST', 'distributions/dividend', ['title' => "শেয়ার লভ্যাংশ $fy", 'date' => $end->toDateString(), 'basis_date' => $end->toDateString(), 'pool_amount' => 30000,
                'remarks' => 'শেয়ার মূলধনের অনুপাতে']);
            $this->approve(DistributionRun::whereKey($r['id'])->value('approval_request_id'));
        });
    }

    private function lastFiscalYearEnd(): ?Carbon
    {
        $startMonth = (int) (SettingService::get('fiscal_year_start_month') ?: 7);
        $end = Carbon::create(Carbon::parse($this->today)->year, $startMonth, 1)->subDay();
        if ($end->toDateString() >= $this->today) {
            $end->subYear();
        }

        return $end->gt($this->start->copy()->addMonths(3)) ? $end : null;
    }

    /** Two members take out all their savings and close the account; the second request still waits. */
    private function accountClosures(): void
    {
        foreach ([[40, true], [8, false]] as [$back, $approve]) {
            $this->at(Carbon::parse($this->today)->subDays($back), function (string $d) use ($approve) {
                $busy = Loan::whereIn('status', Loan::OPEN)->pluck('member_id')->all();
                $acc = MemberAccount::where('kind', 'savings')->where('status', 'active')->whereIn('id', array_filter(array_column($this->accounts, 'savings')))
                    ->whereBetween('balance', [500, 15000])->whereNotIn('member_id', $busy)
                    ->whereHas('member', fn ($m) => $m->where('status', Member::ACTIVE))->inRandomOrder()->limit(20)->get()
                    ->first(fn (MemberAccount $a) => $a->available() === round((float) $a->balance, 2));
                if (! $acc || ! $this->ensureCash('cash_society', (float) $acc->balance, $d)) {
                    return;
                }
                $t = $this->api('cashier', 'POST', "funds/savings/accounts/{$acc->id}/transactions", [
                    'type' => 'withdrawal', 'date' => $d, 'amount' => (float) $acc->balance, 'method' => 'cash', 'fund_account_id' => null, 'counter_account_id' => null,
                    'remarks' => 'হিসাব বন্ধের আগে সম্পূর্ণ জের উত্তোলন',
                ]);
                $this->approve(MemberTransaction::whereKey($t['id'])->value('approval_request_id'));
                unset($this->accounts[$acc->member_id]['savings']);
                $r = $this->api('accountant', 'POST', "funds/savings/accounts/{$acc->id}/close", ['date' => $d, 'reason' => $this->pick(['এলাকা ছেড়ে শহরে চলে যাচ্ছেন', 'সদস্যের নিজের আবেদনে'])]);
                $approve && $this->approve($r['close_request_id'] ?? null);
            });
        }
    }

    /** Withdrawals asked for in the last days, still waiting for the manager. */
    private function pendingWithdrawals(): void
    {
        foreach ([2, 1] as $back) {
            $this->at(Carbon::parse($this->today)->subDays($back), fn (string $d) => $this->withdrawal($d, false));
        }
    }

    /**
     * Month-end work: the bank statement is reconciled early next month (the
     * newest one is still a draft), the month is locked around the 10th, the
     * data checker runs each month, and the year is closed after the AGM.
     */
    // ------------------------------------------------------------------ water supply

    /** connection id => ['payer' => 'good'|'late'|'chronic'] */
    private array $water = [];

    /**
     * Household water: the society sets its fees, the village's existing taps
     * come in on day one (anyone, farmer or not), a few new ones each month
     * with a connection fee. Every month's fixed bills are made on the 3rd;
     * most pay that month, some late with a penalty at the counter, a few
     * owe for months — one is cut off and later reconnected, one closes.
     * One wrong bill and one wrong receipt are cancelled through approval.
     */
    private function waterSupply(): void
    {
        $d0 = $this->start->copy()->addDays(1);
        $this->at($d0, function (string $d) {
            $fees = ['RES' => [200, 1500], 'COM' => [500, 3000], 'INS' => [350, 2000]];
            foreach ($this->api('water', 'GET', 'water/types') as $t) {
                [$monthly, $fee] = $fees[$t['code']] ?? [250, 1500];
                $this->api('manager', 'PUT', "water/types/{$t['id']}", [
                    'code' => $t['code'], 'name_bn' => $t['name_bn'], 'name_en' => $t['name_en'], 'monthly_fee' => $monthly,
                    'connection_fee' => $fee, 'is_active' => true, 'sort_order' => $t['sort_order'],
                ]);
            }
            // the taps the village already had before the system came in
            for ($i = 0; $i < 45; $i++) {
                $this->waterConnection($d, $this->start->copy()->subMonths(mt_rand(3, 30))->toDateString(), false);
            }
        });
        // a few new taps every month, each with its connection fee
        for ($m = $this->start->copy()->addMonth()->startOfMonth(); $m->toDateString() <= $this->today; $m->addMonth()) {
            for ($k = mt_rand(1, 3); $k > 0; $k--) {
                $this->at($m->copy()->addDays(mt_rand(5, 25)), fn (string $d) => $this->waterConnection($d, $d, true));
            }
        }
        // the month's bills on the 3rd, then the money comes in through the month
        for ($m = $this->start->copy()->startOfMonth(); $m->toDateString() <= $this->today; $m->addMonth()) {
            $month = $m->copy();
            $billOn = $month->copy()->day(3)->max($d0->copy()->addDay());
            $this->at($billOn, function (string $d) use ($month) {
                $period = $month->format('Y-m');
                $preview = $this->api('water', 'GET', 'water/billing/preview', ['period' => $period]);
                if (! $preview['count']) {
                    return;
                }
                $this->api('water', 'POST', 'water/billing', ['period' => $period, 'bill_date' => $d, 'due_date' => $month->copy()->day(20)->toDateString()]);
                foreach ($this->water as $id => $c) {
                    $this->waterPayment($id, $c['payer'], $month, Carbon::parse($d));
                }
            });
            $this->at($month->copy()->day(18), fn (string $d) => $this->expense('cash_water', 'other_expense', $this->money(2500, 5000), 'পানির পাম্পের বিদ্যুৎ বিল', $d));
            if ($this->chance(0.4)) {
                $this->at($month->copy()->day(22), fn (string $d) => $this->expense('cash_water', 'other_expense', $this->money(500, 2500), $this->pick(['পানির পাইপ লিকেজ মেরামত', 'পানির ট্যাংক পরিষ্কার', 'ভাল্ব বদল']), $d));
            }
        }

        $this->waterTroubles();
    }

    /** One customer's tap: a farmer of the village or someone else who lives there. */
    private function waterConnection(string $date, string $connectedOn, bool $withFee): void
    {
        $v = $this->pick($this->villages);
        $farmer = $this->chance(0.55) ? Farmer::whereIn('id', array_keys($this->farmers))->inRandomOrder()->first() : null;
        if ($farmer) {
            [$bn, $en, $father, $mobile] = [$farmer->name_bn, $farmer->name_en, $farmer->father_name, $farmer->mobile];
            $v = collect($this->villages)->firstWhere('id', $farmer->village_id) ?? $v;
        } else {
            $male = $this->chance(0.7);
            [$bn, $en] = DemoNames::person($male);
            [$father] = DemoNames::person(true);
            $mobile = $this->chance(0.85) ? $this->mobile() : null;
        }
        $type = $this->chance(0.82) ? 'RES' : ($this->chance(0.7) ? 'COM' : 'INS');
        $typeId = (int) DB::table('water_connection_types')->where('code', $type)->value('id');
        $c = $this->api('water', 'POST', 'water/connections', [
            'type_id' => $typeId, 'name_bn' => $bn, 'name_en' => $en, 'father_name' => $father, 'mobile' => $mobile,
            'village_id' => $v['id'], 'address' => $this->pick(['উত্তর পাড়া', 'দক্ষিণ পাড়া', 'পূর্ব পাড়া', 'পশ্চিম পাড়া', 'বাজার এলাকা', 'মসজিদ সংলগ্ন', 'স্কুল রোড']),
            'connected_on' => $connectedOn,
            // a shop or two pays a little more than the usual fee by agreement
            'monthly_fee' => $type === 'COM' && $this->chance(0.3) ? 600 : null,
            'connection_fee' => $withFee ? (int) DB::table('water_connection_types')->where('id', $typeId)->value('connection_fee') : 0,
        ]);
        $roll = mt_rand(1, 100);
        $this->water[$c['id']] = ['payer' => $roll <= 72 ? 'good' : ($roll <= 92 ? 'late' : 'chronic')];
        if ($withFee) {
            // the connection fee is paid the day the tap is fitted, or within the week
            $this->at(Carbon::parse($date)->addDays($this->chance(0.7) ? 0 : mt_rand(2, 7)), fn (string $d) => $this->waterCollect($c['id'], $d, 0));
        }
    }

    /** When this month's bill is paid: good payers within the month, late ones next month with a penalty, chronic ones every few months. */
    private function waterPayment(int $id, string $payer, Carbon $month, Carbon $billed): void
    {
        $penalty = $this->pick([20, 30, 50]);
        // never before the bill itself (the first month's bills come late in the month)
        $on = fn (Carbon $d) => $d->max($billed);
        match ($payer) {
            'good' => $this->at($on($month->copy()->day(mt_rand(5, 25))), fn (string $d) => $this->waterCollect($id, $d, 0, $this->chance(0.05))),
            'late' => $this->chance(0.6)
                ? $this->at($on($month->copy()->day(mt_rand(6, 26))), fn (string $d) => $this->waterCollect($id, $d, 0))
                : $this->at($month->copy()->addMonth()->day(mt_rand(4, 15)), fn (string $d) => $this->waterCollect($id, $d, $penalty)),
            'chronic' => $month->month % 4 === 0
                ? $this->at($on($month->copy()->day(mt_rand(8, 25))), fn (string $d) => $this->waterCollect($id, $d, $penalty * 2))
                : null,
        };
    }

    /** Money for a tap's open bills at the counter (half of it now and then), with any penalty. */
    private function waterCollect(int $id, string $date, int $penalty, bool $half = false): ?int
    {
        $dues = $this->api('water', 'GET', "water/connections/$id/dues");
        if (! $dues['bills']) {
            return null;
        }
        $items = array_map(fn ($b) => ['bill_id' => $b['id'], 'amount' => $b['due']], $dues['bills']);
        if ($half) {
            $items = [['bill_id' => $items[0]['bill_id'], 'amount' => max(50, round($items[0]['amount'] / 2))]];
        }
        $roll = mt_rand(1, 100);
        $money = match (true) {
            $roll <= 85 => ['method' => 'cash'],
            $roll <= 95 => ['method' => 'other', 'fund_account_id' => $this->mobileAccountId, 'reference' => 'BK'.Str::upper(Str::random(8))],
            default => ['method' => 'bank', 'fund_account_id' => $this->bankAccountId, 'reference' => 'CHQ-'.mt_rand(100000, 999999)],
        };
        $r = $this->api('water', 'POST', 'water/collect', $money + [
            'connection_id' => $id, 'date' => $date, 'penalty' => $penalty, 'items' => $items,
            'remarks' => $penalty ? 'দেরিতে পরিশোধ — জরিমানাসহ' : null,
        ]);

        return (int) $r['id'];
    }

    /** The year's water troubles: a cut-off and reconnection, a closed tap, a wrong bill, a wrong receipt. */
    private function waterTroubles(): void
    {
        $span = (int) $this->start->diffInDays(Carbon::parse($this->today));
        // the biggest debtor is cut off; two months later pays everything and is reconnected for a fee
        $this->at($this->start->copy()->addDays((int) ($span * 0.55)), function (string $d) {
            $debtor = DB::table('water_bills')->whereIn('status', ['unpaid', 'partial'])->groupBy('connection_id')
                ->selectRaw('connection_id, SUM(amount + penalty - paid_amount) as due')->orderByDesc('due')->value('connection_id');
            if (! $debtor) {
                return;
            }
            $this->api('water', 'POST', "water/connections/$debtor/status", ['action' => 'disconnect', 'date' => $d, 'reason' => 'তিন মাসের বেশি বিল বকেয়া — নোটিশের পরও পরিশোধ হয়নি']);
            $this->at(Carbon::parse($d)->addDays(60), function (string $x) use ($debtor) {
                $this->waterCollect($debtor, $x, 100);
                $this->api('water', 'POST', "water/connections/$debtor/status", ['action' => 'reconnect', 'date' => $x, 'reason' => 'সব বকেয়া জরিমানাসহ পরিশোধ', 'fee' => 300]);
                $this->waterCollect($debtor, $x, 0);
                $this->water[$debtor]['payer'] = 'good';
            });
            // a cut-off tap gets no bills, so it is no longer in the monthly round until reconnected
            $this->water[$debtor]['payer'] = 'chronic';
        });
        // a family moves away: pays up and closes the tap
        $this->at($this->start->copy()->addDays((int) ($span * 0.7)), function (string $d) {
            $id = collect($this->water)->filter(fn ($c) => $c['payer'] === 'good')->keys()->first();
            if (! $id) {
                return;
            }
            $this->waterCollect($id, $d, 0);
            $this->api('water', 'POST', "water/connections/$id/status", ['action' => 'close', 'date' => $d, 'reason' => 'পরিবার অন্যত্র চলে গেছে — বাড়ি বিক্রি']);
            unset($this->water[$id]);
        });
        // a bill made by mistake for a tap that was not running that month: cancelled with the manager's approval
        $this->at($this->start->copy()->addDays((int) ($span * 0.4)), function (string $d) {
            $bill = DB::table('water_bills')->where('kind', 'monthly')->where('status', 'unpaid')->orderByDesc('id')->first();
            if ($bill) {
                $req = $this->api('water', 'POST', "water/bills/{$bill->id}/cancel", ['reason' => 'মেরামতের জন্য সংযোগ পুরো মাস বন্ধ ছিল — ভুল বিল']);
                // approved the same day, before anyone could take money for the bill
                $this->approve($req['id']);
            }
        });
        // money written down wrong: the receipt is cancelled through approval and taken again
        $this->at($this->start->copy()->addDays((int) ($span * 0.65)), function (string $d) {
            $id = collect($this->water)->filter(fn ($c) => $c['payer'] === 'good')->keys()->last();
            $receipt = $id ? $this->waterCollect($id, $d, 0) : null;
            if (! $receipt) {
                return;
            }
            $req = $this->api('water', 'POST', "water/receipts/$receipt/cancel", ['reason' => 'টাকার অঙ্ক ভুল লেখা হয়েছিল']);
            $this->approve($req['id']);
            $this->waterCollect($id, $d, 0);
        });
    }

    private function monthEnds(): void
    {
        $today = Carbon::parse($this->today);
        for ($m = $this->start->copy()->startOfMonth(); $m->lt($today->copy()->startOfMonth()); $m->addMonth()) {
            $month = $m->copy();
            $recOn = $month->copy()->addMonth()->day(5);
            $recOn->lte($today)
                ? $this->at($recOn, fn () => $this->reconcile($month, true))
                : $this->at($today, fn () => $this->reconcile($month, false));
            if ($month->copy()->endOfMonth()->lt($today->copy()->subDays(25))) {
                $this->at($month->copy()->addMonth()->day(10), function () use ($month) {
                    $id = AccountingPeriod::where('period_key', $month->format('Y-m'))->where('status', 'open')->value('id');
                    $id && $this->tryApi('president', 'POST', "accounting/periods/$id/close");
                });
            }
            $this->at($month->copy()->day(27)->max($this->start), fn () => $this->tryApi('admin', 'POST', 'integrity-scans'));
        }
        if ($end = $this->lastFiscalYearEnd()) {
            $this->at($end->copy()->addDays(20), function (string $d) {
                foreach (collect(app(FinancialYearService::class)->years())->sortBy('fiscal_year') as $y) {
                    if (! $y['close'] && $y['end_date'] < $d) {
                        $this->tryApi('admin', 'POST', "financial-years/{$y['fiscal_year']}/close", ['note' => 'বার্ষিক সাধারণ সভায় হিসাব অনুমোদনের পর বছর বন্ধ', 'confirm' => true]);
                    }
                }
            });
        }
    }

    /** The bank statement for a month: every movement, plus charges (and interest each quarter) that the books learn of only from it. */
    private function reconcile(Carbon $month, bool $final): void
    {
        $from = $month->copy()->startOfMonth()->toDateString();
        $to = $month->copy()->endOfMonth()->toDateString();
        $lines = JournalLine::query()->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->where('journal_lines.account_id', $this->bankAccountId)->whereIn('journals.status', LedgerService::EFFECTIVE)
            ->whereBetween('journals.date', [$from, $to])->orderBy('journals.date')->orderBy('journal_lines.id')
            ->get(['journals.date', 'journals.narration', 'journals.voucher_no', 'journal_lines.debit', 'journal_lines.credit'])
            ->map(fn ($l) => ['date' => Carbon::parse($l->date)->toDateString(), 'description' => Str::limit((string) $l->narration, 200), 'reference' => $l->voucher_no,
                'amount' => round((float) $l->debit - (float) $l->credit, 2)])->all();
        $lines[] = ['date' => $to, 'description' => 'ব্যাংক চার্জ ও ভ্যাট', 'reference' => 'SC-'.$month->format('ym'), 'amount' => -10 * mt_rand(5, 25)];
        if ($month->month % 3 === 0) {
            $lines[] = ['date' => $to, 'description' => 'সঞ্চয়ী হিসাবের সুদ', 'reference' => 'INT-'.$month->format('ym'), 'amount' => $this->money(300, 1500, 10)];
        }
        $opening = (float) (BankReconciliation::where('bank_account_id', $this->bankId)->where('status', 'finalized')->orderByDesc('period')->value('statement_closing') ?? 0);
        $rec = $this->api('accountant', 'POST', 'bank-reconciliations', [
            'bank_account_id' => $this->bankId, 'period' => $month->format('Y-m'), 'statement_closing' => round($opening + array_sum(array_column($lines, 'amount')), 2),
            'note' => $final ? null : 'বিবরণী এসেছে — ব্যাংক চার্জ এখনো খাতায় তোলা হয়নি',
        ]);
        $this->api('accountant', 'POST', "bank-reconciliations/{$rec['id']}/lines", ['lines' => $lines]);
        $this->api('accountant', 'POST', "bank-reconciliations/{$rec['id']}/auto-match");
        if (! $final) {
            return;
        }
        foreach ($this->api('accountant', 'GET', "bank-reconciliations/{$rec['id']}")['lines'] as $l) {
            if (empty($l['journal_line_id'])) {
                $this->api('accountant', 'POST', "bank-reconciliations/{$rec['id']}/lines/{$l['id']}/book", ['account_id' => Account::byKey((float) $l['amount'] < 0 ? 'bank_charges' : 'other_income')->id]);
            }
        }
        $this->tryApi('accountant', 'POST', "bank-reconciliations/{$rec['id']}/finalize");
    }

    /** After the year: the cash counted and each day closed (the last few left open), a last data check, and the demo's SMS kept from going out. */
    private function finish(int $smsBefore): void
    {
        ($this->log)('দিন বন্ধ ও শেষ ধাপ…');
        $until = Carbon::parse($this->today)->subDays(5)->toDateString();
        Carbon::setTestNow(Carbon::parse($this->today)->setTime(9, 0));
        $days = array_filter(app(DayCloseService::class)->unclosedDays(1000), fn ($d) => $d <= $until && $d >= $this->start->toDateString());
        $closed = 0;
        foreach ($days as $date) {
            Carbon::setTestNow(Carbon::parse($date)->setTime(17, mt_rand(0, 50)));
            $s = $this->api('cashier', 'GET', 'day-closes/summary', ['date' => $date]);
            if (($s['pending_vouchers'] ?? 0) > 0) {
                continue;
            }
            $actual = [];
            foreach ($s['streams'] as $st) {
                $actual[$st['account_id']] = $st['expected'];
            }
            $note = null;
            $short = collect($s['streams'])->first(fn ($st) => $st['expected'] >= 500);
            if ($short && $this->chance(0.05)) {
                $actual[$short['account_id']] = round($short['expected'] - 10 * mt_rand(1, 5), 2);
                $note = 'গণনায় খুচরা টাকা কম — পরের দিন খোঁজা হবে';
            }
            $this->api('cashier', 'POST', 'day-closes', ['date' => $date, 'actual' => $actual, 'note' => $note]);
            $closed++;
        }
        ($this->log)("  $closed দিন বন্ধ করা হয়েছে");
        Carbon::setTestNow();
        $this->tryApi('admin', 'POST', 'integrity-scans');
        if ($this->publicSettings !== null) {
            SettingService::setMany($this->publicSettings);
        }
        // the demo's mobile numbers are made up: nothing it queued may go out as a real SMS
        SmsLog::where('id', '>', $smsBefore)->where('status', 'pending')->update(['status' => 'logged', 'response' => 'ডেমো ডাটা — SMS পাঠানো হয়নি']);
    }
}
