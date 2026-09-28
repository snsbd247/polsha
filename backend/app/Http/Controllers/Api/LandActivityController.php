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
use App\Models\LandType;
use App\Models\Member;
use App\Models\User;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The land history: one row per thing that happened to a plot — created, an
 * owner or cultivator added, a borga agreement made or ended, a transfer, an
 * irrigation bill, a document, or its details edited — gathered from the
 * tables that record them. The list page shows all plots; the land history
 * page asks for one plot (land_id) with the full detail of each event.
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
        'document_added' => 'ডকুমেন্ট যুক্ত',
    ];

    private const PREFIX = [
        'land_created' => 'LND', 'ownership_added' => 'OWN', 'cultivation_added' => 'CUL', 'cultivation_updated' => 'CUL',
        'borga_agreement' => 'BOR', 'borga_ended' => 'BOR', 'details_updated' => 'UPD', 'document_added' => 'DOC',
    ];

    public function index(Request $request)
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'user_id' => ['nullable', 'integer'], 'land_id' => ['nullable', 'integer']]);
        $q = DB::query()->fromSub($this->union(), 'a')
            ->leftJoin('lands as l', 'l.id', '=', 'a.land_id')
            ->leftJoin('mouzas as m', 'm.id', '=', 'l.mouza_id')
            ->leftJoin('farmers as f', 'f.id', '=', 'a.farmer_id')
            ->select('a.*');
        if ($request->filled('land_id')) {
            $q->where('a.land_id', $request->integer('land_id'));
        }
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
        // one plot's story reads oldest first; the list of all plots newest first
        $dir = $request->query('sort') === 'asc' ? 'asc' : 'desc';
        // on the same day a plot is created before it gets owners, and owners before cultivators
        $q->orderBy('a.occurred_on', $dir)
            ->orderByRaw("case a.kind when 'land_created' then 0 when 'ownership_added' then 1 when 'cultivation_added' then 2 when 'borga_agreement' then 2 else 3 end $dir")
            ->orderBy('a.sort_at', $dir)->orderBy('a.source_id', $dir);
        $full = $request->boolean('full');

        if ($request->query('export') === 'csv') {
            return CsvExport::download('land-history.csv',
                [__('তারিখ'), __('জমির নং'), __('মৌজা'), __('দাগ নং'), __('কার্যক্রমের ধরন'), __('বিবরণ'), __('সংশ্লিষ্ট ব্যক্তি'), __('করেছেন'), __('রেফারেন্স নং')],
                collect($q->limit(20000)->get())->chunk(500)->flatMap(fn ($rows) => $this->hydrate($rows))->map(fn ($r) => [
                    substr((string) $r['date'], 0, 10), $r['land']['land_code'] ?? '', $r['land']['mouza'] ?? '', $r['land']['dag_no'] ?? '',
                    __(self::KINDS[$r['kind']]), trim($r['detail'].' '.($r['detail2'] ?? '')), $r['person']['name_bn'] ?? '', $r['by']['name_bn'] ?? '', $r['ref'],
                ]));
        }

        $page = $q->paginate($this->perPage($request));
        $page->setCollection($this->hydrate($page->getCollection(), $full));

        return response()->json($page);
    }

    public function summary(Request $request): JsonResponse
    {
        $base = fn () => DB::query()->fromSub($this->union(), 'a')->when($request->filled('land_id'), fn ($q) => $q->where('land_id', $request->integer('land_id')));
        $by = $base()->groupBy('kind')->selectRaw('kind, count(*) as c')->pluck('c', 'kind');
        $userIds = $base()->whereNotNull('user_id')->distinct()->pluck('user_id');

        return response()->json([
            'total' => (int) $by->sum(),
            'ownership' => (int) ($by['ownership_added'] ?? 0),
            'cultivation' => (int) (($by['cultivation_added'] ?? 0) + ($by['cultivation_updated'] ?? 0)),
            'borga' => (int) ($by['borga_agreement'] ?? 0),
            'transfers' => (int) ($by['transfer'] ?? 0),
            'irrigation' => (int) ($by['irrigation'] ?? 0),
            'documents' => (int) ($by['document_added'] ?? 0),
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

        // owners that came from a transfer are shown once, as the transfer: a row the transfer
        // wrote starts that day, after an earlier row of the same plot was closed that day
        $owners = DB::table('land_owners')->select($cols("'ownership_added'", 'land_owners.start_date', 'land_owners.created_at', 'land_owners.land_id', 'land_owners.farmer_id', 'land_owners.created_by', 'land_owners.id', null))
            ->whereNotExists(fn ($t) => $t->from('land_transfers as t')->whereColumn('t.land_id', 'land_owners.land_id')->where('t.status', 'approved')
                ->whereColumn('t.transfer_date', 'land_owners.start_date')
                ->where(fn ($w) => $w->whereColumn('t.to_farmer_id', 'land_owners.farmer_id')->orWhereColumn('t.from_farmer_id', 'land_owners.farmer_id'))
                ->whereExists(fn ($p) => $p->from('land_owners as prev')->whereColumn('prev.land_id', 'land_owners.land_id')
                    ->whereColumn('prev.id', '<', 'land_owners.id')->whereColumn('prev.end_date', 't.transfer_date')));

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
        $documents = DB::table('land_documents')
            ->select($cols("'document_added'", 'DATE(land_documents.created_at)', 'land_documents.created_at', 'land_documents.land_id', sprintf($mainOwner, 'land_documents.land_id'), 'land_documents.uploaded_by', 'land_documents.id', null));

        return $lands->unionAll($owners)->unionAll($cultivations)->unionAll($borgaEnded)->unionAll($transfers)->unionAll($irrigation)->unionAll($edits)->unionAll($documents);
    }

    /** Names, photos and a readable line for each event on the page; with $full, also a titled list of the facts. */
    private function hydrate($rows, bool $full = false)
    {
        $rows = collect($rows);
        $ids = fn (string ...$kinds) => $rows->whereIn('kind', $kinds)->pluck('source_id')->all();
        $owners = LandOwner::whereIn('id', $ids('ownership_added'))->get()->keyBy('id');
        $cultivations = LandCultivation::whereIn('id', $ids('cultivation_added', 'cultivation_updated', 'borga_agreement', 'borga_ended'))->get()->keyBy('id');
        $transfers = LandTransfer::whereIn('id', $ids('transfer'))->get()->keyBy('id');
        $invoices = Invoice::with(['irrigationType:id,name_bn', 'season:id,name_bn,start_date,end_date'])->whereIn('id', $ids('irrigation'))->get()->keyBy('id');
        $edits = AuditLog::whereIn('id', $ids('details_updated'))->get()->keyBy('id');
        $documents = DB::table('land_documents')->whereIn('id', $ids('document_added'))->get()->keyBy('id');
        $lands = Land::withTrashed()->with(['mouza:id,name_bn', 'landType:id,name_bn'])->whereIn('id', $rows->pluck('land_id')->filter())->get()->keyBy('id');

        // for a borga agreement the owner is who held the plot when it began
        $borgaOwner = [];
        foreach ($cultivations->where('type', 'borga') as $c) {
            $borgaOwner[$c->id] = LandOwner::where('land_id', $c->land_id)->whereDate('start_date', '<=', $c->start_date ?? now())
                ->where(fn ($w) => $w->whereNull('end_date')->orWhereDate('end_date', '>', $c->start_date ?? now()))->orderByDesc('share_percent')->value('farmer_id');
        }
        $farmerIds = $rows->pluck('farmer_id')->merge($transfers->pluck('from_farmer_id'))->merge(array_values($borgaOwner))->filter()->unique();
        $farmers = Farmer::withTrashed()->whereIn('id', $farmerIds)->get(['id', 'farmer_code', 'name_bn', 'name_en', 'photo'])->keyBy('id');
        $memberNo = Member::whereIn('farmer_id', $farmerIds)->pluck('member_no', 'farmer_id');
        $users = User::withTrashed()->with('roles')->whereIn('id', $rows->pluck('user_id')->filter())->get()->keyBy('id');

        $acres = fn ($d) => number_format(((float) $d) / 100, 2);
        $pct = fn ($p) => rtrim(rtrim(number_format((float) $p, 2), '0'), '.').'%';
        $date = fn ($d) => $d ? substr((string) $d, 0, 10) : '—';
        $who = fn ($id) => ($farmers[$id] ?? null)?->name_bn ?? '—';
        $whoNo = fn ($id) => $who($id).(isset($memberNo[$id]) ? ' ('.__('সদস্য নং').' '.$memberNo[$id].')' : '');

        return $rows->map(function ($r) use ($farmers, $users, $lands, $owners, $cultivations, $transfers, $invoices, $edits, $documents, $borgaOwner, $memberNo, $acres, $pct, $date, $who, $whoNo, $full) {
            $person = $farmers[$r->farmer_id] ?? null;
            $name = $person?->name_bn ?? '—';
            $land = $lands[$r->land_id] ?? null;
            $role = 'মালিক';
            $detail2 = null;
            $title = null;
            $facts = [];
            switch ($r->kind) {
                case 'land_created':
                    $detail = __('জমির রেকর্ড সিস্টেমে তৈরি হয়েছে।');
                    $facts = [['মৌজা', $land?->mouza?->name_bn], ['দাগ নং', $land?->dag_no], ['খতিয়ান নং', $land?->khatian_no], ['মোট পরিমাণ', __(':p0 একর', ['p0' => $acres($land?->area_decimal)])]];
                    break;
                case 'ownership_added':
                    $share = (float) ($owners[$r->source_id]->share_percent ?? 100);
                    $detail = __('মালিক যুক্ত: :p0', ['p0' => $name]).($share < 100 ? ' ('.$pct($share).')' : '');
                    $title = __('মালিক যুক্ত হয়েছে।');
                    $facts = [['মালিক', $name], ['সদস্য নং', $memberNo[$r->farmer_id] ?? '—']];
                    if ($share < 100) {
                        $facts[] = ['অংশ', $pct($share)];
                    }
                    break;
                case 'cultivation_added':
                case 'cultivation_updated':
                    $detail = $r->kind === 'cultivation_added' ? __('চাষি নির্ধারণ:') : __('চাষি পরিবর্তন:');
                    $detail2 = $name;
                    $title = $r->kind === 'cultivation_added' ? __('বর্তমান চাষি নির্ধারণ করা হয়েছে।') : __('চাষি পরিবর্তন হয়েছে।');
                    $facts = [['চাষি', $name], ['সদস্য নং', $memberNo[$r->farmer_id] ?? '—']];
                    $role = 'চাষি';
                    break;
                case 'borga_agreement':
                    $c = $cultivations[$r->source_id] ?? null;
                    $detail = __('বর্গা চুক্তি তৈরি');
                    $detail2 = $c?->share_percent ? __('(অংশ: :p0%)', ['p0' => rtrim($pct($c->share_percent), '%')]) : null;
                    $title = __('বর্গা চুক্তি তৈরি হয়েছে।');
                    $facts = [['মালিক', $who($borgaOwner[$r->source_id] ?? null)], ['বর্গাচাষি', $name], ['অংশ', $c?->share_percent ? $pct($c->share_percent) : '—'],
                        ['শুরুর তারিখ', $date($c?->start_date)], ['শেষের তারিখ', $date($c?->contract_end)]];
                    $role = 'বর্গাচাষি';
                    break;
                case 'borga_ended':
                    $c = $cultivations[$r->source_id] ?? null;
                    $detail = __('বর্গা চুক্তি শেষ');
                    $title = __('বর্গা চুক্তি শেষ হয়েছে।');
                    $facts = [['বর্গাচাষি', $name], ['শুরুর তারিখ', $date($c?->start_date)], ['শেষের তারিখ', $date($c?->end_date)]];
                    $role = 'বর্গাচাষি';
                    break;
                case 'transfer':
                    $t = $transfers[$r->source_id] ?? null;
                    $detail = __('জমি হস্তান্তর:');
                    $detail2 = $name.($t && $t->type === 'partial' ? ' ('.$pct($t->share_percent).')' : '');
                    $title = __('জমির মালিকানা হস্তান্তর হয়েছে।');
                    $facts = [['হস্তান্তরকারী', $whoNo($t?->from_farmer_id)], ['গ্রহীতা', $whoNo($r->farmer_id)],
                        ['কারণ', $t ? __(LandTransfer::REASONS[$t->reason] ?? $t->reason) : '—'], ['চুক্তির টাকা', $t?->amount !== null ? number_format((float) $t->amount) : '—']];
                    if ($t && $t->type === 'partial') {
                        $facts[] = ['অংশ', $pct($t->share_percent)];
                    }
                    $role = 'নতুন মালিক';
                    break;
                case 'irrigation':
                    $inv = $invoices[$r->source_id] ?? null;
                    $detail = __('সেচ দেওয়া হয়েছে');
                    $detail2 = __('(ধরন: :p0, পরিমাণ: :p1 একর)', ['p0' => $inv?->irrigationType?->name_bn ?? '—', 'p1' => $acres($inv?->area_decimal)]);
                    $title = __('সেচ দেওয়া হয়েছে।');
                    $facts = [['সেচের ধরন', $inv?->irrigationType?->name_bn ?? '—'], ['পরিমাণ', __(':p0 একর', ['p0' => $acres($inv?->area_decimal)])],
                        ['মৌসুম', $inv?->season?->name_bn ?? '—'], ['সময়কাল', $inv?->season ? $date($inv->season->start_date).' → '.$date($inv->season->end_date) : '—']];
                    $role = $inv?->cultivation_type === 'borga' ? 'বর্গাচাষি' : 'মালিক';
                    break;
                case 'document_added':
                    $d = $documents[$r->source_id] ?? null;
                    $detail = __('ডকুমেন্ট যুক্ত: :p0', ['p0' => $d?->title ?? '—']);
                    $title = __('ডকুমেন্ট যুক্ত হয়েছে।');
                    $facts = [['নাম', $d?->title ?? '—'], ['ফাইল', $d?->original_name ?? '—']];
                    break;
                default: // details_updated
                    $log = $edits[$r->source_id] ?? null;
                    $old = $log?->old_values ?? [];
                    $new = $log?->new_values ?? [];
                    $detail = __('জমির তথ্য পরিবর্তন');
                    $title = __('জমির তথ্য পরিবর্তন হয়েছে।');
                    $labels = ['khatian_no' => 'খতিয়ান', 'dag_no' => 'দাগ', 'status' => 'অবস্থা', 'remarks' => 'মন্তব্য', 'land_type_id' => 'জমির ধরন',
                        'irrigation_type_id' => 'সেচের ধরন', 'mouza_id' => 'মৌজা', 'village_id' => 'গ্রাম', 'survey' => 'জরিপ', 'irrigable_decimal' => 'সেচযোগ্য পরিমাণ',
                        'area_decimal' => 'পরিমাণ', 'latitude' => 'অবস্থান', 'longitude' => 'অবস্থান', 'location_note' => 'অবস্থান'];
                    if (array_key_exists('area_decimal', $new) && array_key_exists('area_decimal', $old)) {
                        $detail2 = __('(পরিমাণ: :p0 → :p1 একর)', ['p0' => $acres($old['area_decimal']), 'p1' => $acres($new['area_decimal'])]);
                    } else {
                        $fields = collect(array_keys($new))->map(fn ($k) => $labels[$k] ?? null)->filter()->unique()->map(fn ($l) => __($l));
                        $detail2 = $fields->isNotEmpty() ? '('.$fields->take(3)->implode(', ').')' : null;
                    }
                    foreach (array_slice(array_intersect_key($new, $labels), 0, 4, true) as $k => $v) {
                        $value = match ($k) {
                            'area_decimal', 'irrigable_decimal' => __(':p0 একর', ['p0' => $acres($v)]),
                            'land_type_id' => LandType::find($v)?->name_bn,
                            'mouza_id' => DB::table('mouzas')->where('id', $v)->value('name_bn'),
                            'village_id' => DB::table('villages')->where('id', $v)->value('name_bn'),
                            'irrigation_type_id' => DB::table('irrigation_types')->where('id', $v)->value('name_bn'),
                            default => $v,
                        };
                        $old_value = array_key_exists($k, $old) && in_array($k, ['area_decimal', 'irrigable_decimal'], true) ? $acres($old[$k]).' → ' : '';
                        $facts[] = [$labels[$k], $old_value.($value === null || $value === '' ? '—' : (string) $value)];
                    }
            }
            $user = $users[$r->user_id] ?? null;

            $out = [
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
            if ($full) {
                $out['title'] = $title ?? $detail;
                $out['facts'] = array_map(fn ($f) => ['label' => __($f[0]), 'value' => (string) ($f[1] ?? '—')], $facts);
            }

            return $out;
        })->values();
    }
}
