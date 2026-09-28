<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\Land;
use App\Models\LandCultivation;
use App\Models\LandOwner;
use App\Models\LandTransfer;
use App\Models\User;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The land history list: one row per thing that happened to a plot — created,
 * an owner or cultivator added, a borga agreement made or ended, a transfer,
 * an irrigation bill, or its details edited — gathered from the tables that
 * record them.
 */
class LandActivityController extends Controller
{
    public const KINDS = [
        'land_created' => 'জমি তৈরি',
        'ownership_added' => 'মালিক যুক্ত',
        'cultivation_added' => 'চাষি যুক্ত',
        'cultivation_updated' => 'চাষি পরিবর্তন',
        'borga_agreement' => 'বর্গা চুক্তি',
        'borga_ended' => 'বর্গা শেষ',
        'transfer' => 'হস্তান্তর',
        'irrigation' => 'সেচ কার্যক্রম',
        'details_updated' => 'তথ্য পরিবর্তন',
    ];

    private const PREFIX = [
        'land_created' => 'LND', 'ownership_added' => 'OWN', 'cultivation_added' => 'CUL', 'cultivation_updated' => 'CUL',
        'borga_agreement' => 'BOR', 'borga_ended' => 'BOR', 'details_updated' => 'UPD',
    ];

    public function index(Request $request)
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'user_id' => ['nullable', 'integer']]);
        $q = DB::query()->fromSub($this->union(), 'a')
            ->leftJoin('lands as l', 'l.id', '=', 'a.land_id')
            ->leftJoin('mouzas as m', 'm.id', '=', 'l.mouza_id')
            ->leftJoin('farmers as f', 'f.id', '=', 'a.farmer_id')
            ->select('a.*');
        if ($s = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($s);
            $q->where(fn ($w) => $w->where('l.land_code', 'like', "%$en%")->orWhere('l.dag_no', $en)->orWhere('a.ref', 'like', "%$en%")
                ->orWhere('f.name_bn', 'like', "%$s%")->orWhere('f.name_en', 'like', "%$s%")->orWhere('m.name_bn', 'like', "%$s%"));
        }
        if ($request->filled('kind')) {
            $q->whereIn('a.kind', explode(',', (string) $request->query('kind')));
        }
        if ($request->filled('mouza_id')) {
            $q->where('l.mouza_id', $request->integer('mouza_id'));
        }
        if ($request->filled('upazila_id')) {
            $q->where('m.upazila_id', $request->integer('upazila_id'));
        }
        if ($request->filled('district_id')) {
            $q->whereIn('m.upazila_id', DB::table('upazilas')->where('district_id', $request->integer('district_id'))->select('id'));
        }
        if ($request->filled('user_id')) {
            $q->where('a.user_id', $request->integer('user_id'));
        }
        if ($request->filled('from')) {
            $q->where('a.occurred_on', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('a.occurred_on', '<=', $request->date('to')->toDateString().' 23:59:59');
        }
        $q->orderByDesc('a.occurred_on')->orderByDesc('a.sort_at')->orderByDesc('a.source_id');

        if ($request->query('export') === 'csv') {
            return CsvExport::download('land-history.csv',
                [__('তারিখ'), __('জমির নং'), __('মৌজা'), __('দাগ নং'), __('কার্যক্রমের ধরন'), __('বিবরণ'), __('সংশ্লিষ্ট ব্যক্তি'), __('করেছেন'), __('রেফারেন্স নং')],
                collect($q->limit(20000)->get())->chunk(500)->flatMap(fn ($rows) => $this->hydrate($rows))->map(fn ($r) => [
                    substr((string) $r['date'], 0, 10), $r['land']['land_code'] ?? '', $r['land']['mouza'] ?? '', $r['land']['dag_no'] ?? '',
                    __(self::KINDS[$r['kind']]), trim($r['detail'].' '.($r['detail2'] ?? '')), $r['person']['name_bn'] ?? '', $r['by']['name_bn'] ?? '', $r['ref'],
                ]));
        }

        $page = $q->paginate($this->perPage($request));
        $page->setCollection($this->hydrate($page->getCollection()));

        return response()->json($page);
    }

    public function summary(): JsonResponse
    {
        $by = DB::query()->fromSub($this->union(), 'a')->groupBy('kind')->selectRaw('kind, count(*) as c')->pluck('c', 'kind');
        $userIds = DB::query()->fromSub($this->union(), 'a')->whereNotNull('user_id')->distinct()->pluck('user_id');

        return response()->json([
            'total' => (int) $by->sum(),
            'ownership' => (int) ($by['ownership_added'] ?? 0),
            'cultivation' => (int) (($by['cultivation_added'] ?? 0) + ($by['cultivation_updated'] ?? 0)),
            'borga' => (int) ($by['borga_agreement'] ?? 0),
            'transfers' => (int) ($by['transfer'] ?? 0),
            'irrigation' => (int) ($by['irrigation'] ?? 0),
            'kinds' => Tr::map(self::KINDS),
            'users' => User::withTrashed()->whereIn('id', $userIds)->orderBy('name_bn')->get(['id', 'name_bn', 'name_en']),
        ]);
    }

    /** One normalised row per event: kind, date, plot, person, who did it, source row and its own number. */
    private function union(): Builder
    {
        $cols = fn (string $kind, string $on, string $sort, string $land, string $farmer, ?string $user, string $id, ?string $ref) => DB::raw(
            "$kind as kind, $on as occurred_on, $sort as sort_at, $land as land_id, $farmer as farmer_id, ".($user ?? 'null').' as user_id, '."$id as source_id, ".($ref ?? 'null').' as ref'
        );
        $firstOwner = '(select lo.farmer_id from land_owners lo where lo.land_id = %s order by lo.id limit 1)';
        $mainOwner = '(select lo.farmer_id from land_owners lo where lo.land_id = %s and lo.end_date is null order by lo.share_percent desc, lo.id limit 1)';

        $lands = DB::table('lands')->select($cols("'land_created'", 'DATE(lands.created_at)', 'lands.created_at', 'lands.id', sprintf($firstOwner, 'lands.id'), 'lands.created_by', 'lands.id', null));

        // owners that came from a transfer are shown once, as the transfer
        $owners = DB::table('land_owners')->select($cols("'ownership_added'", 'land_owners.start_date', 'land_owners.created_at', 'land_owners.land_id', 'land_owners.farmer_id', 'land_owners.created_by', 'land_owners.id', null))
            ->whereNotExists(fn ($t) => $t->from('land_transfers as t')->whereColumn('t.land_id', 'land_owners.land_id')->where('t.status', 'approved')
                ->whereColumn('t.transfer_date', 'land_owners.start_date')
                ->where(fn ($w) => $w->whereColumn('t.to_farmer_id', 'land_owners.farmer_id')->orWhereColumn('t.from_farmer_id', 'land_owners.farmer_id')));

        $kind = "case when c.type = 'borga' then 'borga_agreement' when exists (select 1 from land_cultivations p where p.land_id = c.land_id and p.id < c.id) then 'cultivation_updated' else 'cultivation_added' end";
        $cultivations = DB::table('land_cultivations as c')->select($cols($kind, 'c.start_date', 'c.created_at', 'c.land_id', 'c.farmer_id', 'c.created_by', 'c.id', null));
        $borgaEnded = DB::table('land_cultivations as e')->where('e.type', 'borga')->whereNotNull('e.end_date')
            ->select($cols("'borga_ended'", 'e.end_date', 'e.updated_at', 'e.land_id', 'e.farmer_id', null, 'e.id', null));

        $transfers = DB::table('land_transfers')->where('status', 'approved')
            ->select($cols("'transfer'", 'land_transfers.transfer_date', 'land_transfers.updated_at', 'land_transfers.land_id', 'land_transfers.to_farmer_id', 'land_transfers.created_by', 'land_transfers.id', 'land_transfers.transfer_no'));
        $irrigation = DB::table('invoices')->whereNull('cancelled_at')->whereNotNull('invoices.land_id')
            ->select($cols("'irrigation'", 'invoices.invoice_date', 'invoices.created_at', 'invoices.land_id', 'invoices.farmer_id', 'invoices.created_by', 'invoices.id', 'invoices.invoice_no'));
        $edits = DB::table('audit_logs')->where('module', 'land')->where('auditable_type', 'Land')->where('action', 'update')
            ->select($cols("'details_updated'", 'DATE(audit_logs.created_at)', 'audit_logs.created_at', 'audit_logs.auditable_id', sprintf($mainOwner, 'audit_logs.auditable_id'), 'audit_logs.user_id', 'audit_logs.id', null));

        return $lands->unionAll($owners)->unionAll($cultivations)->unionAll($borgaEnded)->unionAll($transfers)->unionAll($irrigation)->unionAll($edits);
    }

    /** Names, photos and a readable line for each event on the page. */
    private function hydrate($rows)
    {
        $rows = collect($rows);
        $ids = fn (string ...$kinds) => $rows->whereIn('kind', $kinds)->pluck('source_id')->all();
        $farmers = Farmer::withTrashed()->whereIn('id', $rows->pluck('farmer_id')->filter())->get(['id', 'farmer_code', 'name_bn', 'name_en', 'photo'])->keyBy('id');
        $users = User::withTrashed()->with('roles')->whereIn('id', $rows->pluck('user_id')->filter())->get()->keyBy('id');
        $lands = Land::withTrashed()->with('mouza:id,name_bn')->whereIn('id', $rows->pluck('land_id')->filter())->get(['id', 'land_code', 'dag_no', 'mouza_id', 'area_decimal'])->keyBy('id');
        $owners = LandOwner::whereIn('id', $ids('ownership_added'))->get()->keyBy('id');
        $cultivations = LandCultivation::whereIn('id', $ids('cultivation_added', 'cultivation_updated', 'borga_agreement', 'borga_ended'))->get()->keyBy('id');
        $transfers = LandTransfer::whereIn('id', $ids('transfer'))->get()->keyBy('id');
        $invoices = Invoice::with('irrigationType:id,name_bn')->whereIn('id', $ids('irrigation'))->get()->keyBy('id');
        $edits = AuditLog::whereIn('id', $ids('details_updated'))->get()->keyBy('id');
        $acres = fn ($d) => number_format(((float) $d) / 100, 2);

        return $rows->map(function ($r) use ($farmers, $users, $lands, $owners, $cultivations, $transfers, $invoices, $edits, $acres) {
            $person = $farmers[$r->farmer_id] ?? null;
            $name = $person?->name_bn ?? '—';
            $role = 'মালিক';
            $detail2 = null;
            switch ($r->kind) {
                case 'land_created':
                    $detail = __('জমির রেকর্ড সিস্টেমে তৈরি হয়েছে।');
                    break;
                case 'ownership_added':
                    $share = (float) ($owners[$r->source_id]->share_percent ?? 100);
                    $detail = __('মালিক যুক্ত: :p0', ['p0' => $name]).($share < 100 ? ' ('.rtrim(rtrim(number_format($share, 2), '0'), '.').'%)' : '');
                    break;
                case 'cultivation_added':
                case 'cultivation_updated':
                    $detail = $r->kind === 'cultivation_added' ? __('চাষি নির্ধারণ:') : __('চাষি পরিবর্তন:');
                    $detail2 = $name;
                    $role = 'চাষি';
                    break;
                case 'borga_agreement':
                    $c = $cultivations[$r->source_id] ?? null;
                    $detail = __('বর্গা চুক্তি তৈরি');
                    $detail2 = $c?->share_percent ? __('(অংশ: :p0%)', ['p0' => rtrim(rtrim(number_format((float) $c->share_percent, 2), '0'), '.')]) : null;
                    $role = 'বর্গাচাষি';
                    break;
                case 'borga_ended':
                    $detail = __('বর্গা চুক্তি শেষ');
                    $role = 'বর্গাচাষি';
                    break;
                case 'transfer':
                    $t = $transfers[$r->source_id] ?? null;
                    $detail = __('জমি হস্তান্তর:');
                    $detail2 = $name.($t && $t->type === 'partial' ? ' ('.rtrim(rtrim(number_format((float) $t->share_percent, 2), '0'), '.').'%)' : '');
                    $role = 'নতুন মালিক';
                    break;
                case 'irrigation':
                    $inv = $invoices[$r->source_id] ?? null;
                    $detail = __('সেচ দেওয়া হয়েছে');
                    $detail2 = __('(ধরন: :p0, পরিমাণ: :p1 একর)', ['p0' => $inv?->irrigationType?->name_bn ?? '—', 'p1' => $acres($inv?->area_decimal)]);
                    $role = $inv?->cultivation_type === 'borga' ? 'বর্গাচাষি' : 'মালিক';
                    break;
                default: // details_updated
                    $log = $edits[$r->source_id] ?? null;
                    $old = $log?->old_values ?? [];
                    $new = $log?->new_values ?? [];
                    $detail = __('জমির তথ্য পরিবর্তন');
                    if (array_key_exists('area_decimal', $new) && array_key_exists('area_decimal', $old)) {
                        $detail2 = __('(পরিমাণ: :p0 → :p1 একর)', ['p0' => $acres($old['area_decimal']), 'p1' => $acres($new['area_decimal'])]);
                    } else {
                        $labels = ['khatian_no' => 'খতিয়ান', 'dag_no' => 'দাগ', 'status' => 'অবস্থা', 'remarks' => 'মন্তব্য', 'land_type_id' => 'জমির ধরন',
                            'irrigation_type_id' => 'সেচের ধরন', 'mouza_id' => 'মৌজা', 'village_id' => 'গ্রাম', 'survey' => 'জরিপ', 'irrigable_decimal' => 'সেচযোগ্য পরিমাণ',
                            'latitude' => 'অবস্থান', 'longitude' => 'অবস্থান', 'location_note' => 'অবস্থান'];
                        $fields = collect(array_keys($new))->map(fn ($k) => $labels[$k] ?? null)->filter()->unique()->map(fn ($l) => __($l));
                        $detail2 = $fields->isNotEmpty() ? '('.$fields->take(3)->implode(', ').')' : null;
                    }
            }
            $user = $users[$r->user_id] ?? null;
            $land = $lands[$r->land_id] ?? null;

            return [
                'key' => $r->kind.'-'.$r->source_id,
                'kind' => $r->kind,
                'date' => $r->occurred_on,
                'source_id' => (int) $r->source_id,
                'ref' => $r->ref ?? sprintf('%s-%s-%04d', self::PREFIX[$r->kind], substr((string) $r->occurred_on, 0, 4), $r->source_id),
                'land' => $land ? ['id' => $land->id, 'land_code' => $land->land_code, 'dag_no' => $land->dag_no, 'mouza' => $land->mouza?->name_bn] : null,
                'detail' => $detail,
                'detail2' => $detail2,
                'person' => $person ? ['id' => $person->id, 'name_bn' => $person->name_bn, 'name_en' => $person->name_en, 'role' => __($role),
                    'photo_url' => $person->photo ? url("api/farmers/{$person->id}/photo") : null] : null,
                'by' => $user ? ['id' => $user->id, 'name_bn' => $user->name_bn, 'name_en' => $user->name_en, 'role' => Tr::label($user->roles->first()?->label)] : null,
            ];
        })->values();
    }
}
