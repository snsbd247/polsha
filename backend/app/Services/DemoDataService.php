<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\AssetCategory;
use App\Models\AuditLog;
use App\Models\District;
use App\Models\Division;
use App\Models\Invoice;
use App\Models\IrrigationType;
use App\Models\Journal;
use App\Models\LandType;
use App\Models\Loan;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\Sequence;
use App\Models\User;
use App\Support\Bn;
use Closure;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
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

        try {
            $this->makeUsers();
            SettingService::putQuiet(self::SETTING, ['snapshot' => $snapshot, 'seeded_at' => $seededAt, 'users' => collect($this->users)->pluck('id')->all()]);
            // the system clock follows the simulated day, so join dates, audit times etc. land on it
            $this->counters = Sequence::where('reset_yearly', true)->get(['key', 'current_year', 'next_value'])->all();
            Carbon::setTestNow($this->start->copy()->setTime(10, 0));
            $this->resumeCounters($this->start->year);
            $this->setup($farmers);
            $this->run();
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
        $log('ডেমোর আগের স্ন্যাপশট ফেরানো হচ্ছে…');
        $this->backups->restore($path);
        $this->catchUpSchema($path, $log);
        Cache::flush();
        $log('ডেমো ডাটা মুছে ফেলা হয়েছে।');
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
        // the admin also enters old-book members and the demo area
        $this->users['admin']->givePermissionTo(['member.admin', 'member.view', 'location.create', 'mouza.create', 'farmer.view', 'farmer.delete']);
    }

    /** Call the API as a demo user; any error stops the run. */
    private function api(string $as, string $method, string $uri, array $data = []): array
    {
        $user = $this->users[$as];
        $server = ['HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$this->tokens[$user->id], 'HTTP_ACCEPT_LANGUAGE' => 'bn'];
        $request = $method === 'GET'
            ? Request::create('/api/'.$uri, 'GET', $data, [], [], $server)
            : Request::create('/api/'.$uri, $method, [], [], [], $server + ['CONTENT_TYPE' => 'application/json'], json_encode($data));
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
        $this->bankAccountId = (int) $this->api('accountant', 'POST', 'bank-accounts', [
            'bank_name' => 'সোনালী ব্যাংক (ডেমো)', 'branch' => 'শিবপুর', 'account_no' => '0200'.mt_rand(100000, 999999), 'account_type' => 'savings',
        ])['account_id'];
        $this->loanProducts();
        $this->makeFarmers($count);
        $this->patwaris();
        $this->makeLands();
        $this->legacyMembers($d0);
        $this->applications();
        $this->seasons();
        $this->assets();
        $this->monthly();
        $this->statusChanges();
        $this->voterLists();
        $this->deletions();
        $this->landTransfers();
        $this->loans();
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
            'installments' => 12, 'penalty_rate' => 2, 'grace_days' => 7, 'guarantors_required' => 1, 'is_active' => true,
        ])['id'];
        $this->products['season'] = $this->api('manager', 'POST', 'loan-products', [
            'code' => 'DSN-'.$suffix, 'name_bn' => 'মৌসুমি ঋণ (ফসল তোলার পর)', 'name_en' => 'Seasonal loan', 'category' => 'agriculture',
            'max_amount' => 30000, 'savings_multiplier' => 3, 'interest_rate' => 10, 'interest_method' => 'flat', 'frequency' => 'one_time',
            'installments' => 1, 'term_months' => 6, 'penalty_rate' => 2, 'grace_days' => 15, 'guarantors_required' => 1, 'is_active' => true,
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
        foreach (array_slice($ids, 0, (int) round(count($ids) * 0.55)) as $fid) {
            $no += mt_rand(1, 4);
            $m = $this->api('admin', 'POST', 'members/legacy', [
                'farmer_id' => $fid, 'member_no' => $no, 'admitted_on' => Carbon::create(mt_rand(2012, 2024), mt_rand(1, 12), mt_rand(1, 28))->min($this->start->copy()->subMonth())->toDateString(),
            ]);
            $this->members[$fid] = $m['id'];
            $this->openAccounts($m['id'], $d0, $this->money(500, 25000), $this->money(500, 6000, 10));
        }
        ($this->log)('  '.count($this->members).' জন পুরোনো সদস্য');
    }

    /** Savings + share accounts; carried-over balances enter as approved opening balances. */
    private function openAccounts(int $memberId, string $date, int $savings = 0, int $share = 0): void
    {
        foreach (['savings' => $savings, 'share' => $share] as $kind => $opening) {
            $a = $this->api('cashier', 'POST', "funds/$kind/accounts", ['member_id' => $memberId, 'opened_on' => $date]);
            $this->accounts[$memberId][$kind] = $a['id'];
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
                        $this->moneyIn($memberId, 'share', $d, (int) ($shares * $this->unit));
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
                    'name_bn' => $name, 'crop' => 'ধান', 'start_date' => $s->toDateString(), 'end_date' => $e->toDateString(),
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
                        'name_bn' => $name, 'crop' => 'ধান', 'start_date' => $s->toDateString(), 'end_date' => $e->toDateString(),
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
        $this->api('irrigation', 'POST', 'receipts', [
            'farmer_id' => $farmerId, 'date' => $date, 'method' => 'cash',
            'reference' => null, 'items' => [['invoice_id' => $invoiceId, 'amount' => $amount]],
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
        foreach (['cash_society' => [150000, 60000], 'cash_irrigation' => [70000, 40000]] as $fund => [$keep, $amount]) {
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

    private function withdrawal(string $date): void
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
        $this->approve(MemberTransaction::whereKey($t['id'])->value('approval_request_id'));
    }

    /** A member pays a round sum at the counter; the system splits it over dues. */
    private function combined(string $date): void
    {
        $fid = Member::whereIn('id', array_values($this->members))->where('status', Member::ACTIVE)->inRandomOrder()->value('farmer_id');
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
                    $r = $this->api('member', 'POST', 'farmers-merge', ['keep_id' => $real, 'remove_id' => $f['id'], 'choices' => []]);
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
            $when = $inst->due_date->copy()->addDays($style === 'late' ? mt_rand(10, 40) : mt_rand(-5, 3));
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
}
