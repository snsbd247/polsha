<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Asset;
use App\Models\AssetMaintenance;
use App\Models\BankReconciliation;
use App\Models\CombinedPayment;
use App\Models\ExportLog;
use App\Models\Invoice;
use App\Models\IrrigationRate;
use App\Models\Land;
use App\Models\Loan;
use App\Models\LoanProduct;
use App\Models\MemberTransaction;
use App\Models\PublicPaymentRequest;
use App\Models\Receipt;
use App\Models\WaterBill;
use App\Models\WaterConnection;
use App\Models\Season;
use App\Models\User;
use App\Support\Bn;
use App\Support\Tr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * One registry for every tabular report. A definition names its category,
 * permission, filters, columns and a row builder; the same output drives the
 * on-screen table, the print (Save as PDF) layout and the Excel export.
 * Columns: [key, label, type (text|money|number|decimal|date), sum?].
 */
class ReportService
{
    public const MAX_ROWS = 5000;

    public const CATEGORIES = [
        'farmer' => 'কৃষক ও সদস্য', 'land' => 'জমি', 'irrigation' => 'সেচ', 'water' => 'পানি সরবরাহ', 'savings' => 'সঞ্চয় ও শেয়ার', 'loan' => 'ঋণ',
        'accounting' => 'হিসাব', 'collection' => 'আদায়', 'due' => 'বকেয়া', 'audit' => 'অডিট', 'asset' => 'সম্পদ',
    ];

    public function __construct(private AccountingReportService $accounting, private LedgerIntegrityService $integrity) {}

    /** Reports the user may open, without filter options. */
    public function catalog(User $user): array
    {
        return collect($this->definitions())
            ->filter(fn ($d) => $this->allowed($user, $d['perm']))
            ->map(fn ($d, $key) => ['key' => $key, 'title' => $d['title'], 'categories' => $d['categories']])
            ->values()->all();
    }

    public function categories(): array
    {
        return Tr::map(self::CATEGORIES);
    }

    public function exists(string $key): bool
    {
        return isset($this->definitions()[$key]);
    }

    public function allowedFor(User $user, string $key): bool
    {
        $d = $this->definitions()[$key] ?? null;

        return $d && $this->allowed($user, $d['perm']);
    }

    public function run(string $key, array $input): array
    {
        $d = $this->definitions()[$key];
        $filters = $this->resolveFilters($d['filters'], $input);
        // A required filter not chosen yet: return the filter list (so the page can offer it) with no rows.
        $notice = isset($filters['_missing']) ? __(':field নির্বাচন করুন।', ['field' => $filters['_missing']]) : null;
        $result = $notice ? [] : ($d['rows'])($filters);
        // a report returns its rows, or ['rows' => …, 'summary' => …]
        $withSummary = is_array($result) && array_key_exists('rows', $result);
        $rows = collect($withSummary ? $result['rows'] : $result);
        $summary = $withSummary ? ($result['summary'] ?? []) : [];

        $truncated = $rows->count() > self::MAX_ROWS;
        $rows = $rows->take(self::MAX_ROWS)->values();
        $columns = array_map(fn ($c) => ['key' => $c[0], 'label' => $c[1], 'type' => $c[2] ?? 'text', 'sum' => (bool) ($c[3] ?? false)], $d['columns']);
        $totals = [];
        foreach ($columns as $c) {
            if ($c['sum']) {
                $totals[$c['key']] = round($rows->sum(fn ($r) => (float) ($r[$c['key']] ?? 0)), 2);
            }
        }

        return [
            'key' => $key, 'title' => $d['title'], 'subtitle' => $this->subtitle($d['filters'], $filters),
            'filters' => $this->filterMeta($d['filters'], $filters), 'values' => $filters,
            'columns' => $columns, 'rows' => $rows, 'totals' => $totals, 'summary' => $summary,
            'truncated' => $truncated, 'notice' => $notice, 'generated_at' => now()->toDateTimeString(),
        ];
    }

    public function logExport(User $user, string $key, string $format, array $filters, int $rows, ?string $ip): ExportLog
    {
        return ExportLog::create([
            'user_id' => $user->id, 'report_key' => $key, 'title' => $this->definitions()[$key]['title'] ?? $key,
            'format' => $format, 'filters' => $filters, 'row_count' => $rows, 'ip' => $ip,
        ]);
    }

    // ------------------------------------------------------------------ filters

    /** Filter kinds: period (from,to), as_of, and select/text filters with options. */
    private function filterSpec(string $name): array
    {
        $opts = fn ($rows, $label = 'name_bn') => collect($rows)->map(fn ($r) => ['value' => $r->id, 'label' => $this->nm($r, $label)])->values()->all();

        return match ($name) {
            'period' => ['name' => 'period', 'type' => 'period', 'label' => __('সময়কাল')],
            'as_of' => ['name' => 'as_of', 'type' => 'date', 'label' => __('তারিখ পর্যন্ত')],
            'q' => ['name' => 'q', 'type' => 'text', 'label' => __('খুঁজুন')],
            'member_no' => ['name' => 'member_no', 'type' => 'text', 'label' => __('সদস্য নং'), 'required' => true],
            'mouza' => ['name' => 'mouza_id', 'type' => 'select', 'label' => __('মৌজা'),
                'options' => fn () => $opts(DB::table('mouzas')->orderBy('name_bn')->get(['id', 'name_bn', 'name_en']))],
            'season' => ['name' => 'season_id', 'type' => 'select', 'label' => __('মৌসুম'),
                'options' => fn () => $opts(DB::table('seasons')->orderByDesc('start_date')->get(['id', 'name_bn']))],
            'land_type' => ['name' => 'land_type_id', 'type' => 'select', 'label' => __('জমির ধরন'),
                'options' => fn () => $opts(DB::table('land_types')->orderBy('sort_order')->get(['id', 'name_bn']))],
            'irrigation_type' => ['name' => 'irrigation_type_id', 'type' => 'select', 'label' => __('সেচের ধরন'),
                'options' => fn () => $opts(DB::table('irrigation_types')->orderBy('sort_order')->get(['id', 'name_bn']))],
            'loan_product' => ['name' => 'product_id', 'type' => 'select', 'label' => __('ঋণের ধরন'),
                'options' => fn () => $opts(DB::table('loan_products')->orderBy('code')->get(['id', 'name_bn', 'name_en']))],
            'voter_list' => ['name' => 'voter_list_id', 'type' => 'select', 'label' => __('ভোটার তালিকা'),
                'options' => fn () => DB::table('voter_lists')->orderByDesc('id')->get(['id', 'title'])->map(fn ($r) => ['value' => $r->id, 'label' => $r->title])->all()],
            'account' => ['name' => 'account_id', 'type' => 'select', 'label' => __('হিসাব'), 'required' => true,
                'options' => fn () => Account::where('is_postable', true)->orderBy('code')->get()->map(fn ($a) => ['value' => $a->id, 'label' => $a->code.' — '.$this->nm($a)])->all()],
            'fund' => ['name' => 'account_id', 'type' => 'select', 'label' => __('নগদ/ব্যাংক হিসাব'), 'required' => true,
                'options' => fn () => $this->fundAccounts()->map(fn ($a) => ['value' => $a->id, 'label' => $a->code.' — '.$this->nm($a)])->all()],
            'user' => ['name' => 'user_id', 'type' => 'select', 'label' => __('ইউজার'),
                'options' => fn () => $opts(DB::table('users')->orderBy('name_bn')->get(['id', 'name_bn', 'name_en']))],
            'audit_module' => ['name' => 'module', 'type' => 'select', 'label' => __('মডিউল'), 'options' => fn () => $this->options(config('erp.modules'))],
            'farmer_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(['active' => 'সক্রিয়', 'inactive' => 'নিষ্ক্রিয়'])],
            'member_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(['active' => 'সক্রিয়', 'inactive' => 'নিষ্ক্রিয়', 'cancelled' => 'বাতিল'])],
            'land_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(Land::STATUSES)],
            'cultivation_type' => ['name' => 'type', 'type' => 'select', 'label' => __('চাষের ধরন'), 'options' => fn () => $this->options(Land::CULTIVATION_TYPES)],
            'invoice_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(Invoice::STATUSES)],
            'loan_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(Loan::STATUSES)],
            'fund_kind' => ['name' => 'kind', 'type' => 'select', 'label' => __('হিসাবের ধরন'), 'default' => 'savings', 'options' => fn () => $this->options(['savings' => 'সঞ্চয়', 'share' => 'শেয়ার'])],
            'withdrawal_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'),
                'options' => fn () => $this->options(['posted' => 'অনুমোদিত', 'pending' => 'অপেক্ষমাণ', 'rejected' => 'প্রত্যাখ্যাত', 'cancelled' => 'বাতিলকৃত'])],
            'asset_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(Asset::STATUSES)],
            'approval_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'),
                'options' => fn () => $this->options(['pending' => 'অপেক্ষমাণ', 'approved' => 'অনুমোদিত', 'rejected' => 'প্রত্যাখ্যাত', 'returned' => 'ফেরত'])],
            'public_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(PublicPaymentRequest::STATUSES)],
            'water_type' => ['name' => 'type_id', 'type' => 'select', 'label' => __('সংযোগের ধরন'),
                'options' => fn () => $opts(DB::table('water_connection_types')->orderBy('sort_order')->get(['id', 'name_bn', 'name_en']))],
            'water_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(WaterConnection::STATUSES)],
            'water_bill_status' => ['name' => 'status', 'type' => 'select', 'label' => __('অবস্থা'), 'options' => fn () => $this->options(WaterBill::STATUSES)],
            default => throw new \LogicException("Unknown report filter {$name}"),
        };
    }

    private function resolveFilters(array $names, array $input): array
    {
        $out = [];
        foreach ($names as $name) {
            $spec = $this->filterSpec($name);
            if ($spec['type'] === 'period') {
                $from = $this->date($input['from'] ?? null) ?? now()->startOfMonth()->toDateString();
                $to = $this->date($input['to'] ?? null) ?? now()->toDateString();
                if ($from > $to) {
                    throw ValidationException::withMessages(['from' => __('শুরুর তারিখ শেষের তারিখের পরে হতে পারে না।')]);
                }
                $out['from'] = $from;
                $out['to'] = $to;

                continue;
            }
            if ($spec['type'] === 'date') {
                $out[$spec['name']] = $this->date($input[$spec['name']] ?? null) ?? now()->toDateString();

                continue;
            }
            $value = $input[$spec['name']] ?? ($spec['default'] ?? null);
            $value = is_string($value) ? trim(Bn::toEnDigits($value)) : $value;
            $out[$spec['name']] = $value === '' ? null : $value;
            if (($spec['required'] ?? false) && $out[$spec['name']] === null) {
                $out['_missing'] = $spec['label'];
            }
        }

        return $out;
    }

    private function filterMeta(array $names, array $values): array
    {
        return array_map(function ($name) {
            $spec = $this->filterSpec($name);
            if (isset($spec['options'])) {
                $spec['options'] = ($spec['options'])();
            }

            return $spec;
        }, $names);
    }

    private function subtitle(array $names, array $f): string
    {
        if (isset($f['from'])) {
            return __(':from থেকে :to', ['from' => Carbon::parse($f['from'])->format('d/m/Y'), 'to' => Carbon::parse($f['to'])->format('d/m/Y')]);
        }
        if (isset($f['as_of'])) {
            return __(':date পর্যন্ত', ['date' => Carbon::parse($f['as_of'])->format('d/m/Y')]);
        }

        return __(':date তারিখে প্রস্তুত', ['date' => now()->format('d/m/Y')]);
    }

    // ------------------------------------------------------------------ helpers

    private function allowed(User $user, string|array $perm): bool
    {
        foreach ((array) $perm as $p) {
            if ($user->can($p)) {
                return true;
            }
        }

        return false;
    }

    private function nm(object|array|null $r, string $bn = 'name_bn', string $en = 'name_en'): string
    {
        if ($r === null) {
            return '';
        }
        $r = (object) $r;
        if (app()->getLocale() === 'en' && ! empty($r->{$en} ?? null)) {
            return (string) $r->{$en};
        }

        return (string) ($r->{$bn} ?? '');
    }

    private function lbl(array $map, ?string $key): string
    {
        return $key === null ? '' : (string) Tr::label($map[$key] ?? $key);
    }

    private function options(array $map): array
    {
        return collect($map)->map(fn ($label, $value) => ['value' => $value, 'label' => __($label)])->values()->all();
    }

    private function date(mixed $v): ?string
    {
        if (! is_string($v) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', Bn::toEnDigits($v))) {
            return null;
        }

        return Bn::toEnDigits($v);
    }

    private function fundAccounts(): Collection
    {
        return Account::where('is_postable', true)->where(fn ($q) => $q->whereIn('key', Account::CASH_STREAMS)->orWhereHas('bankAccount'))->orderBy('code')->get();
    }

    private function needs(array $f): void
    {
        if (isset($f['_missing'])) {
            throw ValidationException::withMessages(['filters' => __(':field নির্বাচন করুন।', ['field' => $f['_missing']])]);
        }
    }

    private function farmerName(object $r): string
    {
        return app()->getLocale() === 'en' && ! empty($r->farmer_name_en) ? $r->farmer_name_en : (string) ($r->farmer_name ?? '');
    }

    /** Current owners / cultivators per land, keyed by land id. */
    private function partiesByLand(array $landIds): array
    {
        $owners = DB::table('land_owners')->join('farmers', 'farmers.id', '=', 'land_owners.farmer_id')
            ->whereIn('land_owners.land_id', $landIds)->whereNull('land_owners.end_date')
            ->get(['land_owners.land_id', 'farmers.name_bn', 'farmers.name_en', 'land_owners.share_percent'])->groupBy('land_id');
        $cult = DB::table('land_cultivations')->join('farmers', 'farmers.id', '=', 'land_cultivations.farmer_id')
            ->whereIn('land_cultivations.land_id', $landIds)->whereNull('land_cultivations.end_date')
            ->get(['land_cultivations.land_id', 'farmers.name_bn', 'farmers.name_en', 'land_cultivations.type'])->groupBy('land_id');

        $out = [];
        foreach ($landIds as $id) {
            $out[$id] = [
                'owners' => collect($owners[$id] ?? [])->map(fn ($o) => $this->nm($o).' ('.rtrim(rtrim(number_format((float) $o->share_percent, 2), '0'), '.').'%)')->implode(', '),
                'cultivator' => collect($cult[$id] ?? [])->map(fn ($c) => $this->nm($c).' — '.$this->lbl(Land::CULTIVATION_TYPES, $c->type))->implode(', '),
            ];
        }

        return $out;
    }

    // ------------------------------------------------------------------ definitions

    private ?array $defs = null;

    private function definitions(): array
    {
        return $this->defs ??= array_merge(
            $this->farmerReports(), $this->landReports(), $this->irrigationReports(), $this->waterReports(), $this->savingsReports(),
            $this->loanReports(), $this->accountingReports(), $this->collectionReports(), $this->auditReports(), $this->assetReports(),
        );
    }

    private function farmerReports(): array
    {
        $farmers = fn () => DB::table('farmers')->leftJoin('villages', 'villages.id', '=', 'farmers.village_id')
            ->leftJoin('mouzas', 'mouzas.id', '=', 'farmers.mouza_id')->leftJoin('members', 'members.farmer_id', '=', 'farmers.id')
            ->whereNull('farmers.deleted_at')->whereNull('farmers.merged_into_id');
        $farmerRow = fn ($r) => [
            'farmer_code' => $r->farmer_code, 'name' => $this->nm($r), 'father_name' => $r->father_name,
            'gender' => $this->lbl(config('erp.farmer.genders'), $r->gender), 'mobile' => $r->mobile, 'nid' => $r->nid,
            'village' => $this->nm($r, 'village_bn', 'village_en'), 'mouza' => $this->nm($r, 'mouza_bn', 'mouza_en'),
            'member_no' => $r->member_no, 'status' => $r->is_active ? __('সক্রিয়') : __('নিষ্ক্রিয়'),
        ];
        $farmerCols = [['farmer_code', __('কৃষক আইডি')], ['name', __('নাম')], ['father_name', __('পিতার নাম')], ['gender', __('লিঙ্গ')],
            ['mobile', __('মোবাইল')], ['nid', __('NID')], ['village', __('গ্রাম')], ['mouza', __('মৌজা')], ['member_no', __('সদস্য নং')], ['status', __('অবস্থা')]];
        $select = ['farmers.*', 'villages.name_bn as village_bn', 'villages.name_en as village_en', 'mouzas.name_bn as mouza_bn', 'mouzas.name_en as mouza_en', 'members.member_no'];
        $search = function ($q, $f) {
            if ($s = $f['q'] ?? null) {
                $q->where(fn ($w) => $w->where('farmers.name_bn', 'like', "%$s%")->orWhere('farmers.name_en', 'like', "%$s%")
                    ->orWhere('farmers.farmer_code', 'like', "%$s%")->orWhere('farmers.mobile', 'like', "%$s%"));
            }
        };

        return [
            'farmers' => [
                'categories' => ['farmer'], 'perm' => 'farmer.view', 'title' => __('কৃষক রিপোর্ট'),
                'filters' => ['mouza', 'farmer_status', 'q'], 'columns' => $farmerCols,
                'rows' => function ($f) use ($farmers, $farmerRow, $select, $search) {
                    $q = $farmers()->when($f['mouza_id'], fn ($q, $v) => $q->where('farmers.mouza_id', $v))
                        ->when($f['status'], fn ($q, $v) => $q->where('farmers.is_active', $v === 'active'));
                    $search($q, $f);

                    return $q->orderBy('farmers.farmer_code')->limit(self::MAX_ROWS + 1)->get($select)->map($farmerRow);
                },
            ],
            'non_members' => [
                'categories' => ['farmer'], 'perm' => 'farmer.view', 'title' => __('সদস্য নন এমন কৃষক'),
                'filters' => ['mouza', 'q'], 'columns' => $farmerCols,
                'rows' => function ($f) use ($farmers, $farmerRow, $select, $search) {
                    $q = $farmers()->whereNull('members.id')->where('farmers.is_active', true)
                        ->when($f['mouza_id'], fn ($q, $v) => $q->where('farmers.mouza_id', $v));
                    $search($q, $f);

                    return $q->orderBy('farmers.farmer_code')->limit(self::MAX_ROWS + 1)->get($select)->map($farmerRow);
                },
            ],
            'members' => [
                'categories' => ['farmer'], 'perm' => 'member.view', 'title' => __('সদস্য রিপোর্ট'),
                'filters' => ['member_status', 'mouza', 'q'],
                'columns' => [['member_no', __('সদস্য নং')], ['name', __('নাম')], ['father_name', __('পিতার নাম')], ['village', __('গ্রাম')],
                    ['mobile', __('মোবাইল')], ['admitted_on', __('ভর্তির তারিখ'), 'date'], ['status', __('অবস্থা')],
                    ['savings', __('সঞ্চয় স্থিতি'), 'money', true], ['share', __('শেয়ার স্থিতি'), 'money', true]],
                'rows' => function ($f) use ($search) {
                    $bal = fn ($kind) => DB::table('member_accounts')->whereColumn('member_accounts.member_id', 'members.id')->where('kind', $kind)->selectRaw('coalesce(sum(balance),0)');
                    $q = DB::table('members')->join('farmers', 'farmers.id', '=', 'members.farmer_id')->leftJoin('villages', 'villages.id', '=', 'farmers.village_id')
                        ->when($f['status'], fn ($q, $v) => $q->where('members.status', $v))
                        ->when($f['mouza_id'], fn ($q, $v) => $q->where('farmers.mouza_id', $v))
                        ->select('members.*', 'farmers.name_bn', 'farmers.name_en', 'farmers.father_name', 'farmers.mobile', 'villages.name_bn as village_bn', 'villages.name_en as village_en')
                        ->selectSub($bal('savings'), 'savings')->selectSub($bal('share'), 'share');
                    $search($q, $f);
                    $st = ['active' => 'সক্রিয়', 'inactive' => 'নিষ্ক্রিয়', 'cancelled' => 'বাতিল'];

                    return $q->orderBy('members.member_no')->limit(self::MAX_ROWS + 1)->get()->map(fn ($r) => [
                        'member_no' => $r->member_no, 'name' => $this->nm($r), 'father_name' => $r->father_name,
                        'village' => $this->nm($r, 'village_bn', 'village_en'), 'mobile' => $r->mobile, 'admitted_on' => $r->admitted_on,
                        'status' => $this->lbl($st, $r->status), 'savings' => (float) $r->savings, 'share' => (float) $r->share,
                    ]);
                },
            ],
            'member_history' => [
                'categories' => ['farmer'], 'perm' => 'member.view', 'title' => __('সদস্যপদ ইতিহাস'),
                'filters' => ['period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['member_no', __('সদস্য নং')], ['name', __('নাম')], ['action', __('কার্যক্রম')],
                    ['change', __('অবস্থার পরিবর্তন')], ['reason', __('কারণ')], ['resolution_no', __('রেজুলেশন নং')]],
                'rows' => function ($f) {
                    $st = ['active' => 'সক্রিয়', 'inactive' => 'নিষ্ক্রিয়', 'cancelled' => 'বাতিল'];
                    $act = ['deactivate' => 'সদস্য নিষ্ক্রিয়করণ', 'activate' => 'সদস্য সক্রিয়করণ', 'cancel' => 'সদস্যপদ বাতিল', 'reactivate' => 'সদস্যপদ পুনর্বহাল', 'admit' => 'সদস্যপদ অনুমোদন'];

                    return DB::table('membership_status_history as h')->join('members', 'members.id', '=', 'h.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
                        ->whereBetween('h.effective_date', [$f['from'], $f['to']])->orderBy('h.effective_date')->orderBy('h.id')
                        ->limit(self::MAX_ROWS + 1)->get(['h.*', 'members.member_no', 'farmers.name_bn', 'farmers.name_en'])
                        ->map(fn ($r) => [
                            'date' => $r->effective_date, 'member_no' => $r->member_no, 'name' => $this->nm($r), 'action' => $this->lbl($act, $r->action),
                            'change' => $this->lbl($st, $r->from_status).' → '.$this->lbl($st, $r->to_status), 'reason' => $r->reason, 'resolution_no' => $r->resolution_no,
                        ]);
                },
            ],
            'households' => [
                'categories' => ['farmer'], 'perm' => 'farmer.view', 'title' => __('খানা রিপোর্ট'),
                'filters' => [],
                'columns' => [['code', __('খানা কোড')], ['village', __('গ্রাম')], ['head', __('খানা প্রধান')], ['farmers', __('কৃষক'), 'number', true], ['members', __('সদস্য'), 'number', true]],
                'rows' => fn () => DB::table('households')->leftJoin('villages', 'villages.id', '=', 'households.village_id')->leftJoin('farmers as h', 'h.id', '=', 'households.head_farmer_id')
                    ->select('households.code', 'villages.name_bn as village_bn', 'villages.name_en as village_en', 'h.name_bn', 'h.name_en')
                    ->selectSub(DB::table('farmers')->whereColumn('farmers.household_id', 'households.id')->whereNull('farmers.deleted_at')->whereNull('farmers.merged_into_id')->selectRaw('count(*)'), 'farmers')
                    ->selectSub(DB::table('farmers')->join('members', 'members.farmer_id', '=', 'farmers.id')->whereColumn('farmers.household_id', 'households.id')->where('members.status', 'active')->selectRaw('count(*)'), 'members')
                    ->orderBy('households.code')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['code' => $r->code, 'village' => $this->nm($r, 'village_bn', 'village_en'), 'head' => $this->nm($r), 'farmers' => (int) $r->farmers, 'members' => (int) $r->members]),
            ],
            'voters' => [
                'categories' => ['farmer'], 'perm' => 'member.view', 'title' => __('ভোটার রিপোর্ট'),
                'filters' => ['voter_list'],
                'columns' => [['serial', __('ক্রম'), 'number'], ['member_no', __('সদস্য নং')], ['name', __('নাম')], ['father_name', __('পিতার নাম')],
                    ['village', __('গ্রাম')], ['eligible', __('যোগ্যতা')], ['reason', __('কারণ')]],
                'rows' => function ($f) {
                    $listId = $f['voter_list_id'] ?? DB::table('voter_lists')->max('id');

                    return DB::table('voter_list_items')->where('voter_list_id', $listId)->orderByDesc('eligible')->orderBy('serial')->orderBy('member_no')
                        ->limit(self::MAX_ROWS + 1)->get()->map(fn ($r) => [
                            'serial' => $r->serial, 'member_no' => $r->member_no, 'name' => $r->name, 'father_name' => $r->father_name, 'village' => $r->village,
                            'eligible' => $r->eligible ? __('ভোটার') : __('অযোগ্য'), 'reason' => $r->reason,
                        ]);
                },
            ],
            'voter_lists' => [
                'categories' => ['farmer'], 'perm' => 'member.view', 'title' => __('ভোটার তালিকার ইতিহাস'),
                'filters' => [],
                'columns' => [['title', __('শিরোনাম')], ['cutoff', __('কাট-অফ তারিখ'), 'date'], ['eligible', __('ভোটার'), 'number'], ['ineligible', __('অযোগ্য'), 'number'],
                    ['total', __('মোট সদস্য'), 'number'], ['created_by', __('প্রস্তুতকারী')], ['created_at', __('প্রস্তুতের সময়')]],
                'rows' => fn () => DB::table('voter_lists')->leftJoin('users', 'users.id', '=', 'voter_lists.created_by')->orderByDesc('voter_lists.cutoff_date')->orderByDesc('voter_lists.id')
                    ->get(['voter_lists.*', 'users.name_bn', 'users.name_en'])
                    ->map(fn ($r) => ['title' => $r->title, 'cutoff' => $r->cutoff_date, 'eligible' => (int) $r->eligible_count, 'ineligible' => (int) $r->ineligible_count,
                        'total' => (int) $r->eligible_count + (int) $r->ineligible_count, 'created_by' => $this->nm($r), 'created_at' => $r->created_at]),
            ],
            'voter_changes' => [
                'categories' => ['farmer', 'audit'], 'perm' => 'member.view', 'title' => __('ভোটার অডিট (আগের তালিকার সাথে তুলনা)'),
                'filters' => ['voter_list'],
                'columns' => [['member_no', __('সদস্য নং')], ['name', __('নাম')], ['village', __('গ্রাম')], ['before', __('আগের তালিকায়')], ['now', __('এই তালিকায়')],
                    ['change', __('পরিবর্তন')], ['reason', __('কারণ')]],
                'rows' => function ($f) {
                    $list = $f['voter_list_id'] ? DB::table('voter_lists')->find($f['voter_list_id']) : DB::table('voter_lists')->orderByDesc('id')->first();
                    if (! $list) {
                        return collect();
                    }
                    $prev = DB::table('voter_lists')->where('id', '<', $list->id)->orderByDesc('id')->first();
                    $now = DB::table('voter_list_items')->where('voter_list_id', $list->id)->get()->keyBy('member_id');
                    $before = $prev ? DB::table('voter_list_items')->where('voter_list_id', $prev->id)->get()->keyBy('member_id') : collect();
                    $state = fn ($i) => $i === null ? __('ছিল না') : ($i->eligible ? __('ভোটার') : __('অযোগ্য'));
                    $rows = collect();
                    foreach ($now->keys()->merge($before->keys())->unique() as $memberId) {
                        $a = $before[$memberId] ?? null;
                        $b = $now[$memberId] ?? null;
                        if ($prev && $a && $b && (bool) $a->eligible === (bool) $b->eligible) {
                            continue;
                        }
                        if (! $prev && $b && $b->eligible) {
                            continue; // first list: only the ineligible need explaining
                        }
                        $change = match (true) {
                            $b === null => __('তালিকা থেকে বাদ'),
                            $a === null && $prev !== null => $b->eligible ? __('নতুন ভোটার') : __('নতুন, অযোগ্য'),
                            (bool) $b->eligible => __('যোগ্যতা ফিরে পেয়েছে'),
                            default => __('যোগ্যতা হারিয়েছে'),
                        };
                        $i = $b ?? $a;
                        $rows->push(['member_no' => $i->member_no, 'name' => $i->name, 'village' => $i->village, 'before' => $prev ? $state($a) : '—',
                            'now' => $state($b), 'change' => $change, 'reason' => $b?->reason]);
                    }

                    return ['rows' => $rows->sortBy('member_no')->values(), 'summary' => [
                        ['label' => __('এই তালিকা'), 'value' => $list->title],
                        ['label' => __('তুলনা করা হয়েছে'), 'value' => $prev?->title ?? __('আগের কোনো তালিকা নেই')],
                    ]];
                },
            ],
        ];
    }

    private function landReports(): array
    {
        $landCols = [['land_code', __('জমি কোড')], ['mouza', __('মৌজা')], ['khatian_no', __('খতিয়ান')], ['dag_no', __('দাগ')],
            ['area', __('পরিমাণ (শতক)'), 'decimal', true], ['land_type', __('জমির ধরন')], ['irrigation_type', __('সেচের ধরন')], ['status', __('অবস্থা')],
            ['owners', __('মালিক')], ['cultivator', __('চাষি')]];

        return [
            'lands' => [
                'categories' => ['land'], 'perm' => 'land.view', 'title' => __('জমি রিপোর্ট'),
                'filters' => ['mouza', 'land_type', 'land_status'], 'columns' => $landCols,
                'rows' => function ($f) {
                    $rows = DB::table('lands')->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')->leftJoin('land_types', 'land_types.id', '=', 'lands.land_type_id')
                        ->leftJoin('irrigation_types', 'irrigation_types.id', '=', 'lands.irrigation_type_id')->whereNull('lands.deleted_at')
                        ->when($f['mouza_id'], fn ($q, $v) => $q->where('lands.mouza_id', $v))
                        ->when($f['land_type_id'], fn ($q, $v) => $q->where('lands.land_type_id', $v))
                        ->when($f['status'], fn ($q, $v) => $q->where('lands.status', $v))
                        ->orderBy('lands.land_code')->limit(self::MAX_ROWS + 1)
                        ->get(['lands.*', 'mouzas.name_bn as mouza_bn', 'mouzas.name_en as mouza_en', 'land_types.name_bn as type_bn', 'irrigation_types.name_bn as irr_bn']);
                    $parties = $this->partiesByLand($rows->pluck('id')->all());

                    return $rows->map(fn ($r) => [
                        'land_code' => $r->land_code, 'mouza' => $this->nm($r, 'mouza_bn', 'mouza_en'), 'khatian_no' => $r->khatian_no, 'dag_no' => $r->dag_no,
                        'area' => (float) $r->area_decimal, 'land_type' => Tr::label($r->type_bn), 'irrigation_type' => Tr::label($r->irr_bn),
                        'status' => $this->lbl(Land::STATUSES, $r->status), 'owners' => $parties[$r->id]['owners'], 'cultivator' => $parties[$r->id]['cultivator'],
                    ]);
                },
            ],
            'land_by_mouza' => [
                'categories' => ['land'], 'perm' => 'land.view', 'title' => __('মৌজাভিত্তিক জমি'),
                'filters' => [],
                'columns' => [['mouza', __('মৌজা')], ['jl_no', __('জে.এল নং')], ['lands', __('জমি'), 'number', true], ['area', __('মোট পরিমাণ (শতক)'), 'decimal', true],
                    ['cultivated', __('চাষাধীন (শতক)'), 'decimal', true], ['borga', __('বর্গা/লিজ জমি'), 'number', true]],
                'rows' => fn () => DB::table('mouzas')->join('lands', 'lands.mouza_id', '=', 'mouzas.id')->whereNull('lands.deleted_at')
                    ->groupBy('mouzas.id', 'mouzas.name_bn', 'mouzas.name_en', 'mouzas.jl_no')->orderBy('mouzas.name_bn')
                    ->selectRaw("mouzas.name_bn, mouzas.name_en, mouzas.jl_no, count(*) as lands, sum(lands.area_decimal) as area,
                        sum(case when lands.status = 'cultivated' then lands.area_decimal else 0 end) as cultivated")
                    ->selectSub(DB::table('land_cultivations')->join('lands as l2', 'l2.id', '=', 'land_cultivations.land_id')->whereColumn('l2.mouza_id', 'mouzas.id')
                        ->whereNull('land_cultivations.end_date')->whereIn('land_cultivations.type', ['borga', 'lease'])->selectRaw('count(*)'), 'borga')
                    ->get()->map(fn ($r) => ['mouza' => $this->nm($r), 'jl_no' => $r->jl_no, 'lands' => (int) $r->lands, 'area' => (float) $r->area,
                        'cultivated' => (float) $r->cultivated, 'borga' => (int) $r->borga]),
            ],
            'land_by_type' => [
                'categories' => ['land'], 'perm' => 'land.view', 'title' => __('ধরনভিত্তিক জমি'),
                'filters' => ['mouza'],
                'columns' => [['land_type', __('জমির ধরন')], ['lands', __('জমি'), 'number', true], ['area', __('মোট পরিমাণ (শতক)'), 'decimal', true]],
                'rows' => fn ($f) => DB::table('lands')->leftJoin('land_types', 'land_types.id', '=', 'lands.land_type_id')->whereNull('lands.deleted_at')
                    ->when($f['mouza_id'], fn ($q, $v) => $q->where('lands.mouza_id', $v))
                    ->groupBy('land_types.id', 'land_types.name_bn')->orderBy('land_types.name_bn')
                    ->selectRaw('land_types.name_bn, count(*) as lands, sum(lands.area_decimal) as area')->get()
                    ->map(fn ($r) => ['land_type' => $r->name_bn ? Tr::label($r->name_bn) : __('ধরন নেই'), 'lands' => (int) $r->lands, 'area' => (float) $r->area]),
            ],
            'land_owners' => [
                'categories' => ['land'], 'perm' => 'land.view', 'title' => __('মালিক রিপোর্ট'),
                'filters' => ['mouza', 'q'],
                'columns' => [['land_code', __('জমি কোড')], ['mouza', __('মৌজা')], ['dag_no', __('দাগ')], ['area', __('পরিমাণ (শতক)'), 'decimal'],
                    ['farmer_code', __('কৃষক আইডি')], ['owner', __('মালিক')], ['share', __('অংশ (%)'), 'decimal'], ['owned_area', __('মালিকানা (শতক)'), 'decimal', true], ['since', __('শুরু'), 'date']],
                'rows' => fn ($f) => $this->partyRows('land_owners', $f)->map(fn ($r) => [
                    'land_code' => $r->land_code, 'mouza' => $this->nm($r, 'mouza_bn', 'mouza_en'), 'dag_no' => $r->dag_no, 'area' => (float) $r->area_decimal,
                    'farmer_code' => $r->farmer_code, 'owner' => $this->farmerName($r), 'share' => (float) $r->share_percent,
                    'owned_area' => round((float) $r->area_decimal * (float) $r->share_percent / 100, 2), 'since' => $r->start_date,
                ]),
            ],
            'land_cultivators' => [
                'categories' => ['land'], 'perm' => 'land.view', 'title' => __('চাষি রিপোর্ট'),
                'filters' => ['mouza', 'cultivation_type', 'q'],
                'columns' => [['land_code', __('জমি কোড')], ['mouza', __('মৌজা')], ['dag_no', __('দাগ')], ['area', __('পরিমাণ (শতক)'), 'decimal', true],
                    ['farmer_code', __('কৃষক আইডি')], ['cultivator', __('চাষি')], ['type', __('চাষের ধরন')], ['owners', __('মালিক')], ['terms', __('শর্ত')], ['since', __('শুরু'), 'date']],
                'rows' => fn ($f) => $this->cultivationRows($f, null),
            ],
            'borga' => [
                'categories' => ['land'], 'perm' => 'land.view', 'title' => __('বর্গা/লিজ চাষ রিপোর্ট'),
                'filters' => ['mouza', 'q'],
                'columns' => [['land_code', __('জমি কোড')], ['mouza', __('মৌজা')], ['dag_no', __('দাগ')], ['area', __('পরিমাণ (শতক)'), 'decimal', true],
                    ['farmer_code', __('কৃষক আইডি')], ['cultivator', __('চাষি')], ['type', __('চাষের ধরন')], ['owners', __('মালিক')], ['terms', __('শর্ত')], ['since', __('শুরু'), 'date']],
                'rows' => fn ($f) => $this->cultivationRows($f, ['borga', 'lease']),
            ],
            'land_history' => [
                'categories' => ['land'], 'perm' => 'land.view', 'title' => __('জমি হস্তান্তর ও চাষ পরিবর্তন'),
                'filters' => ['period', 'mouza'],
                'columns' => [['date', __('তারিখ'), 'date'], ['land_code', __('জমি কোড')], ['mouza', __('মৌজা')], ['dag_no', __('দাগ')], ['event', __('ঘটনা')],
                    ['farmer', __('কৃষক')], ['detail', __('বিস্তারিত')]],
                'rows' => fn ($f) => $this->landEvents($f['from'], $f['to'], $f['mouza_id'] ?? null),
            ],
        ];
    }

    /** Irrigation type × land type grid of the approved rate in force for a season. */
    private function rateMatrix(): array
    {
        $landTypes = DB::table('land_types')->orderBy('sort_order')->orderBy('id')->get(['id', 'name_bn']);
        $columns = [['irrigation_type', __('সেচের ধরন')], ['all', __('সব ধরনের জমি'), 'money']];
        foreach ($landTypes as $lt) {
            $columns[] = ['lt_'.$lt->id, Tr::label($lt->name_bn), 'money'];
        }

        return [
            'categories' => ['irrigation'], 'perm' => 'irrigation.view', 'title' => __('ক্যাটাগরিভিত্তিক রেট (প্রতি শতক)'),
            'filters' => ['season'], 'columns' => $columns,
            'rows' => function ($f) use ($landTypes) {
                $season = $f['season_id'] ? Season::find($f['season_id']) : Season::orderByDesc('start_date')->first();
                if (! $season) {
                    return collect();
                }
                $rates = DB::table('irrigation_rates')->where('season_id', $season->id)->where('status', 'approved')
                    ->orderBy('effective_from')->orderBy('id')->get()
                    ->keyBy(fn ($r) => $r->irrigation_type_id.'-'.($r->land_type_id ?? 'all')); // later dates win
                $rows = DB::table('irrigation_types')->orderBy('sort_order')->orderBy('id')->get(['id', 'name_bn'])->map(function ($it) use ($rates, $landTypes) {
                    $row = ['irrigation_type' => Tr::label($it->name_bn), 'all' => isset($rates[$it->id.'-all']) ? (float) $rates[$it->id.'-all']->rate : null];
                    foreach ($landTypes as $lt) {
                        $row['lt_'.$lt->id] = isset($rates[$it->id.'-'.$lt->id]) ? (float) $rates[$it->id.'-'.$lt->id]->rate : $row['all'];
                    }

                    return $row;
                });

                return ['rows' => $rows, 'summary' => [['label' => __('মৌসুম'), 'value' => $season->name_bn],
                    ['label' => __('নোট'), 'value' => __('নির্দিষ্ট ধরনের রেট না থাকলে "সব ধরনের জমি"র রেট প্রযোজ্য; শুধু অনুমোদিত রেট দেখানো হলো।')]]];
            },
        ];
    }

    private function partyRows(string $table, array $f, ?array $types = null): Collection
    {
        return DB::table($table)->join('lands', 'lands.id', '=', "$table.land_id")->join('farmers', 'farmers.id', '=', "$table.farmer_id")
            ->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')->whereNull('lands.deleted_at')->whereNull("$table.end_date")
            ->when($types, fn ($q) => $q->whereIn("$table.type", $types))
            ->when($f['type'] ?? null, fn ($q, $v) => $q->where("$table.type", $v))
            ->when($f['mouza_id'] ?? null, fn ($q, $v) => $q->where('lands.mouza_id', $v))
            ->when($f['q'] ?? null, fn ($q, $s) => $q->where(fn ($w) => $w->where('farmers.name_bn', 'like', "%$s%")->orWhere('farmers.farmer_code', 'like', "%$s%")
                ->orWhere('lands.land_code', 'like', "%$s%")->orWhere('lands.dag_no', 'like', "%$s%")))
            ->orderBy('lands.land_code')->limit(self::MAX_ROWS + 1)
            ->get(["$table.*", 'lands.land_code', 'lands.dag_no', 'lands.area_decimal', 'mouzas.name_bn as mouza_bn', 'mouzas.name_en as mouza_en',
                'farmers.farmer_code', 'farmers.name_bn as farmer_name', 'farmers.name_en as farmer_name_en']);
    }

    private function cultivationRows(array $f, ?array $types): Collection
    {
        $rows = $this->partyRows('land_cultivations', $f, $types);
        $parties = $this->partiesByLand($rows->pluck('land_id')->unique()->all());

        return $rows->map(fn ($r) => [
            'land_code' => $r->land_code, 'mouza' => $this->nm($r, 'mouza_bn', 'mouza_en'), 'dag_no' => $r->dag_no, 'area' => (float) $r->area_decimal,
            'farmer_code' => $r->farmer_code, 'cultivator' => $this->farmerName($r), 'type' => $this->lbl(Land::CULTIVATION_TYPES, $r->type),
            'owners' => $parties[$r->land_id]['owners'] ?? '', 'terms' => $r->terms, 'since' => $r->start_date,
        ]);
    }

    /** Ownership and cultivation changes (start or end) inside the period. */
    public function landEvents(string $from, string $to, ?int $mouzaId = null): Collection
    {
        $events = collect();
        foreach (['land_owners' => ['মালিকানা শুরু', 'মালিকানা শেষ'], 'land_cultivations' => ['চাষ শুরু', 'চাষ শেষ']] as $table => [$start, $end]) {
            foreach (['start_date' => $start, 'end_date' => $end] as $col => $label) {
                DB::table($table)->join('lands', 'lands.id', '=', "$table.land_id")->join('farmers', 'farmers.id', '=', "$table.farmer_id")
                    ->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')
                    ->whereBetween("$table.$col", [$from, $to])->when($mouzaId, fn ($q, $v) => $q->where('lands.mouza_id', $v))
                    ->get(["$table.*", 'lands.land_code', 'lands.dag_no', 'mouzas.name_bn as mouza_bn', 'mouzas.name_en as mouza_en',
                        'farmers.farmer_code', 'farmers.name_bn as farmer_name', 'farmers.name_en as farmer_name_en'])
                    ->each(function ($r) use ($events, $table, $col, $label) {
                        $events->push([
                            'date' => $r->{$col}, 'land_code' => $r->land_code, 'mouza' => $this->nm($r, 'mouza_bn', 'mouza_en'), 'dag_no' => $r->dag_no,
                            'event' => __($label), 'farmer' => $this->farmerName($r).' ('.$r->farmer_code.')',
                            'detail' => $table === 'land_owners'
                                ? __('অংশ :p%', ['p' => rtrim(rtrim(number_format((float) $r->share_percent, 2), '0'), '.')])
                                : $this->lbl(Land::CULTIVATION_TYPES, $r->type),
                        ]);
                    });
            }
        }

        return $events->sortBy(fn ($e) => $e['date'].$e['land_code'])->values();
    }

    private function irrigationReports(): array
    {
        $invoiceBase = fn ($f) => DB::table('invoices')->join('farmers', 'farmers.id', '=', 'invoices.farmer_id')->join('lands', 'lands.id', '=', 'invoices.land_id')
            ->join('seasons', 'seasons.id', '=', 'invoices.season_id')
            ->when($f['season_id'] ?? null, fn ($q, $v) => $q->where('invoices.season_id', $v))
            ->when($f['mouza_id'] ?? null, fn ($q, $v) => $q->where('lands.mouza_id', $v));

        return [
            'invoices' => [
                'categories' => ['irrigation'], 'perm' => 'irrigation.view', 'title' => __('সেচ ইনভয়েস রিপোর্ট'),
                'filters' => ['season', 'mouza', 'invoice_status'],
                'columns' => [['invoice_no', __('ইনভয়েস নং')], ['date', __('তারিখ'), 'date'], ['season', __('মৌসুম')], ['land_code', __('জমি কোড')],
                    ['farmer', __('চাষি')], ['type', __('চাষের ধরন')], ['area', __('পরিমাণ (শতক)'), 'decimal', true], ['rate', __('রেট'), 'money'],
                    ['amount', __('বিলের পরিমাণ'), 'money', true], ['paid', __('আদায়'), 'money', true], ['due', __('বকেয়া'), 'money', true], ['status', __('অবস্থা')]],
                'rows' => fn ($f) => $invoiceBase($f)->when($f['status'], fn ($q, $v) => $q->where('invoices.status', $v))
                    ->orderBy('invoices.invoice_no')->limit(self::MAX_ROWS + 1)
                    ->get(['invoices.*', 'seasons.name_bn as season', 'lands.land_code', 'farmers.name_bn as farmer_name', 'farmers.name_en as farmer_name_en', 'farmers.farmer_code'])
                    ->map(fn ($r) => [
                        'invoice_no' => $r->invoice_no, 'date' => $r->invoice_date, 'season' => $r->season, 'land_code' => $r->land_code,
                        'farmer' => $this->farmerName($r).' ('.$r->farmer_code.')', 'type' => $this->lbl(Land::CULTIVATION_TYPES, $r->cultivation_type),
                        'area' => (float) $r->area_decimal, 'rate' => (float) $r->rate, 'amount' => $r->status === 'cancelled' ? 0.0 : (float) $r->amount,
                        'paid' => (float) $r->paid_amount, 'due' => $r->status === 'cancelled' ? 0.0 : round((float) $r->amount - (float) $r->paid_amount, 2),
                        'status' => $this->lbl(Invoice::STATUSES, $r->status),
                    ]),
            ],
            'irrigation_collection' => [
                'categories' => ['irrigation', 'collection'], 'perm' => ['irrigation.view', 'payment.view'], 'title' => __('সেচ আদায় রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['receipt_no', __('রশিদ নং')], ['payer', __('প্রদানকারী')], ['method', __('মাধ্যম')],
                    ['legacy_no', __('পুরোনো রশিদ নং')], ['amount', __('টাকা'), 'money', true]],
                'rows' => fn ($f) => DB::table('receipts')->where('module', 'irrigation')->where('status', '!=', 'cancelled')
                    ->whereBetween('date', [$f['from'], $f['to']])->orderBy('date')->orderBy('id')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['date' => $r->date, 'receipt_no' => $r->receipt_no, 'payer' => $r->payer_name, 'method' => $this->lbl(Receipt::METHODS, $r->method),
                        'legacy_no' => $r->legacy_no, 'amount' => (float) $r->amount]),
            ],
            'irrigation_due' => [
                'categories' => ['irrigation', 'due'], 'perm' => 'irrigation.view', 'title' => __('কৃষকভিত্তিক সেচ বকেয়া'),
                'filters' => ['season', 'mouza'],
                'columns' => [['farmer_code', __('কৃষক আইডি')], ['farmer', __('চাষি')], ['mobile', __('মোবাইল')], ['invoices', __('ইনভয়েস'), 'number', true],
                    ['amount', __('বিলের পরিমাণ'), 'money', true], ['paid', __('আদায়'), 'money', true], ['due', __('বকেয়া'), 'money', true], ['oldest_due', __('প্রথম শেষ তারিখ'), 'date']],
                'rows' => fn ($f) => $invoiceBase($f)->whereIn('invoices.status', ['unpaid', 'partial'])
                    ->groupBy('farmers.id', 'farmers.farmer_code', 'farmers.name_bn', 'farmers.name_en', 'farmers.mobile')
                    ->selectRaw('farmers.farmer_code, farmers.name_bn as farmer_name, farmers.name_en as farmer_name_en, farmers.mobile, count(*) as invoices,
                        sum(invoices.amount) as amount, sum(invoices.paid_amount) as paid, min(invoices.due_date) as oldest_due')
                    ->orderByRaw('sum(invoices.amount - invoices.paid_amount) desc')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['farmer_code' => $r->farmer_code, 'farmer' => $this->farmerName($r), 'mobile' => $r->mobile, 'invoices' => (int) $r->invoices,
                        'amount' => (float) $r->amount, 'paid' => (float) $r->paid, 'due' => round((float) $r->amount - (float) $r->paid, 2), 'oldest_due' => $r->oldest_due]),
            ],
            'season_summary' => [
                'categories' => ['irrigation'], 'perm' => 'irrigation.view', 'title' => __('মৌসুমভিত্তিক সেচ সারসংক্ষেপ'),
                'filters' => [],
                'columns' => [['season', __('মৌসুম')], ['status', __('অবস্থা')], ['invoices', __('ইনভয়েস'), 'number', true], ['area', __('পরিমাণ (শতক)'), 'decimal', true],
                    ['billed', __('বিলের পরিমাণ'), 'money', true], ['collected', __('আদায়'), 'money', true], ['due', __('বকেয়া'), 'money', true], ['rate', __('আদায়ের হার (%)'), 'decimal']],
                'rows' => fn () => DB::table('seasons')->leftJoin('invoices', fn ($j) => $j->on('invoices.season_id', '=', 'seasons.id')->where('invoices.status', '!=', 'cancelled'))
                    ->groupBy('seasons.id', 'seasons.name_bn', 'seasons.status', 'seasons.start_date')->orderByDesc('seasons.start_date')
                    ->selectRaw('seasons.name_bn, seasons.status, count(invoices.id) as invoices, coalesce(sum(invoices.area_decimal),0) as area,
                        coalesce(sum(invoices.amount),0) as billed, coalesce(sum(invoices.paid_amount),0) as collected')->get()
                    ->map(fn ($r) => ['season' => $r->name_bn, 'status' => $this->lbl(Season::STATUSES, $r->status), 'invoices' => (int) $r->invoices, 'area' => (float) $r->area,
                        'billed' => (float) $r->billed, 'collected' => (float) $r->collected, 'due' => round((float) $r->billed - (float) $r->collected, 2),
                        'rate' => (float) $r->billed > 0 ? round((float) $r->collected * 100 / (float) $r->billed, 1) : 0.0]),
            ],
            'irrigation_rates' => [
                'categories' => ['irrigation'], 'perm' => 'irrigation.view', 'title' => __('সেচ রেট রিপোর্ট'),
                'filters' => ['season'],
                'columns' => [['season', __('মৌসুম')], ['irrigation_type', __('সেচের ধরন')], ['land_type', __('জমির ধরন')], ['rate', __('রেট (প্রতি শতক)'), 'money'],
                    ['effective_from', __('কার্যকর তারিখ'), 'date'], ['status', __('অবস্থা')]],
                'rows' => fn ($f) => DB::table('irrigation_rates as r')->join('seasons', 'seasons.id', '=', 'r.season_id')->join('irrigation_types as it', 'it.id', '=', 'r.irrigation_type_id')
                    ->leftJoin('land_types as lt', 'lt.id', '=', 'r.land_type_id')->when($f['season_id'], fn ($q, $v) => $q->where('r.season_id', $v))
                    ->orderByDesc('seasons.start_date')->orderBy('it.sort_order')->orderBy('r.effective_from')
                    ->get(['r.*', 'seasons.name_bn as season', 'it.name_bn as irr', 'lt.name_bn as lt'])
                    ->map(fn ($r) => ['season' => $r->season, 'irrigation_type' => Tr::label($r->irr), 'land_type' => $r->lt ? Tr::label($r->lt) : __('সব ধরনের জমি'),
                        'rate' => (float) $r->rate, 'effective_from' => $r->effective_from, 'status' => $this->lbl(IrrigationRate::STATUSES, $r->status)]),
            ],
            'rate_matrix' => $this->rateMatrix(),
            'cultivation_history' => [
                'categories' => ['irrigation', 'land'], 'perm' => 'irrigation.view', 'title' => __('চাষের ইতিহাস (মৌসুমভিত্তিক)'),
                'filters' => ['mouza', 'q'],
                'columns' => [['season', __('মৌসুম')], ['land_code', __('জমি কোড')], ['dag_no', __('দাগ')], ['farmer', __('চাষি')], ['type', __('চাষের ধরন')],
                    ['area', __('পরিমাণ (শতক)'), 'decimal', true], ['amount', __('বিলের পরিমাণ'), 'money', true], ['status', __('অবস্থা')]],
                'rows' => fn ($f) => $invoiceBase($f)
                    ->when($f['q'], fn ($q, $s) => $q->where(fn ($w) => $w->where('lands.land_code', 'like', "%$s%")->orWhere('lands.dag_no', 'like', "%$s%")
                        ->orWhere('farmers.farmer_code', 'like', "%$s%")->orWhere('farmers.name_bn', 'like', "%$s%")))
                    ->orderBy('lands.land_code')->orderByDesc('seasons.start_date')->limit(self::MAX_ROWS + 1)
                    ->get(['invoices.*', 'seasons.name_bn as season', 'lands.land_code', 'lands.dag_no', 'farmers.name_bn as farmer_name', 'farmers.name_en as farmer_name_en', 'farmers.farmer_code'])
                    ->map(fn ($r) => ['season' => $r->season, 'land_code' => $r->land_code, 'dag_no' => $r->dag_no, 'farmer' => $this->farmerName($r).' ('.$r->farmer_code.')',
                        'type' => $this->lbl(Land::CULTIVATION_TYPES, $r->cultivation_type), 'area' => (float) $r->area_decimal,
                        'amount' => $r->status === 'cancelled' ? 0.0 : (float) $r->amount, 'status' => $this->lbl(Invoice::STATUSES, $r->status)]),
            ],
        ];
    }

    private function waterReports(): array
    {
        $who = fn ($r) => (app()->getLocale() === 'en' && ! empty($r->name_en) ? $r->name_en : $r->name_bn);
        $type = fn ($r) => (app()->getLocale() === 'en' && ! empty($r->type_en) ? $r->type_en : $r->type_bn);
        $connections = fn ($f) => DB::table('water_connections as c')->join('water_connection_types as t', 't.id', '=', 'c.type_id')
            ->leftJoin('villages as v', 'v.id', '=', 'c.village_id')
            ->when($f['type_id'] ?? null, fn ($q, $v) => $q->where('c.type_id', $v));

        return [
            'water_connections' => [
                'categories' => ['water'], 'perm' => 'water.view', 'title' => __('পানির সংযোগের তালিকা'),
                'filters' => ['water_type', 'water_status'],
                'columns' => [['connection_no', __('সংযোগ নং')], ['customer', __('গ্রাহক')], ['father', __('পিতা/স্বামী')], ['mobile', __('মোবাইল')], ['village', __('গ্রাম')],
                    ['type', __('ধরন')], ['fee', __('মাসিক ফি'), 'money', true], ['connected_on', __('সংযোগের তারিখ'), 'date'], ['status', __('অবস্থা')]],
                'rows' => fn ($f) => $connections($f)->when($f['status'], fn ($q, $v) => $q->where('c.status', $v))
                    ->orderBy('c.connection_no')->limit(self::MAX_ROWS + 1)
                    ->get(['c.*', 't.name_bn as type_bn', 't.name_en as type_en', 't.monthly_fee as type_fee', 'v.name_bn as village'])
                    ->map(fn ($r) => ['connection_no' => $r->connection_no, 'customer' => $who($r), 'father' => $r->father_name, 'mobile' => $r->mobile, 'village' => $r->village,
                        'type' => $type($r), 'fee' => (float) ($r->monthly_fee ?? $r->type_fee), 'connected_on' => $r->connected_on,
                        'status' => $this->lbl(WaterConnection::STATUSES, $r->status)]),
            ],
            'water_billing' => [
                'categories' => ['water'], 'perm' => 'water.view', 'title' => __('পানির বিলিং রেজিস্টার'),
                'filters' => ['period', 'water_type', 'water_bill_status'],
                'columns' => [['bill_no', __('বিল নং')], ['for', __('কিসের বিল')], ['date', __('বিলের তারিখ'), 'date'], ['connection_no', __('সংযোগ নং')], ['customer', __('গ্রাহক')],
                    ['type', __('ধরন')], ['amount', __('বিল'), 'money', true], ['penalty', __('জরিমানা'), 'money', true], ['paid', __('আদায়'), 'money', true],
                    ['due', __('বকেয়া'), 'money', true], ['status', __('অবস্থা')]],
                'rows' => fn ($f) => DB::table('water_bills as b')->join('water_connections as c', 'c.id', '=', 'b.connection_id')
                    ->join('water_connection_types as t', 't.id', '=', 'c.type_id')
                    ->whereBetween('b.bill_date', [$f['from'], $f['to']])
                    ->when($f['type_id'], fn ($q, $v) => $q->where('c.type_id', $v))->when($f['status'], fn ($q, $v) => $q->where('b.status', $v))
                    ->orderBy('b.bill_no')->limit(self::MAX_ROWS + 1)
                    ->get(['b.*', 'c.connection_no', 'c.name_bn', 'c.name_en', 't.name_bn as type_bn', 't.name_en as type_en'])
                    ->map(fn ($r) => ['bill_no' => $r->bill_no,
                        'for' => $r->kind === 'monthly' ? WaterBill::periodLabel($r->period, app()->getLocale()) : $this->lbl(WaterBill::KINDS, $r->kind),
                        'date' => $r->bill_date, 'connection_no' => $r->connection_no, 'customer' => $who($r), 'type' => $type($r),
                        'amount' => $r->status === 'cancelled' ? 0.0 : (float) $r->amount, 'penalty' => $r->status === 'cancelled' ? 0.0 : (float) $r->penalty,
                        'paid' => (float) $r->paid_amount,
                        'due' => $r->status === 'cancelled' ? 0.0 : round((float) $r->amount + (float) $r->penalty - (float) $r->paid_amount, 2),
                        'status' => $this->lbl(WaterBill::STATUSES, $r->status)]),
            ],
            'water_collection' => [
                'categories' => ['water', 'collection'], 'perm' => 'water.view', 'title' => __('পানির বিল আদায় রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['receipt_no', __('রশিদ নং')], ['payer', __('প্রদানকারী')], ['method', __('মাধ্যম')], ['amount', __('টাকা'), 'money', true]],
                'rows' => fn ($f) => DB::table('receipts')->where('module', 'water')->where('status', '!=', 'cancelled')
                    ->whereBetween('date', [$f['from'], $f['to']])->orderBy('date')->orderBy('id')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['date' => $r->date, 'receipt_no' => $r->receipt_no, 'payer' => $r->payer_name, 'method' => $this->lbl(Receipt::METHODS, $r->method),
                        'amount' => (float) $r->amount]),
            ],
            'water_due' => [
                'categories' => ['water', 'due'], 'perm' => 'water.view', 'title' => __('সংযোগভিত্তিক পানির বিল বকেয়া'),
                'filters' => ['water_type'],
                'columns' => [['connection_no', __('সংযোগ নং')], ['customer', __('গ্রাহক')], ['mobile', __('মোবাইল')], ['village', __('গ্রাম')], ['type', __('ধরন')],
                    ['bills', __('বকেয়া বিল'), 'number', true], ['oldest', __('সবচেয়ে পুরনো বিল'), 'date'], ['due', __('বকেয়া'), 'money', true]],
                'rows' => fn ($f) => $connections($f)->join('water_bills as b', 'b.connection_id', '=', 'c.id')->whereIn('b.status', ['unpaid', 'partial'])
                    ->groupBy('c.id', 'c.connection_no', 'c.name_bn', 'c.name_en', 'c.mobile', 'v.name_bn', 't.name_bn', 't.name_en')
                    ->selectRaw('c.connection_no, c.name_bn, c.name_en, c.mobile, v.name_bn as village, t.name_bn as type_bn, t.name_en as type_en,
                        count(b.id) as bills, min(b.bill_date) as oldest, sum(b.amount + b.penalty - b.paid_amount) as due')
                    ->orderByRaw('sum(b.amount + b.penalty - b.paid_amount) desc')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['connection_no' => $r->connection_no, 'customer' => $who($r), 'mobile' => $r->mobile, 'village' => $r->village, 'type' => $type($r),
                        'bills' => (int) $r->bills, 'oldest' => $r->oldest, 'due' => round((float) $r->due, 2)]),
            ],
            'water_monthly' => [
                'categories' => ['water'], 'perm' => 'water.view', 'title' => __('মাসভিত্তিক পানির বিল সারসংক্ষেপ'),
                'filters' => [],
                'columns' => [['month', __('মাস')], ['bills', __('বিল'), 'number', true], ['billed', __('বিলের টাকা'), 'money', true], ['penalty', __('জরিমানা'), 'money', true],
                    ['collected', __('আদায়'), 'money', true], ['due', __('বকেয়া'), 'money', true], ['rate', __('আদায়ের হার (%)'), 'decimal']],
                'rows' => fn () => DB::table('water_bills')->where('kind', 'monthly')->where('status', '!=', 'cancelled')
                    ->groupBy('period')->orderByDesc('period')
                    ->selectRaw('period, count(*) as bills, sum(amount) as billed, sum(penalty) as penalty, sum(paid_amount) as collected')->get()
                    ->map(fn ($r) => ['month' => WaterBill::periodLabel($r->period, app()->getLocale()), 'bills' => (int) $r->bills, 'billed' => (float) $r->billed,
                        'penalty' => (float) $r->penalty, 'collected' => (float) $r->collected,
                        'due' => round((float) $r->billed + (float) $r->penalty - (float) $r->collected, 2),
                        'rate' => (float) $r->billed + (float) $r->penalty > 0 ? round((float) $r->collected * 100 / ((float) $r->billed + (float) $r->penalty), 1) : 0.0]),
            ],
        ];
    }

    private function savingsReports(): array
    {
        $types = MemberTransaction::TYPES;

        return [
            'savings_collection' => [
                'categories' => ['savings', 'collection'], 'perm' => ['savings.view', 'share.view'], 'title' => __('সঞ্চয়/শেয়ার আদায় রিপোর্ট'),
                'filters' => ['period', 'fund_kind'],
                'columns' => [['date', __('তারিখ'), 'date'], ['txn_no', __('লেনদেন নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')],
                    ['type', __('ধরন')], ['method', __('মাধ্যম')], ['amount', __('টাকা'), 'money', true]],
                'rows' => fn ($f) => DB::table('member_transactions as t')->join('member_accounts as a', 'a.id', '=', 't.member_account_id')
                    ->join('members', 'members.id', '=', 'a.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
                    ->where('t.kind', $f['kind'] ?? 'savings')->where('t.status', 'posted')->where('t.direction', 'in')
                    ->whereIn('t.type', ['deposit', 'purchase'])->whereBetween('t.date', [$f['from'], $f['to']])
                    ->orderBy('t.date')->orderBy('t.id')->limit(self::MAX_ROWS + 1)->get(['t.*', 'members.member_no', 'farmers.name_bn', 'farmers.name_en'])
                    ->map(fn ($r) => ['date' => $r->date, 'txn_no' => $r->txn_no, 'member_no' => $r->member_no, 'name' => $this->nm($r),
                        'type' => $this->lbl($types[$r->kind] ?? [], $r->type), 'method' => $this->lbl(Receipt::METHODS, $r->method), 'amount' => (float) $r->amount]),
            ],
            'savings_statement' => [
                'categories' => ['savings'], 'perm' => ['savings.view', 'share.view'], 'title' => __('সদস্যের হিসাব বিবরণী'),
                'filters' => ['member_no', 'fund_kind', 'period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['txn_no', __('লেনদেন নং')], ['type', __('ধরন')], ['remarks', __('বিবরণ')],
                    ['in', __('জমা'), 'money', true], ['out', __('খরচ'), 'money', true], ['balance', __('স্থিতি'), 'money']],
                'rows' => function ($f) use ($types) {
                    $this->needs($f);
                    $account = DB::table('member_accounts')->join('members', 'members.id', '=', 'member_accounts.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
                        ->where('members.member_no', $f['member_no'])->where('member_accounts.kind', $f['kind'] ?? 'savings')
                        ->first(['member_accounts.*', 'members.member_no', 'farmers.name_bn', 'farmers.name_en']);
                    if (! $account) {
                        throw ValidationException::withMessages(['member_no' => __('এই সদস্য নম্বরে কোনো হিসাব পাওয়া যায়নি।')]);
                    }
                    $txns = DB::table('member_transactions')->where('member_account_id', $account->id)->where('status', 'posted');
                    $opening = (float) (clone $txns)->where('date', '<', $f['from'])->selectRaw("coalesce(sum(case when direction = 'in' then amount else -amount end),0) as b")->value('b');
                    $running = $opening;
                    $rows = collect([['date' => $f['from'], 'txn_no' => '', 'type' => __('প্রারম্ভিক জের'), 'remarks' => '', 'in' => 0.0, 'out' => 0.0, 'balance' => round($opening, 2)]]);
                    (clone $txns)->whereBetween('date', [$f['from'], $f['to']])->orderBy('date')->orderBy('id')->get()->each(function ($t) use (&$running, $rows, $types) {
                        $running = round($running + ($t->direction === 'in' ? 1 : -1) * (float) $t->amount, 2);
                        $rows->push(['date' => $t->date, 'txn_no' => $t->txn_no, 'type' => $this->lbl($types[$t->kind] ?? [], $t->type), 'remarks' => $t->remarks,
                            'in' => $t->direction === 'in' ? (float) $t->amount : 0.0, 'out' => $t->direction === 'out' ? (float) $t->amount : 0.0, 'balance' => $running]);
                    });

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('হিসাব নং'), 'value' => $account->account_no],
                        ['label' => __('সদস্য'), 'value' => $account->member_no.' — '.$this->nm($account)],
                        ['label' => __('সমাপনী স্থিতি'), 'value' => $running, 'type' => 'money'],
                    ]];
                },
            ],
            'savings_balance' => [
                'categories' => ['savings'], 'perm' => ['savings.view', 'share.view'], 'title' => __('সঞ্চয়/শেয়ার স্থিতি রিপোর্ট'),
                'filters' => ['fund_kind', 'mouza'],
                'columns' => [['account_no', __('হিসাব নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')], ['village', __('গ্রাম')],
                    ['opened_on', __('খোলার তারিখ'), 'date'], ['status', __('অবস্থা')], ['balance', __('স্থিতি'), 'money', true]],
                'rows' => fn ($f) => DB::table('member_accounts as a')->join('members', 'members.id', '=', 'a.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
                    ->leftJoin('villages', 'villages.id', '=', 'farmers.village_id')->where('a.kind', $f['kind'] ?? 'savings')
                    ->when($f['mouza_id'], fn ($q, $v) => $q->where('farmers.mouza_id', $v))
                    ->orderBy('members.member_no')->limit(self::MAX_ROWS + 1)
                    ->get(['a.*', 'members.member_no', 'farmers.name_bn', 'farmers.name_en', 'villages.name_bn as village_bn', 'villages.name_en as village_en'])
                    ->map(fn ($r) => ['account_no' => $r->account_no, 'member_no' => $r->member_no, 'name' => $this->nm($r), 'village' => $this->nm($r, 'village_bn', 'village_en'),
                        'opened_on' => $r->opened_on, 'status' => $r->status === 'active' ? __('সক্রিয়') : __('বন্ধ'), 'balance' => (float) $r->balance]),
            ],
        ] + $this->savingsMenuReports();
    }

    /**
     * The savings menu's report pages: collection (savings + share), deposits,
     * withdrawals, balances as of a date, and share capital.
     */
    private function savingsMenuReports(): array
    {
        $txns = fn ($f) => DB::table('member_transactions as t')->join('member_accounts as a', 'a.id', '=', 't.member_account_id')
            ->join('members', 'members.id', '=', 'a.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
            ->leftJoin('users', 'users.id', '=', 't.created_by')
            ->when($f['mouza_id'] ?? null, fn ($q, $v) => $q->where('farmers.mouza_id', $v))
            ->whereBetween('t.date', [$f['from'], $f['to']]);
        $cols = ['t.*', 'a.account_no', 'members.member_no', 'farmers.name_bn', 'farmers.name_en', 'users.name_bn as by_bn', 'users.name_en as by_en'];
        $book = fn ($k) => $k === 'share' ? __('শেয়ার') : __('সঞ্চয়');
        // balance of every account at the end of a day, from its effective transactions
        $balances = fn ($f, string $kind) => DB::table('member_accounts as a')->join('members', 'members.id', '=', 'a.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
            ->leftJoin('villages', 'villages.id', '=', 'farmers.village_id')->where('a.kind', $kind)->where('a.opened_on', '<=', $f['as_of'])
            ->when($f['mouza_id'] ?? null, fn ($q, $v) => $q->where('farmers.mouza_id', $v))
            ->selectSub(DB::table('member_transactions as t')->whereColumn('t.member_account_id', 'a.id')->whereIn('t.status', ['posted', 'cancel_pending'])
                ->where('t.date', '<=', $f['as_of'])->selectRaw("coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end),0)"), 'bal')
            ->selectSub(DB::table('member_transactions as t')->whereColumn('t.member_account_id', 'a.id')->whereIn('t.status', ['posted', 'cancel_pending'])
                ->where('t.date', '<=', $f['as_of'])->where('t.direction', 'in')->selectRaw('max(t.date)'), 'last_in')
            ->addSelect(['a.account_no', 'a.opened_on', 'a.status', 'a.closed_on', 'members.member_no', 'farmers.name_bn', 'farmers.name_en', 'farmers.mobile',
                'villages.name_bn as village_bn', 'villages.name_en as village_en'])
            ->orderBy('members.member_no')->limit(self::MAX_ROWS + 1)->get();
        $open = fn ($r, $f) => $r->status !== 'closed' || ($r->closed_on && $r->closed_on > $f['as_of']);

        return [
            'sv_collection' => [
                'categories' => ['savings', 'collection'], 'perm' => ['savings.view', 'share.view'], 'title' => __('সঞ্চয় ও শেয়ার আদায় রিপোর্ট'),
                'filters' => ['period', 'mouza'],
                'columns' => [['date', __('তারিখ'), 'date'], ['txn_no', __('লেনদেন নং')], ['book', __('খাত')], ['member_no', __('সদস্য নং')], ['name', __('নাম')],
                    ['method', __('মাধ্যম')], ['by', __('আদায়কারী')], ['amount', __('টাকা'), 'money', true]],
                'rows' => function ($f) use ($txns, $cols, $book) {
                    $rows = $txns($f)->whereIn('t.status', ['posted', 'cancel_pending'])->whereIn('t.type', ['deposit', 'purchase'])
                        ->orderBy('t.date')->orderBy('t.id')->limit(self::MAX_ROWS + 1)->get($cols)
                        ->map(fn ($r) => ['date' => $r->date, 'txn_no' => $r->txn_no, 'book' => $book($r->kind), 'book_key' => $r->kind, 'member_no' => $r->member_no,
                            'name' => $this->nm($r), 'method' => $this->lbl(Receipt::METHODS, $r->method), 'by' => $this->nm($r, 'by_bn', 'by_en'), 'amount' => (float) $r->amount]);

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('মোট আদায়'), 'value' => round($rows->sum('amount'), 2), 'type' => 'money'],
                        ['label' => __('সঞ্চয় জমা'), 'value' => round($rows->where('book_key', 'savings')->sum('amount'), 2), 'type' => 'money'],
                        ['label' => __('শেয়ার আদায়'), 'value' => round($rows->where('book_key', 'share')->sum('amount'), 2), 'type' => 'money'],
                        ['label' => __('লেনদেন'), 'value' => $rows->count()],
                        ['label' => __('সদস্য'), 'value' => $rows->pluck('member_no')->unique()->count()],
                    ]];
                },
            ],
            'sv_deposit' => [
                'categories' => ['savings'], 'perm' => 'savings.view', 'title' => __('সঞ্চয় জমা রিপোর্ট'),
                'filters' => ['period', 'mouza'],
                'columns' => [['date', __('তারিখ'), 'date'], ['txn_no', __('জমা নং')], ['account_no', __('হিসাব নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')],
                    ['method', __('মাধ্যম')], ['by', __('আদায়কারী')], ['amount', __('টাকা'), 'money', true], ['balance', __('জমার পর জের'), 'money']],
                'rows' => function ($f) use ($txns, $cols) {
                    $rows = $txns($f)->where('t.kind', 'savings')->where('t.type', 'deposit')->whereIn('t.status', ['posted', 'cancel_pending'])
                        ->orderBy('t.date')->orderBy('t.id')->limit(self::MAX_ROWS + 1)->get($cols)
                        ->map(fn ($r) => ['date' => $r->date, 'txn_no' => $r->txn_no, 'account_no' => $r->account_no, 'member_no' => $r->member_no, 'name' => $this->nm($r),
                            'method' => $this->lbl(Receipt::METHODS, $r->method), 'by' => $this->nm($r, 'by_bn', 'by_en'), 'amount' => (float) $r->amount,
                            'balance' => $r->balance_after === null ? null : (float) $r->balance_after]);
                    $members = $rows->pluck('member_no')->unique()->count();

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('মোট জমা'), 'value' => round($rows->sum('amount'), 2), 'type' => 'money'],
                        ['label' => __('জমার সংখ্যা'), 'value' => $rows->count()],
                        ['label' => __('সদস্য'), 'value' => $members],
                        ['label' => __('সদস্যপ্রতি গড়'), 'value' => $members ? round($rows->sum('amount') / $members, 2) : 0, 'type' => 'money'],
                    ]];
                },
            ],
            'sv_withdrawal' => [
                'categories' => ['savings'], 'perm' => 'savings.view', 'title' => __('সঞ্চয় উত্তোলন রিপোর্ট'),
                'filters' => ['period', 'mouza', 'withdrawal_status'],
                'columns' => [['date', __('তারিখ'), 'date'], ['txn_no', __('উত্তোলন নং')], ['account_no', __('হিসাব নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')],
                    ['method', __('মাধ্যম')], ['by', __('এন্ট্রিকারী')], ['status', __('অবস্থা')], ['amount', __('টাকা'), 'money', true]],
                'rows' => function ($f) use ($txns, $cols) {
                    $statuses = MemberTransaction::STATUSES;
                    $rows = $txns($f)->where('t.kind', 'savings')->where('t.type', 'withdrawal')
                        ->when($f['status'] ?? null, fn ($q, $v) => $q->where('t.status', $v))
                        ->orderBy('t.date')->orderBy('t.id')->limit(self::MAX_ROWS + 1)->get($cols)
                        ->map(fn ($r) => ['date' => $r->date, 'txn_no' => $r->txn_no, 'account_no' => $r->account_no, 'member_no' => $r->member_no, 'name' => $this->nm($r),
                            'method' => $this->lbl(Receipt::METHODS, $r->method), 'by' => $this->nm($r, 'by_bn', 'by_en'), 'status' => $this->lbl($statuses, $r->status),
                            'status_key' => $r->status, 'amount' => (float) $r->amount]);
                    $sum = fn ($s) => round($rows->where('status_key', $s)->sum('amount'), 2);

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('অনুমোদিত উত্তোলন'), 'value' => round($sum('posted') + $sum('cancel_pending'), 2), 'type' => 'money'],
                        ['label' => __('অপেক্ষমাণ'), 'value' => $sum('pending'), 'type' => 'money'],
                        ['label' => __('প্রত্যাখ্যাত'), 'value' => $sum('rejected'), 'type' => 'money'],
                        ['label' => __('আবেদন'), 'value' => $rows->count()],
                    ]];
                },
            ],
            'sv_balance' => [
                'categories' => ['savings'], 'perm' => 'savings.view', 'title' => __('সঞ্চয় জের রিপোর্ট'),
                'filters' => ['as_of', 'mouza'],
                'columns' => [['account_no', __('হিসাব নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')], ['village', __('গ্রাম')], ['mobile', __('মোবাইল')],
                    ['opened_on', __('খোলার তারিখ'), 'date'], ['last_in', __('শেষ জমা'), 'date'], ['status', __('অবস্থা')], ['balance', __('জের'), 'money', true]],
                'rows' => function ($f) use ($balances, $open) {
                    $rows = $balances($f, 'savings')->map(fn ($r) => ['account_no' => $r->account_no, 'member_no' => $r->member_no, 'name' => $this->nm($r),
                        'village' => $this->nm($r, 'village_bn', 'village_en'), 'mobile' => $r->mobile, 'opened_on' => $r->opened_on, 'last_in' => $r->last_in,
                        'status' => $open($r, $f) ? __('সক্রিয়') : __('বন্ধ'), 'balance' => round((float) $r->bal, 2)]);

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('মোট জের'), 'value' => round($rows->sum('balance'), 2), 'type' => 'money'],
                        ['label' => __('হিসাব'), 'value' => $rows->count()],
                        ['label' => __('শূন্য জের'), 'value' => $rows->where('balance', 0)->count()],
                        ['label' => __('গড় জের'), 'value' => $rows->count() ? round($rows->sum('balance') / $rows->count(), 2) : 0, 'type' => 'money'],
                    ]];
                },
            ],
            'sv_share' => [
                'categories' => ['savings'], 'perm' => 'share.view', 'title' => __('শেয়ার মূলধন রিপোর্ট'),
                'filters' => ['as_of', 'mouza'],
                'columns' => [['account_no', __('হিসাব নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')], ['village', __('গ্রাম')],
                    ['last_in', __('শেষ ক্রয়'), 'date'], ['status', __('অবস্থা')], ['units', __('শেয়ার সংখ্যা'), 'number', true], ['balance', __('শেয়ার মূলধন'), 'money', true]],
                'rows' => function ($f) use ($balances, $open) {
                    $unit = (float) SettingService::get('share_unit_price', 10) ?: 10.0;
                    $rows = $balances($f, 'share')->map(fn ($r) => ['account_no' => $r->account_no, 'member_no' => $r->member_no, 'name' => $this->nm($r),
                        'village' => $this->nm($r, 'village_bn', 'village_en'), 'last_in' => $r->last_in, 'status' => $open($r, $f) ? __('সক্রিয়') : __('বন্ধ'),
                        'units' => (int) round((float) $r->bal / $unit), 'balance' => round((float) $r->bal, 2)]);
                    $total = round($rows->sum('balance'), 2);

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('মোট শেয়ার মূলধন'), 'value' => $total, 'type' => 'money'],
                        ['label' => __('মোট শেয়ার'), 'value' => $rows->sum('units')],
                        ['label' => __('প্রতি শেয়ারের দাম'), 'value' => $unit, 'type' => 'money'],
                        ['label' => __('শেয়ারধারী সদস্য'), 'value' => $rows->where('balance', '>', 0)->count()],
                    ]];
                },
            ],
        ];
    }

    private function loanReports(): array
    {
        $loans = fn () => DB::table('loans')->join('members', 'members.id', '=', 'loans.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
            ->join('loan_products as p', 'p.id', '=', 'loans.product_id');
        $paidPrincipal = DB::table('loan_installments')->whereColumn('loan_installments.loan_id', 'loans.id')->selectRaw('coalesce(sum(principal_paid),0)');
        $loanCols = [['loan_no', __('ঋণ নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')], ['product', __('ঋণের ধরন')], ['applied_on', __('আবেদনের তারিখ'), 'date'],
            ['disbursed_on', __('বিতরণের তারিখ'), 'date'], ['amount', __('ঋণের পরিমাণ'), 'money', true], ['interest', __('মোট সুদ'), 'money', true],
            ['outstanding', __('অপরিশোধিত আসল'), 'money', true], ['status', __('অবস্থা')]];
        $loanRow = fn ($r) => [
            'loan_no' => $r->loan_no, 'member_no' => $r->member_no, 'name' => $this->nm($r), 'product' => $this->nm($r, 'p_bn', 'p_en'),
            'applied_on' => $r->applied_on, 'disbursed_on' => $r->disbursed_on, 'amount' => (float) $r->amount, 'interest' => (float) $r->total_interest,
            'outstanding' => in_array($r->status, ['active', 'closed'], true) ? round((float) $r->amount - (float) $r->paid_principal, 2) : 0.0,
            'status' => $this->lbl(Loan::STATUSES, $r->status),
        ];
        $loanSelect = ['loans.*', 'members.member_no', 'farmers.name_bn', 'farmers.name_en', 'p.name_bn as p_bn', 'p.name_en as p_en'];

        return [
            'loans' => [
                'categories' => ['loan'], 'perm' => 'loan.view', 'title' => __('ঋণ রিপোর্ট'),
                'filters' => ['loan_status', 'loan_product'], 'columns' => $loanCols,
                'rows' => fn ($f) => $loans()->when($f['status'], fn ($q, $v) => $q->where('loans.status', $v))->when($f['product_id'], fn ($q, $v) => $q->where('loans.product_id', $v))
                    ->select($loanSelect)->selectSub($paidPrincipal, 'paid_principal')->orderBy('loans.loan_no')->limit(self::MAX_ROWS + 1)->get()->map($loanRow),
            ],
            'loan_disbursement' => [
                'categories' => ['loan'], 'perm' => 'loan.view', 'title' => __('ঋণ বিতরণ রিপোর্ট'),
                'filters' => ['period', 'loan_product'], 'columns' => $loanCols,
                'rows' => fn ($f) => $loans()->whereNotNull('loans.disbursed_on')->whereBetween('loans.disbursed_on', [$f['from'], $f['to']])
                    ->when($f['product_id'], fn ($q, $v) => $q->where('loans.product_id', $v))
                    ->select($loanSelect)->selectSub($paidPrincipal, 'paid_principal')->orderBy('loans.disbursed_on')->limit(self::MAX_ROWS + 1)->get()->map($loanRow),
            ],
            'loan_collection' => [
                'categories' => ['loan', 'collection'], 'perm' => ['loan.view', 'payment.view'], 'title' => __('ঋণের কিস্তি আদায় রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['payment_no', __('রশিদ নং')], ['loan_no', __('ঋণ নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')],
                    ['principal', __('আসল'), 'money', true], ['interest', __('সুদ'), 'money', true], ['penalty', __('জরিমানা'), 'money', true], ['amount', __('মোট'), 'money', true]],
                'rows' => fn ($f) => DB::table('loan_payments as lp')->join('loans', 'loans.id', '=', 'lp.loan_id')->join('members', 'members.id', '=', 'loans.member_id')
                    ->join('farmers', 'farmers.id', '=', 'members.farmer_id')->where('lp.status', '!=', 'cancelled')->whereBetween('lp.date', [$f['from'], $f['to']])
                    ->orderBy('lp.date')->orderBy('lp.id')->limit(self::MAX_ROWS + 1)->get(['lp.*', 'loans.loan_no', 'members.member_no', 'farmers.name_bn', 'farmers.name_en'])
                    ->map(fn ($r) => ['date' => $r->date, 'payment_no' => $r->payment_no, 'loan_no' => $r->loan_no, 'member_no' => $r->member_no, 'name' => $this->nm($r),
                        'principal' => (float) $r->principal, 'interest' => (float) $r->interest, 'penalty' => (float) $r->penalty, 'amount' => (float) $r->amount]),
            ],
            'loan_due' => [
                'categories' => ['loan', 'due'], 'perm' => 'loan.view', 'title' => __('ঋণের বকেয়া রিপোর্ট'),
                'filters' => ['as_of', 'loan_product'],
                'columns' => [['loan_no', __('ঋণ নং')], ['member_no', __('সদস্য নং')], ['name', __('নাম')], ['mobile', __('মোবাইল')], ['installments', __('বকেয়া কিস্তি'), 'number', true],
                    ['oldest_due', __('প্রথম বকেয়া তারিখ'), 'date'], ['days', __('দিন'), 'number'], ['principal', __('বকেয়া আসল'), 'money', true],
                    ['interest', __('বকেয়া সুদ'), 'money', true], ['due', __('মোট বকেয়া'), 'money', true]],
                'rows' => fn ($f) => $loans()->join('loan_installments as i', 'i.loan_id', '=', 'loans.id')->where('loans.status', 'active')
                    ->where('i.due_date', '<=', $f['as_of'])->whereRaw('(i.principal + i.interest - i.principal_paid - i.interest_paid) > 0.009')
                    ->when($f['product_id'], fn ($q, $v) => $q->where('loans.product_id', $v))
                    ->groupBy('loans.id', 'loans.loan_no', 'members.member_no', 'farmers.name_bn', 'farmers.name_en', 'farmers.mobile')
                    ->selectRaw('loans.loan_no, members.member_no, farmers.name_bn, farmers.name_en, farmers.mobile, count(*) as installments, min(i.due_date) as oldest_due,
                        sum(i.principal - i.principal_paid) as principal, sum(i.interest - i.interest_paid) as interest')
                    ->orderBy('oldest_due')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['loan_no' => $r->loan_no, 'member_no' => $r->member_no, 'name' => $this->nm($r), 'mobile' => $r->mobile, 'installments' => (int) $r->installments,
                        'oldest_due' => $r->oldest_due, 'days' => (int) Carbon::parse($r->oldest_due)->diffInDays(Carbon::parse($f['as_of'])),
                        'principal' => round((float) $r->principal, 2), 'interest' => round((float) $r->interest, 2), 'due' => round((float) $r->principal + (float) $r->interest, 2)]),
            ],
            'guarantors' => [
                'categories' => ['loan'], 'perm' => 'loan.view', 'title' => __('জামিনদার রিপোর্ট'),
                'filters' => ['loan_status', 'q'],
                'columns' => [['guarantor_no', __('জামিনদারের সদস্য নং')], ['guarantor', __('জামিনদার')], ['relation', __('সম্পর্ক')], ['loan_no', __('ঋণ নং')],
                    ['borrower', __('ঋণগ্রহীতা')], ['amount', __('ঋণের পরিমাণ'), 'money', true], ['status', __('অবস্থা')]],
                'rows' => fn ($f) => DB::table('loan_guarantors as g')->join('loans', 'loans.id', '=', 'g.loan_id')
                    ->join('members as gm', 'gm.id', '=', 'g.member_id')->join('farmers as gf', 'gf.id', '=', 'gm.farmer_id')
                    ->join('members as bm', 'bm.id', '=', 'loans.member_id')->join('farmers as bf', 'bf.id', '=', 'bm.farmer_id')
                    ->when($f['status'], fn ($q, $v) => $q->where('loans.status', $v))
                    ->when($f['q'], fn ($q, $s) => $q->where(fn ($w) => $w->where('gf.name_bn', 'like', "%$s%")->orWhere('gm.member_no', $s)->orWhere('loans.loan_no', 'like', "%$s%")->orWhere('bf.name_bn', 'like', "%$s%")))
                    ->orderBy('gm.member_no')->limit(self::MAX_ROWS + 1)
                    ->get(['g.relation', 'loans.loan_no', 'loans.amount', 'loans.status', 'gm.member_no as g_no', 'gf.name_bn as g_bn', 'gf.name_en as g_en',
                        'bm.member_no as b_no', 'bf.name_bn as b_bn', 'bf.name_en as b_en'])
                    ->map(fn ($r) => ['guarantor_no' => $r->g_no, 'guarantor' => $this->nm($r, 'g_bn', 'g_en'), 'relation' => $r->relation, 'loan_no' => $r->loan_no,
                        'borrower' => $this->nm($r, 'b_bn', 'b_en').' ('.$r->b_no.')', 'amount' => (float) $r->amount, 'status' => $this->lbl(Loan::STATUSES, $r->status)]),
            ],
            'loan_products_summary' => [
                'categories' => ['loan'], 'perm' => 'loan.view', 'title' => __('ঋণের ধরনভিত্তিক সারসংক্ষেপ'),
                'filters' => [],
                'columns' => [['product', __('ঋণের ধরন')], ['category', __('শ্রেণি')], ['loans', __('চলমান ঋণ'), 'number', true], ['amount', __('বিতরণ'), 'money', true],
                    ['outstanding', __('অপরিশোধিত আসল'), 'money', true]],
                'rows' => fn () => DB::table('loan_products as p')->leftJoin('loans', fn ($j) => $j->on('loans.product_id', '=', 'p.id')->where('loans.status', 'active'))
                    ->groupBy('p.id', 'p.name_bn', 'p.name_en', 'p.category', 'p.code')->orderBy('p.code')
                    ->selectRaw('p.name_bn, p.name_en, p.category, count(loans.id) as loans, coalesce(sum(loans.amount),0) as amount')
                    ->selectSub(DB::table('loan_installments')->join('loans as l2', 'l2.id', '=', 'loan_installments.loan_id')->whereColumn('l2.product_id', 'p.id')
                        ->where('l2.status', 'active')->selectRaw('coalesce(sum(principal - principal_paid),0)'), 'outstanding')->get()
                    ->map(fn ($r) => ['product' => $this->nm($r), 'category' => $this->lbl(LoanProduct::CATEGORIES, $r->category), 'loans' => (int) $r->loans,
                        'amount' => (float) $r->amount, 'outstanding' => round((float) $r->outstanding, 2)]),
            ],
        ];
    }

    private function accountingReports(): array
    {
        $ledgerCols = [['date', __('তারিখ'), 'date'], ['voucher_no', __('ভাউচার')], ['narration', __('বিবরণ')], ['against', __('বিপরীত হিসাব')],
            ['debit', __('ডেবিট (জমা)'), 'money', true], ['credit', __('ক্রেডিট (খরচ)'), 'money', true], ['balance', __('স্থিতি'), 'money']];
        $ledger = function (Account $account, array $f) {
            $l = $this->accounting->ledger($account, $f['from'], $f['to']);
            $rows = collect([['date' => $f['from'], 'voucher_no' => '', 'narration' => __('প্রারম্ভিক জের'), 'against' => '', 'debit' => 0.0, 'credit' => 0.0, 'balance' => $l['opening']]])
                ->concat(collect($l['rows'])->map(fn ($r) => [
                    'date' => $r['date'], 'voucher_no' => $r['voucher_no'], 'narration' => $r['narration'],
                    'against' => collect($r['against'])->map(fn ($a) => $a['code'].' '.$this->nm($a))->implode(', '),
                    'debit' => $r['debit'], 'credit' => $r['credit'], 'balance' => $r['balance'],
                ]));

            return ['rows' => $rows, 'summary' => [
                ['label' => __('হিসাব'), 'value' => $account->code.' — '.$this->nm($account)],
                ['label' => __('প্রারম্ভিক জের'), 'value' => $l['opening'], 'type' => 'money'],
                ['label' => __('সমাপনী জের'), 'value' => $l['closing'], 'type' => 'money'],
            ]];
        };
        $stream = fn (string $key) => function ($f) use ($ledger, $key) {
            return $ledger(Account::byKey($key), $f);
        };

        return [
            'cash_book' => [
                'categories' => ['accounting'], 'perm' => ['accounting.view', 'cash.view', 'bank.view'], 'title' => __('ক্যাশ বই / ব্যাংক বই'),
                'filters' => ['fund', 'period'], 'columns' => $ledgerCols,
                'rows' => function ($f) use ($ledger) {
                    $this->needs($f);

                    return $ledger($this->fundAccounts()->firstWhere('id', (int) $f['account_id']) ?? throw ValidationException::withMessages(['account_id' => __('নগদ বা ব্যাংক হিসাব নির্বাচন করুন।')]), $f);
                },
            ],
            'cash_irrigation' => [
                'categories' => ['accounting'], 'perm' => ['accounting.view', 'cash.view', 'bank.view'], 'title' => __('সেচ নগদ বিবরণী'),
                'filters' => ['period'], 'columns' => $ledgerCols, 'rows' => $stream('cash_irrigation'),
            ],
            'cash_society' => [
                'categories' => ['accounting'], 'perm' => ['accounting.view', 'cash.view', 'bank.view'], 'title' => __('সমিতির নগদ বিবরণী'),
                'filters' => ['period'], 'columns' => $ledgerCols, 'rows' => $stream('cash_society'),
            ],
            'ledger' => [
                'categories' => ['accounting'], 'perm' => 'accounting.view', 'title' => __('খতিয়ান (লেজার)'),
                'filters' => ['account', 'period'], 'columns' => $ledgerCols,
                'rows' => function ($f) use ($ledger) {
                    $this->needs($f);

                    return $ledger(Account::where('is_postable', true)->findOrFail((int) $f['account_id']), $f);
                },
            ],
            'income_expense_cashbook' => [
                'categories' => ['accounting'], 'perm' => ['accounting.view', 'cash.view', 'bank.view'], 'title' => __('আয়-ব্যয় নগদ বই'),
                'filters' => ['period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['voucher_no', __('ভাউচার')], ['account', __('খাত')], ['narration', __('বিবরণ')],
                    ['income', __('আয়'), 'money', true], ['expense', __('ব্যয়'), 'money', true]],
                'rows' => function ($f) {
                    $rows = DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')->join('chart_of_accounts as a', 'a.id', '=', 'l.account_id')
                        ->whereIn('j.status', LedgerService::EFFECTIVE)->where(fn ($q) => $q->whereNull('j.module')->orWhere('j.module', '!=', FinancialYearService::MODULE))
                        ->whereIn('a.type', ['income', 'expense'])->whereBetween('j.date', [$f['from'], $f['to']])
                        ->orderBy('j.date')->orderBy('j.id')->limit(self::MAX_ROWS + 1)
                        ->get(['j.id as journal_id', 'j.date', 'j.voucher_no', 'j.narration', 'a.id as account_id', 'a.code', 'a.name_bn', 'a.name_en', 'a.type', 'l.debit', 'l.credit'])
                        // journal_id / account_id / type are not columns: the cash book page uses them for links and filters
                        ->map(fn ($r) => ['journal_id' => $r->journal_id, 'account_id' => $r->account_id, 'type' => $r->type,
                            'date' => $r->date, 'voucher_no' => $r->voucher_no, 'account' => $r->code.' '.$this->nm($r), 'narration' => $r->narration,
                            'income' => $r->type === 'income' ? round((float) $r->credit - (float) $r->debit, 2) : 0.0,
                            'expense' => $r->type === 'expense' ? round((float) $r->debit - (float) $r->credit, 2) : 0.0]);
                    $inc = round($rows->sum('income'), 2);
                    $exp = round($rows->sum('expense'), 2);

                    return ['rows' => $rows, 'summary' => [['label' => __('নিট উদ্বৃত্ত / (ঘাটতি)'), 'value' => round($inc - $exp, 2), 'type' => 'money']]];
                },
            ],
            'trial_balance' => [
                'categories' => ['accounting'], 'perm' => 'accounting.view', 'title' => __('রেওয়ামিল (ট্রায়াল ব্যালান্স)'),
                'filters' => ['as_of'],
                'columns' => [['code', __('কোড')], ['account', __('হিসাব')], ['type', __('ধরন')], ['debit', __('ডেবিট'), 'money', true], ['credit', __('ক্রেডিট'), 'money', true]],
                'rows' => function ($f) {
                    $tb = $this->accounting->trialBalance($f['as_of']);

                    return ['rows' => collect($tb['rows'])->map(fn ($r) => ['code' => $r['code'], 'account' => $this->nm($r), 'type' => $this->lbl(Account::TYPES, $r['type']),
                        'debit' => $r['debit'], 'credit' => $r['credit']]),
                        'summary' => [['label' => __('মিলেছে কি?'), 'value' => $tb['balanced'] ? __('হ্যাঁ, ডেবিট = ক্রেডিট') : __('না — গরমিল আছে')]]];
                },
            ],
            'income_statement' => [
                'categories' => ['accounting'], 'perm' => 'accounting.view', 'title' => __('আয়-ব্যয় বিবরণী'),
                'filters' => ['period'],
                'columns' => [['section', __('অংশ')], ['code', __('কোড')], ['account', __('হিসাব')], ['amount', __('টাকা'), 'money']],
                'rows' => function ($f) {
                    $s = $this->accounting->incomeStatement($f['from'], $f['to']);
                    $rows = collect($s['income'])->map(fn ($r) => ['section' => __('আয়'), 'code' => $r['code'], 'account' => $this->nm($r), 'amount' => $r['amount']])
                        ->concat(collect($s['expense'])->map(fn ($r) => ['section' => __('ব্যয়'), 'code' => $r['code'], 'account' => $this->nm($r), 'amount' => $r['amount']]));

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('মোট আয়'), 'value' => $s['total_income'], 'type' => 'money'],
                        ['label' => __('মোট ব্যয়'), 'value' => $s['total_expense'], 'type' => 'money'],
                        ['label' => __('নিট উদ্বৃত্ত / (ঘাটতি)'), 'value' => $s['surplus'], 'type' => 'money'],
                    ]];
                },
            ],
            'balance_sheet' => [
                'categories' => ['accounting'], 'perm' => 'accounting.view', 'title' => __('স্থিতিপত্র (ব্যালান্স শিট)'),
                'filters' => ['as_of'],
                'columns' => [['section', __('অংশ')], ['code', __('কোড')], ['account', __('হিসাব')], ['amount', __('টাকা'), 'money']],
                'rows' => function ($f) {
                    $b = $this->accounting->balanceSheet($f['as_of']);
                    $sec = ['asset' => __('সম্পদ'), 'liability' => __('দায়'), 'equity' => __('মূলধন ও তহবিল')];
                    $rows = collect();
                    foreach ($sec as $type => $label) {
                        foreach ($b[$type] as $r) {
                            $rows->push(['section' => $label, 'code' => $r['code'], 'account' => $r['code'] === '' ? $r['name_bn'] : $this->nm($r), 'amount' => $r['amount']]);
                        }
                    }

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('মোট সম্পদ'), 'value' => $b['total_assets'], 'type' => 'money'],
                        ['label' => __('মোট দায় ও মূলধন'), 'value' => $b['total_liabilities_equity'], 'type' => 'money'],
                        ['label' => __('মিলেছে কি?'), 'value' => $b['balanced'] ? __('হ্যাঁ') : __('না — গরমিল আছে')],
                    ]];
                },
            ],
            'cash_flow' => [
                'categories' => ['accounting'], 'perm' => 'accounting.view', 'title' => __('নগদ প্রবাহ বিবরণী'),
                'filters' => ['period'],
                'columns' => [['section', __('অংশ')], ['item', __('খাত')], ['amount', __('টাকা'), 'money']],
                'rows' => function ($f) {
                    $c = $this->accounting->cashFlow($f['from'], $f['to']);
                    $rows = collect($c['inflows'])->map(fn ($r) => ['section' => __('নগদ প্রাপ্তি'), 'item' => $r['label'], 'amount' => $r['amount']])
                        ->concat(collect($c['outflows'])->map(fn ($r) => ['section' => __('নগদ প্রদান'), 'item' => $r['label'], 'amount' => $r['amount']]));

                    return ['rows' => $rows, 'summary' => [
                        ['label' => __('প্রারম্ভিক নগদ ও ব্যাংক'), 'value' => $c['opening'], 'type' => 'money'],
                        ['label' => __('মোট প্রাপ্তি'), 'value' => $c['total_in'], 'type' => 'money'],
                        ['label' => __('মোট প্রদান'), 'value' => $c['total_out'], 'type' => 'money'],
                        ['label' => __('সমাপনী নগদ ও ব্যাংক'), 'value' => $c['closing'], 'type' => 'money'],
                    ]];
                },
            ],
            'irrigation_cash_bank' => [
                'categories' => ['accounting', 'irrigation'], 'perm' => ['accounting.view', 'cash.view', 'bank.view'], 'title' => __('সেচের নগদ ও ব্যাংক'),
                'filters' => ['period'],
                'columns' => [['fund', __('নগদ/ব্যাংক হিসাব')], ['opening', __('প্রারম্ভিক জের'), 'money', true], ['irrigation_in', __('সেচ আদায়'), 'money', true],
                    ['other_in', __('অন্যান্য জমা'), 'money', true], ['out', __('খরচ/স্থানান্তর'), 'money', true], ['closing', __('সমাপনী জের'), 'money', true]],
                'rows' => fn ($f) => $this->accounting->fundMovement($f['from'], $f['to'], 'irrigation')
                    ->map(fn ($r) => ['fund' => $r['code'].' — '.$this->nm($r), 'opening' => $r['opening'], 'irrigation_in' => $r['module_in'],
                        'other_in' => $r['other_in'], 'out' => $r['out'], 'closing' => $r['closing']]),
            ],
            'source_vs_ledger' => [
                'categories' => ['accounting', 'audit'], 'perm' => 'accounting.view', 'title' => __('উৎস বনাম খতিয়ান'),
                'filters' => [],
                'columns' => [['item', __('বিষয়')], ['account', __('খতিয়ানের হিসাব')], ['source', __('মডিউলের হিসাব'), 'money'], ['ledger', __('খতিয়ান'), 'money'],
                    ['difference', __('পার্থক্য'), 'money'], ['result', __('ফলাফল')]],
                'rows' => fn () => collect($this->integrity->sourceVsLedger())->map(fn ($r) => $r + ['result' => abs($r['difference']) < 0.01 ? __('মিলেছে') : __('অমিল')]),
            ],
            'payment_reconciliation' => [
                'categories' => ['accounting', 'collection'], 'perm' => 'payment.view', 'title' => __('পেমেন্ট মিলকরণ'),
                'filters' => ['period'],
                'columns' => [['module', __('খাত')], ['count', __('লেনদেন'), 'number', true], ['source', __('মডিউলে আদায়'), 'money', true],
                    ['ledger', __('খতিয়ানে জমা'), 'money', true], ['difference', __('পার্থক্য'), 'money', true], ['result', __('ফলাফল')]],
                'rows' => fn ($f) => collect($this->integrity->paymentReconciliation($f['from'], $f['to']))->map(fn ($r) => $r + ['result' => abs($r['difference']) < 0.01 ? __('মিলেছে') : __('অমিল')]),
            ],
            'bank_reconciliations' => [
                'categories' => ['accounting'], 'perm' => 'bank.view', 'title' => __('ব্যাংক মিলকরণ রিপোর্ট'),
                'filters' => [],
                'columns' => [['bank', __('ব্যাংক')], ['period', __('মাস')], ['statement_closing', __('স্টেটমেন্ট জের'), 'money'], ['book_closing', __('বইয়ের জের'), 'money'],
                    ['difference', __('পার্থক্য'), 'money'], ['status', __('অবস্থা')]],
                'rows' => fn () => DB::table('bank_reconciliations as r')->join('bank_accounts as b', 'b.id', '=', 'r.bank_account_id')
                    ->orderByDesc('r.period')->get(['r.*', 'b.bank_name', 'b.account_no', 'b.account_id'])
                    ->map(function ($r) {
                        $book = $r->book_closing !== null ? (float) $r->book_closing
                            : app(LedgerService::class)->balance((int) $r->account_id, Carbon::parse($r->period.'-01')->endOfMonth()->toDateString());

                        return ['bank' => $r->bank_name.' — '.$r->account_no, 'period' => $r->period, 'statement_closing' => (float) $r->statement_closing,
                            'book_closing' => $book, 'difference' => round((float) $r->statement_closing - $book, 2), 'status' => $this->lbl(BankReconciliation::STATUSES, $r->status)];
                    }),
            ],
        ];
    }

    private function collectionReports(): array
    {
        return [
            'collection_daily' => [
                'categories' => ['collection'], 'perm' => 'payment.view', 'title' => __('দৈনিক আদায় রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['irrigation', __('সেচ'), 'money', true], ['loan', __('ঋণ'), 'money', true], ['savings', __('সঞ্চয়'), 'money', true],
                    ['share', __('শেয়ার'), 'money', true], ['other', __('অন্যান্য'), 'money', true], ['total', __('মোট'), 'money', true]],
                'rows' => function ($f) {
                    $by = $this->accounting->collectionsByDay($f['from'], $f['to']);

                    return collect($by)->map(fn ($m, $date) => ['date' => $date, 'irrigation' => $m['irrigation'] ?? 0.0, 'loan' => $m['loan'] ?? 0.0,
                        'savings' => $m['savings'] ?? 0.0, 'share' => $m['share'] ?? 0.0,
                        'other' => round(array_sum(array_diff_key($m, array_flip(['irrigation', 'loan', 'savings', 'share']))), 2),
                        'total' => round(array_sum($m), 2)])->values();
                },
            ],
            'collection_by_user' => [
                'categories' => ['collection'], 'perm' => 'payment.view', 'title' => __('আদায়কারীভিত্তিক আদায়'),
                'filters' => ['period'],
                'columns' => [['user', __('আদায়কারী')], ['vouchers', __('রশিদ/ভাউচার'), 'number', true], ['amount', __('টাকা'), 'money', true]],
                'rows' => fn ($f) => $this->accounting->collectionQuery($f['from'], $f['to'])->leftJoin('users as u', 'u.id', '=', 'j.created_by')
                    ->groupBy('u.id', 'u.name_bn', 'u.name_en')->selectRaw('u.name_bn, u.name_en, count(distinct j.id) as vouchers, sum(l.debit) as amount')
                    ->orderByDesc('amount')->get()
                    ->map(fn ($r) => ['user' => $r->name_bn ? $this->nm($r) : __('সিস্টেম'), 'vouchers' => (int) $r->vouchers, 'amount' => (float) $r->amount]),
            ],
            'combined_payments' => [
                'categories' => ['collection'], 'perm' => 'payment.view', 'title' => __('সমন্বিত রশিদ রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['date', __('তারিখ'), 'date'], ['payment_no', __('রশিদ নং')], ['payer', __('প্রদানকারী')], ['method', __('মাধ্যম')],
                    ['status', __('অবস্থা')], ['amount', __('টাকা'), 'money', true]],
                'rows' => fn ($f) => DB::table('combined_payments')->whereBetween('date', [$f['from'], $f['to']])->orderBy('date')->orderBy('id')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['date' => $r->date, 'payment_no' => $r->payment_no, 'payer' => $r->payer_name, 'method' => $this->lbl(Receipt::METHODS, $r->method),
                        'status' => $this->lbl(CombinedPayment::STATUSES, $r->status), 'amount' => $r->status === 'cancelled' ? 0.0 : (float) $r->amount]),
            ],
            'public_payments' => [
                'categories' => ['collection'], 'perm' => 'payment.view', 'title' => __('অনলাইন পেমেন্ট অনুরোধ রিপোর্ট'),
                'filters' => ['period', 'public_status'],
                'columns' => [['date', __('তারিখ'), 'date'], ['request_no', __('অনুরোধ নং')], ['farmer_code', __('কৃষক আইডি')], ['payer', __('প্রদানকারী')],
                    ['method', __('মাধ্যম')], ['trx_id', __('TrxID')], ['status', __('অবস্থা')], ['amount', __('টাকা'), 'money', true]],
                'rows' => fn ($f) => DB::table('public_payment_requests')->whereBetween('paid_on', [$f['from'], $f['to']])
                    ->when($f['status'], fn ($q, $v) => $q->where('status', $v))->orderBy('paid_on')->orderBy('id')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['date' => $r->paid_on, 'request_no' => $r->request_no, 'farmer_code' => $r->farmer_code, 'payer' => $r->payer_name,
                        'method' => $this->lbl(PublicPaymentRequest::METHODS, $r->method), 'trx_id' => $r->trx_id,
                        'status' => $this->lbl(PublicPaymentRequest::STATUSES, $r->status), 'amount' => (float) $r->amount]),
            ],
        ];
    }

    private function auditReports(): array
    {
        return [
            'audit_activity' => [
                'categories' => ['audit'], 'perm' => 'audit.view', 'title' => __('কার্যক্রম (অডিট লগ) রিপোর্ট'),
                'filters' => ['period', 'user', 'audit_module'],
                'columns' => [['time', __('সময়')], ['user', __('ইউজার')], ['module', __('মডিউল')], ['action', __('কার্যক্রম')], ['record', __('রেকর্ড')],
                    ['description', __('বিবরণ')], ['ip', __('IP')]],
                'rows' => fn ($f) => DB::table('audit_logs as a')->leftJoin('users as u', 'u.id', '=', 'a.user_id')
                    ->whereBetween('a.created_at', [$f['from'].' 00:00:00', $f['to'].' 23:59:59'])
                    ->when($f['user_id'], fn ($q, $v) => $q->where('a.user_id', $v))->when($f['module'], fn ($q, $v) => $q->where('a.module', $v))
                    ->orderByDesc('a.id')->limit(self::MAX_ROWS + 1)->get(['a.*', 'u.name_bn', 'u.name_en'])
                    ->map(fn ($r) => ['time' => $r->created_at, 'user' => $r->name_bn ? $this->nm($r) : __('সিস্টেম'), 'module' => $this->lbl(config('erp.modules'), $r->module),
                        'action' => $r->action, 'record' => $r->auditable_type ? $r->auditable_type.' #'.$r->auditable_id : '', 'description' => $r->description, 'ip' => $r->ip_address]),
            ],
            'audit_summary' => [
                'categories' => ['audit'], 'perm' => 'audit.view', 'title' => __('ইউজারভিত্তিক কার্যক্রম সারসংক্ষেপ'),
                'filters' => ['period'],
                'columns' => [['user', __('ইউজার')], ['module', __('মডিউল')], ['create', __('তৈরি'), 'number', true], ['update', __('সম্পাদনা'), 'number', true],
                    ['delete', __('মুছা'), 'number', true], ['other', __('অন্যান্য'), 'number', true], ['total', __('মোট'), 'number', true]],
                'rows' => fn ($f) => DB::table('audit_logs as a')->leftJoin('users as u', 'u.id', '=', 'a.user_id')
                    ->whereBetween('a.created_at', [$f['from'].' 00:00:00', $f['to'].' 23:59:59'])
                    ->groupBy('u.id', 'u.name_bn', 'u.name_en', 'a.module')
                    ->selectRaw("u.name_bn, u.name_en, a.module, sum(case when a.action = 'create' then 1 else 0 end) as c,
                        sum(case when a.action = 'update' then 1 else 0 end) as u, sum(case when a.action = 'delete' then 1 else 0 end) as d, count(*) as t")
                    ->orderBy('u.name_bn')->get()
                    ->map(fn ($r) => ['user' => $r->name_bn ? $this->nm($r) : __('সিস্টেম'), 'module' => $this->lbl(config('erp.modules'), $r->module),
                        'create' => (int) $r->c, 'update' => (int) $r->u, 'delete' => (int) $r->d, 'other' => (int) $r->t - (int) $r->c - (int) $r->u - (int) $r->d, 'total' => (int) $r->t]),
            ],
            'approvals' => [
                'categories' => ['audit'], 'perm' => 'audit.view', 'title' => __('অনুমোদন রিপোর্ট'),
                'filters' => ['period', 'approval_status'],
                'columns' => [['date', __('তারিখ')], ['title', __('বিষয়')], ['module', __('মডিউল')], ['requester', __('আবেদনকারী')], ['status', __('অবস্থা')],
                    ['decided_at', __('সিদ্ধান্তের সময়')], ['amount', __('টাকা'), 'money', true]],
                'rows' => fn ($f) => DB::table('approval_requests as a')->leftJoin('users as u', 'u.id', '=', 'a.requested_by')
                    ->whereBetween('a.created_at', [$f['from'].' 00:00:00', $f['to'].' 23:59:59'])->when($f['status'], fn ($q, $v) => $q->where('a.status', $v))
                    ->orderByDesc('a.id')->limit(self::MAX_ROWS + 1)->get(['a.*', 'u.name_bn', 'u.name_en'])
                    ->map(fn ($r) => ['date' => $r->created_at, 'title' => $r->title, 'module' => $this->lbl(config('erp.modules'), $r->module), 'requester' => $this->nm($r),
                        'status' => $this->lbl(['pending' => 'অপেক্ষমাণ', 'approved' => 'অনুমোদিত', 'rejected' => 'প্রত্যাখ্যাত', 'returned' => 'ফেরত'], $r->status),
                        'decided_at' => $r->decided_at, 'amount' => (float) $r->amount]),
            ],
            'cancellations' => [
                'categories' => ['audit', 'collection'], 'perm' => 'audit.view', 'title' => __('বাতিলকৃত লেনদেন রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['date', __('বাতিলের সময়')], ['type', __('ধরন')], ['no', __('নম্বর')], ['party', __('প্রদানকারী')], ['reason', __('কারণ')], ['amount', __('টাকা'), 'money', true]],
                'rows' => function ($f) {
                    $range = [$f['from'].' 00:00:00', $f['to'].' 23:59:59'];
                    $rows = collect();
                    DB::table('receipts')->where('status', 'cancelled')->whereBetween('cancelled_at', $range)->get()->each(fn ($r) => $rows->push(
                        ['date' => $r->cancelled_at, 'type' => __('টাকার রশিদ'), 'no' => $r->receipt_no, 'party' => $r->payer_name, 'reason' => $r->cancel_reason, 'amount' => (float) $r->amount]));
                    DB::table('combined_payments')->where('status', 'cancelled')->whereBetween('cancelled_at', $range)->get()->each(fn ($r) => $rows->push(
                        ['date' => $r->cancelled_at, 'type' => __('সমন্বিত রশিদ'), 'no' => $r->payment_no, 'party' => $r->payer_name, 'reason' => $r->cancel_reason, 'amount' => (float) $r->amount]));
                    DB::table('loan_payments')->join('loans', 'loans.id', '=', 'loan_payments.loan_id')->where('loan_payments.status', 'cancelled')
                        ->whereBetween('loan_payments.cancelled_at', $range)->get(['loan_payments.*', 'loans.loan_no'])->each(fn ($r) => $rows->push(
                            ['date' => $r->cancelled_at, 'type' => __('ঋণ পরিশোধ'), 'no' => $r->payment_no, 'party' => $r->loan_no, 'reason' => $r->cancel_reason, 'amount' => (float) $r->amount]));
                    DB::table('member_transactions')->where('status', 'cancelled')->whereBetween('cancelled_at', $range)->get()->each(fn ($r) => $rows->push(
                        ['date' => $r->cancelled_at, 'type' => $r->kind === 'share' ? __('শেয়ার লেনদেন') : __('সঞ্চয় লেনদেন'), 'no' => $r->txn_no, 'party' => '', 'reason' => $r->cancel_reason, 'amount' => (float) $r->amount]));
                    DB::table('invoices')->where('status', 'cancelled')->whereBetween('cancelled_at', $range)->get()->each(fn ($r) => $rows->push(
                        ['date' => $r->cancelled_at, 'type' => __('সেচ ইনভয়েস'), 'no' => $r->invoice_no, 'party' => '', 'reason' => $r->cancel_reason, 'amount' => (float) $r->amount]));

                    return $rows->sortBy('date')->values();
                },
            ],
            'login_history' => [
                'categories' => ['audit'], 'perm' => 'audit.view', 'title' => __('লগইন ইতিহাস'),
                'filters' => ['period'],
                'columns' => [['time', __('সময়')], ['username', __('ইউজারনেম')], ['result', __('ফলাফল')], ['reason', __('কারণ')], ['ip', __('IP')]],
                'rows' => fn ($f) => DB::table('login_logs')->whereBetween('created_at', [$f['from'].' 00:00:00', $f['to'].' 23:59:59'])->orderByDesc('id')->limit(self::MAX_ROWS + 1)->get()
                    ->map(fn ($r) => ['time' => $r->created_at, 'username' => $r->username, 'result' => $r->success ? __('সফল') : __('ব্যর্থ'), 'reason' => $r->reason, 'ip' => $r->ip_address]),
            ],
            'export_logs' => [
                'categories' => ['audit'], 'perm' => 'audit.view', 'title' => __('এক্সপোর্ট অডিট'),
                'filters' => ['period', 'user'],
                'columns' => [['time', __('সময়')], ['user', __('ইউজার')], ['title', __('রিপোর্ট/তালিকা')], ['format', __('ফরম্যাট')], ['rows', __('সারি'), 'number', true], ['ip', __('IP')]],
                'rows' => fn ($f) => DB::table('export_logs as e')->leftJoin('users as u', 'u.id', '=', 'e.user_id')
                    ->whereBetween('e.created_at', [$f['from'].' 00:00:00', $f['to'].' 23:59:59'])->when($f['user_id'], fn ($q, $v) => $q->where('e.user_id', $v))
                    ->orderByDesc('e.id')->limit(self::MAX_ROWS + 1)->get(['e.*', 'u.name_bn', 'u.name_en'])
                    ->map(fn ($r) => ['time' => $r->created_at, 'user' => $this->nm($r), 'title' => $r->title, 'format' => $this->lbl(ExportLog::FORMATS, $r->format),
                        'rows' => (int) $r->row_count, 'ip' => $r->ip]),
            ],
        ];
    }

    private function assetReports(): array
    {
        return [
            'asset_register' => [
                'categories' => ['asset'], 'perm' => 'asset.view', 'title' => __('সম্পদ রেজিস্টার'),
                'filters' => ['asset_status'],
                'columns' => [['asset_code', __('সম্পদ নম্বর')], ['name', __('নাম')], ['category', __('ধরন')], ['purchase_date', __('ক্রয়ের তারিখ'), 'date'],
                    ['cost', __('ক্রয়মূল্য'), 'money', true], ['depreciation', __('পুঞ্জীভূত অবচয়'), 'money', true], ['book_value', __('বর্তমান মূল্য'), 'money', true],
                    ['status', __('অবস্থা')], ['condition', __('ভৌত অবস্থা')], ['location', __('অবস্থান')]],
                'rows' => fn ($f) => DB::table('assets')->join('asset_categories as c', 'c.id', '=', 'assets.category_id')
                    ->when($f['status'], fn ($q, $v) => $q->where('assets.status', $v))->orderBy('assets.asset_code')->limit(self::MAX_ROWS + 1)
                    ->get(['assets.*', 'c.name_bn as c_bn', 'c.name_en as c_en'])
                    ->map(fn ($r) => ['asset_code' => $r->asset_code, 'name' => $this->nm($r), 'category' => $this->nm($r, 'c_bn', 'c_en'), 'purchase_date' => $r->purchase_date,
                        'cost' => (float) $r->cost, 'depreciation' => (float) $r->accumulated_depreciation,
                        'book_value' => in_array($r->status, Asset::GONE, true) ? 0.0 : round((float) $r->cost - (float) $r->accumulated_depreciation, 2),
                        'status' => $this->lbl(Asset::STATUSES, $r->status), 'condition' => $this->lbl(Asset::CONDITIONS, $r->condition), 'location' => $r->location]),
            ],
            'asset_by_category' => [
                'categories' => ['asset'], 'perm' => 'asset.view', 'title' => __('ধরনভিত্তিক সম্পদ'),
                'filters' => [],
                'columns' => [['category', __('ধরন')], ['count', __('সংখ্যা'), 'number', true], ['cost', __('ক্রয়মূল্য'), 'money', true],
                    ['depreciation', __('পুঞ্জীভূত অবচয়'), 'money', true], ['book_value', __('বর্তমান মূল্য'), 'money', true]],
                'rows' => fn () => DB::table('asset_categories as c')->join('assets', 'assets.category_id', '=', 'c.id')->whereNotIn('assets.status', Asset::GONE)
                    ->groupBy('c.id', 'c.name_bn', 'c.name_en', 'c.code')->orderBy('c.code')
                    ->selectRaw('c.name_bn, c.name_en, count(*) as n, sum(assets.cost) as cost, sum(assets.accumulated_depreciation) as dep')->get()
                    ->map(fn ($r) => ['category' => $this->nm($r), 'count' => (int) $r->n, 'cost' => (float) $r->cost, 'depreciation' => (float) $r->dep,
                        'book_value' => round((float) $r->cost - (float) $r->dep, 2)]),
            ],
            'asset_depreciation' => [
                'categories' => ['asset'], 'perm' => 'asset.view', 'title' => __('অবচয় রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['period', __('মাস')], ['asset_code', __('সম্পদ নম্বর')], ['name', __('নাম')], ['amount', __('অবচয়'), 'money', true],
                    ['accumulated', __('পুঞ্জীভূত অবচয়'), 'money'], ['book_value', __('বর্তমান মূল্য'), 'money']],
                'rows' => fn ($f) => DB::table('asset_depreciations as d')->join('assets', 'assets.id', '=', 'd.asset_id')
                    ->whereBetween('d.period', [substr($f['from'], 0, 7), substr($f['to'], 0, 7)])->orderBy('d.period')->orderBy('assets.asset_code')
                    ->limit(self::MAX_ROWS + 1)->get(['d.*', 'assets.asset_code', 'assets.name_bn', 'assets.name_en'])
                    ->map(fn ($r) => ['period' => $r->period, 'asset_code' => $r->asset_code, 'name' => $this->nm($r), 'amount' => (float) $r->amount,
                        'accumulated' => (float) $r->accumulated_after, 'book_value' => (float) $r->book_value_after]),
            ],
            'asset_maintenance' => [
                'categories' => ['asset'], 'perm' => 'asset.view', 'title' => __('মেরামত ও রক্ষণাবেক্ষণ রিপোর্ট'),
                'filters' => ['period'],
                'columns' => [['due_on', __('নির্ধারিত তারিখ'), 'date'], ['done_on', __('সম্পন্নের তারিখ'), 'date'], ['asset', __('সম্পদ')], ['kind', __('ধরন')],
                    ['title', __('বিবরণ')], ['vendor', __('মেরামতকারী')], ['status', __('অবস্থা')], ['cost', __('খরচ'), 'money', true]],
                'rows' => fn ($f) => DB::table('asset_maintenances as m')->join('assets', 'assets.id', '=', 'm.asset_id')
                    ->where(fn ($w) => $w->whereBetween('m.due_on', [$f['from'], $f['to']])->orWhereBetween('m.done_on', [$f['from'], $f['to']]))
                    ->orderBy('m.due_on')->limit(self::MAX_ROWS + 1)->get(['m.*', 'assets.asset_code', 'assets.name_bn', 'assets.name_en'])
                    ->map(fn ($r) => ['due_on' => $r->due_on, 'done_on' => $r->done_on, 'asset' => $r->asset_code.' — '.$this->nm($r), 'kind' => $this->lbl(AssetMaintenance::KINDS, $r->kind),
                        'title' => $r->title, 'vendor' => $r->vendor, 'status' => $this->lbl(AssetMaintenance::STATUSES, $r->status), 'cost' => (float) $r->cost]),
            ],
        ];
    }
}
