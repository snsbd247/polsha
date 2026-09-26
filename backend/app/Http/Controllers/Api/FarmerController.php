<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Farmer;
use App\Models\Household;
use App\Models\Land;
use App\Models\Loan;
use App\Models\MemberAccount;
use App\Models\Mouza;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\FarmerDuplicateService;
use App\Services\ImageService;
use App\Services\MembershipService;
use App\Services\SequenceService;
use App\Services\SettingService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class FarmerController extends Controller
{
    public function __construct(private FarmerDuplicateService $duplicates, private MembershipService $membership) {}

    public function meta(): JsonResponse
    {
        return response()->json(Tr::map(config('erp.farmer')) + ['cancel_reasons' => Tr::map(config('erp.member.cancel_reasons'))]);
    }

    public function index(Request $request): JsonResponse
    {
        $q = $this->filtered($request)->with(['village:id,name_bn', 'mouza:id,name_bn', 'member:id,farmer_id,member_no,status'])
            ->select('farmers.*')
            ->selectSub($this->ownedDecimal(), 'owned_decimal')
            ->withExists(['applications as pending_application' => fn ($a) => $a->where('status', 'pending')]);

        $sort = in_array($request->query('sort'), ['farmer_code', 'name_bn', 'created_at'], true) ? $request->query('sort') : 'id';
        $q->orderBy($sort, $request->query('order') === 'asc' ? 'asc' : 'desc');

        return response()->json($q->paginate($this->perPage($request))->through(fn ($f) => $this->row($f)));
    }

    /** Header cards of the farmer list: people, membership and land in acres. */
    public function summary(): JsonResponse
    {
        $live = Farmer::query()->live();
        $total = (clone $live)->count();
        $members = (clone $live)->whereHas('member')->count();

        return response()->json([
            'total' => $total,
            'members' => $members,
            'non_members' => $total - $members,
            'pending' => DB::table('membership_applications')->where('status', 'pending')->count(),
            'land_acre' => round((float) DB::table('lands')->whereNull('deleted_at')->sum('area_decimal') / 100, 2),
        ]);
    }

    /**
     * Everything the profile page shows beside the personal data: current
     * lands, irrigation, savings, share and loan figures. A block the user
     * may not see comes back as null.
     */
    public function overview(Request $request, Farmer $farmer): JsonResponse
    {
        $user = $request->user();
        $member = $farmer->member()->with('application:id,admission_fee,initial_shares')->first();
        $unit = (float) SettingService::get('share_unit_price', 10) ?: 10.0;
        $out = ['share_unit_price' => $unit];

        $landIds = DB::table('land_owners')->where('farmer_id', $farmer->id)->whereNull('end_date')->pluck('land_id')
            ->merge(DB::table('land_cultivations')->where('farmer_id', $farmer->id)->whereNull('end_date')->pluck('land_id'))->unique();
        $owned = (float) DB::table('land_owners')->join('lands', 'lands.id', '=', 'land_owners.land_id')
            ->where('land_owners.farmer_id', $farmer->id)->whereNull('land_owners.end_date')->whereNull('lands.deleted_at')
            ->sum(DB::raw('lands.area_decimal * land_owners.share_percent / 100'));
        $out['land'] = $user->can('land.view') ? [
            'acre' => round($owned / 100, 2),
            'records' => Land::with(['mouza:id,name_bn', 'landType:id,name_bn', 'owners.farmer:id,name_bn', 'cultivation.farmer:id,name_bn'])
                ->whereIn('id', $landIds)->orderBy('land_code')->get()
                ->map(fn (Land $l) => [
                    'id' => $l->id, 'land_code' => $l->land_code, 'mouza' => $l->mouza?->name_bn, 'dag_no' => $l->dag_no, 'khatian_no' => $l->khatian_no,
                    'area_acre' => round((float) $l->area_decimal / 100, 2), 'land_type' => $l->landType?->name_bn,
                    'owner' => $l->owners->map(fn ($o) => $o->farmer?->name_bn)->filter()->join(', '),
                    'cultivator' => $l->cultivation?->farmer?->name_bn, 'cultivation' => $l->cultivation?->type,
                ]),
        ] : null;

        if ($user->can('irrigation.view')) {
            $live = DB::table('invoices')->where('farmer_id', $farmer->id)->where('status', '!=', 'cancelled');
            $season = DB::table('seasons')->where('status', 'open')->orderByDesc('start_date')->first()
                ?? DB::table('seasons')->orderByDesc('start_date')->first();
            $s = $season ? (clone $live)->where('season_id', $season->id)->selectRaw('COALESCE(SUM(amount),0) a, COALESCE(SUM(paid_amount),0) p')->first() : null;
            $out['irrigation'] = [
                'due' => round((float) (clone $live)->sum(DB::raw('amount - paid_amount')), 2),
                'season' => $season?->name_bn,
                'amount' => round((float) ($s->a ?? 0), 2), 'paid' => round((float) ($s->p ?? 0), 2), 'season_due' => round((float) ($s->a ?? 0) - (float) ($s->p ?? 0), 2),
            ];
        } else {
            $out['irrigation'] = null;
        }

        foreach (['savings', 'share'] as $kind) {
            if (! $user->can($kind.'.view')) {
                $out[$kind] = null;

                continue;
            }
            $acc = $member ? MemberAccount::where('member_id', $member->id)->where('kind', $kind)->first() : null;
            $sums = $acc ? $acc->transactions()->whereIn('status', ['posted', 'cancel_pending'])
                ->selectRaw("COALESCE(SUM(CASE WHEN direction = 'in' THEN amount END),0) i, COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END),0) o")->first() : null;
            $balance = round((float) ($acc->balance ?? 0), 2);
            $out[$kind] = ['account_id' => $acc?->id, 'account_no' => $acc?->account_no, 'deposit' => round((float) ($sums->i ?? 0), 2),
                'withdrawal' => round((float) ($sums->o ?? 0), 2), 'balance' => $balance]
                + ($kind === 'share' ? ['shares' => (int) floor($balance / $unit + 1e-9)] : []);
        }

        if ($user->can('loan.view') && $member) {
            $loans = Loan::where('member_id', $member->id);
            $active = (clone $loans)->where('status', 'active');
            $out['loan'] = [
                'active' => (clone $active)->count(),
                'active_id' => (clone $active)->value('id'),
                'disbursed' => round((float) (clone $loans)->whereNotNull('disbursed_on')->sum('amount'), 2),
                'balance' => round((float) DB::table('loan_installments')->whereIn('loan_id', (clone $active)->select('id'))
                    ->sum(DB::raw('(principal + interest) - (principal_paid + interest_paid)')), 2),
            ];
        } else {
            $out['loan'] = $user->can('loan.view') ? ['active' => 0, 'active_id' => null, 'disbursed' => 0, 'balance' => 0] : null;
        }

        $minMonths = (int) SettingService::get('voter_min_membership_months', 0);
        $out['membership'] = $member ? [
            'admission_fee' => $member->application ? (float) $member->application->admission_fee : null,
            'initial_shares' => $member->application?->initial_shares,
            'voter' => $member->status === 'active' && $member->admitted_on->copy()->addMonths($minMonths)->lte(today()),
        ] : null;

        return response()->json($out);
    }

    /** Current owned area (শতক) of the outer farmer row, weighted by ownership share. */
    private function ownedDecimal()
    {
        return DB::table('land_owners')->join('lands', 'lands.id', '=', 'land_owners.land_id')
            ->whereColumn('land_owners.farmer_id', 'farmers.id')
            ->whereNull('land_owners.end_date')->whereNull('lands.deleted_at')
            ->selectRaw('COALESCE(SUM(lands.area_decimal * land_owners.share_percent / 100), 0)');
    }

    public function export(Request $request)
    {
        $rows = $this->filtered($request)->with(['village:id,name_bn', 'mouza:id,name_bn', 'member:id,farmer_id,member_no,status'])
            ->orderBy('farmer_code')->lazy()
            ->map(fn (Farmer $f) => [
                $f->farmer_code, $f->member?->member_no, $f->name_bn, $f->father_name, $f->mother_name,
                $f->nid, $f->mobile, $f->village?->name_bn, $f->mouza?->name_bn,
                $f->member ? __('সদস্য') : __('নন-মেম্বার'), $f->is_active ? __('সক্রিয়') : __('নিষ্ক্রিয়'),
            ]);

        return CsvExport::download('farmers-'.now()->format('Ymd').'.csv',
            ['Farmer ID', __('সদস্য নং'), __('নাম'), __('পিতা'), __('মাতা'), 'NID', __('মোবাইল'), __('গ্রাম'), __('মৌজা'), __('ধরন'), __('অবস্থা')], $rows);
    }

    public function show(Farmer $farmer): JsonResponse
    {
        $farmer->load([
            'village.union.upazila.district', 'mouza:id,name_bn,jl_no', 'household.head:id,name_bn,farmer_code',
            'member.history.creator:id,name_bn', 'member.nominees', 'mergedInto:id,farmer_code,name_bn',
            'applications:id,farmer_id,application_no,applied_on,status',
        ]);
        $v = $farmer->village;

        return response()->json($this->row($farmer) + [
            'mother_name' => $farmer->mother_name,
            'spouse_name' => $farmer->spouse_name,
            'gender' => $farmer->gender,
            'date_of_birth' => $farmer->date_of_birth?->toDateString(),
            'birth_reg_no' => $farmer->birth_reg_no,
            'alt_mobile' => $farmer->alt_mobile,
            'email' => $farmer->email,
            'para' => $farmer->para,
            'post_office' => $farmer->post_office,
            'post_code' => $farmer->post_code,
            'blood_group' => $farmer->blood_group,
            'education_level' => $farmer->education_level,
            'farmer_type' => $farmer->farmer_type,
            'family' => $farmer->family()->get(['id', 'name', 'relation', 'occupation', 'mobile']),
            'mouza_jl_no' => $farmer->mouza?->jl_no,
            'household_id' => $farmer->household_id,
            'household' => $farmer->household ? ['id' => $farmer->household->id, 'code' => $farmer->household->code, 'head' => $farmer->household->head] : null,
            'household_relation' => $farmer->household_relation,
            'occupation' => $farmer->occupation,
            'remarks' => $farmer->remarks,
            'village_id' => $farmer->village_id,
            'mouza_id' => $farmer->mouza_id,
            'location_path' => [$v->union->upazila->district->division_id, $v->union->upazila->district_id, $v->union->upazila_id, $v->union_id, $v->id],
            'address' => implode(', ', array_filter([$farmer->para, $v->name_bn, $v->union->name_bn, $v->union->upazila->name_bn, $v->union->upazila->district->name_bn])),
            'member_detail' => $farmer->member,
            'applications' => $farmer->applications,
            'merged_into' => $farmer->mergedInto,
            'created_at' => $farmer->created_at,
        ]);
    }

    /** Pre-save duplicate check used by the form. */
    public function checkDuplicate(Request $request): JsonResponse
    {
        return response()->json($this->duplicates->check($this->normalise($request), $request->integer('ignore_id') ?: null));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $extras = $this->validatedExtras($request, true);
        $this->guardDuplicates($request, $data);

        $farmer = DB::transaction(function () use ($request, $data, $extras) {
            $data['farmer_code'] = SequenceService::next('farmer');
            $data['created_by'] = $request->user()->id;
            if ($request->hasFile('photo')) {
                $data['photo'] = ImageService::storeCompressed($request->file('photo'), 'farmers');
            }
            $farmer = Farmer::create($data);
            $this->attachNewHousehold($request, $farmer);
            $this->saveExtras($request, $farmer, $extras);
            // "existing member" on the form: record the member number from the old books
            if (! empty($extras['legacy_member_no'])) {
                $this->membership->createLegacy($farmer, (int) $extras['legacy_member_no'], $extras['legacy_admitted_on'], null, $request->user()->id);
            }

            return $farmer;
        });

        return response()->json(['id' => $farmer->id, 'farmer_code' => $farmer->farmer_code], 201);
    }

    public function update(Request $request, Farmer $farmer): JsonResponse
    {
        abort_if($farmer->merged_into_id, 422, __('মার্জ হয়ে যাওয়া রেকর্ড সম্পাদনা করা যায় না।'));
        $data = $this->validated($request, $farmer);
        $extras = $this->validatedExtras($request, false);
        $this->guardDuplicates($request, $data, $farmer->id);

        DB::transaction(function () use ($request, $farmer, $data, $extras) {
            if ($request->hasFile('photo')) {
                $old = $farmer->photo;
                $data['photo'] = ImageService::storeCompressed($request->file('photo'), 'farmers');
                if ($old) {
                    Storage::disk('local')->delete($old);
                }
            }
            $farmer->update($data);
            $this->attachNewHousehold($request, $farmer);
            $this->saveExtras($request, $farmer, $extras);
        });

        return response()->json(['id' => $farmer->id]);
    }

    public function toggleActive(Farmer $farmer): JsonResponse
    {
        abort_if($farmer->merged_into_id, 422, __('মার্জ হয়ে যাওয়া রেকর্ড পরিবর্তন করা যায় না।'));
        $farmer->update(['is_active' => ! $farmer->is_active]);

        return response()->json(['is_active' => $farmer->is_active]);
    }

    public function destroy(Request $request, Farmer $farmer): JsonResponse
    {
        $data = $request->validate([
            'reason_code' => ['nullable', Rule::in(array_diff(array_keys(config('erp.farmer.delete_reasons')), ['merged']))],
            'reason' => ['nullable', 'string', 'max:300'],
        ]);
        if ($farmer->member()->exists() || $farmer->applications()->exists()) {
            throw ValidationException::withMessages(['farmer' => __('সদস্যপদ বা আবেদন আছে এমন কৃষক মুছা যাবে না; নিষ্ক্রিয় করুন।')]);
        }
        DB::transaction(function () use ($farmer, $data, $request) {
            $farmer->forceFill(['delete_reason' => $data['reason_code'] ?? 'other', 'delete_note' => $data['reason'] ?? null,
                'deleted_by' => $request->user()->id, 'removed_at' => now()])->saveQuietly();
            $farmer->delete();
            if (! empty($data['reason'])) {
                AuditLog::where('auditable_type', 'Farmer')->where('auditable_id', $farmer->id)->where('action', 'delete')
                    ->latest('id')->first()?->update(['description' => $data['reason']]);
            }
        });

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    /** Deleted and merged-away farmers: one list, since both are gone from the farmer list. */
    private function removedQuery(Request $request)
    {
        $q = Farmer::withTrashed()->where(fn ($w) => $w->whereNotNull('farmers.deleted_at')->orWhereNotNull('farmers.merged_into_id'));
        if ($s = trim((string) ($request->query('search') ?? $request->query('q')))) {
            $s = Bn::toEnDigits($s);
            $q->where(fn ($w) => $w->where('name_bn', 'like', "%$s%")->orWhere('name_en', 'like', "%$s%")->orWhere('father_name', 'like', "%$s%")
                ->orWhere('farmer_code', 'like', "%$s%")->orWhere('mobile', 'like', "%$s%")->orWhere('nid', 'like', "%$s%"));
        }
        foreach (['deleted_by', 'mouza_id'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->integer($f));
            }
        }
        if ($request->filled('reason')) {
            $q->where('delete_reason', $request->query('reason'));
        }
        if ($request->filled('from')) {
            $q->where('removed_at', '>=', $request->date('from')->startOfDay());
        }
        if ($request->filled('to')) {
            $q->where('removed_at', '<=', $request->date('to')->endOfDay());
        }

        return $q;
    }

    /** Deleted farmers with who removed them, when and why. */
    public function deleted(Request $request)
    {
        $q = $this->removedQuery($request)->with(['village:id,name_bn,name_en', 'mouza:id,name_bn,name_en', 'deleter:id,name_bn,name_en', 'mergedInto:id,farmer_code,name_bn'])
            ->orderByDesc('removed_at')->orderByDesc('id');
        $reasons = config('erp.farmer.delete_reasons');

        if ($request->query('export') === 'csv') {
            return CsvExport::download('deleted-farmers.csv',
                [__('কৃষক নং'), __('নাম'), __('পিতার নাম'), __('মোবাইল'), 'NID', __('মৌজা'), __('মুছার তারিখ'), __('মুছেছেন'), __('কারণ'), __('মন্তব্য')],
                $q->lazy()->map(fn (Farmer $f) => [$f->farmer_code, $f->name_bn, $f->father_name, $f->mobile, $f->nid, $f->mouza?->name_bn,
                    $f->removed_at?->format('Y-m-d'), $f->deleter?->name_bn, __($reasons[$f->delete_reason] ?? ''), $f->delete_note]));
        }

        $page = $q->paginate($this->perPage($request))->through(fn (Farmer $f) => $f->only(['id', 'farmer_code', 'name_bn', 'name_en', 'father_name', 'mobile', 'nid', 'deleted_at'])
            + ['village' => $f->village, 'mouza' => $f->mouza, 'deleted_by' => $f->deleter, 'removed_at' => $f->removed_at ?? $f->deleted_at,
                'reason_code' => $f->delete_reason, 'reason' => $f->delete_note, 'merged_into' => $f->mergedInto,
                'photo_url' => $f->photo ? url("api/farmers/{$f->id}/photo") : null]);

        return response()->json($page);
    }

    public function deletedSummary(): JsonResponse
    {
        $removed = Farmer::withTrashed()->where(fn ($w) => $w->whereNotNull('deleted_at')->orWhereNotNull('merged_into_id'));

        return response()->json([
            'total' => (clone $removed)->count(),
            'restored' => AuditLog::where('auditable_type', 'Farmer')->where('action', 'restore')->count(),
            'purged' => AuditLog::where('auditable_type', 'Farmer')->where('action', 'purge')->count(),
            'this_month' => (clone $removed)->where('removed_at', '>=', now()->startOfMonth())->count(),
            // people who removed farmers, for the "Deleted by" filter
            'users' => User::withTrashed()->whereIn('id', (clone $removed)->whereNotNull('deleted_by')->distinct()->pluck('deleted_by'))->get(['id', 'name_bn', 'name_en']),
        ]);
    }

    public function restore(int $id): JsonResponse
    {
        $farmer = Farmer::onlyTrashed()->findOrFail($id);
        if ($farmer->nid && Farmer::where('nid', $farmer->nid)->exists()) {
            throw ValidationException::withMessages(['farmer' => __('এই NID দিয়ে আরেকজন সক্রিয় কৃষক আছে; আগে সেটি যাচাই করুন।')]);
        }
        $farmer->restore();
        $farmer->forceFill(['delete_reason' => null, 'delete_note' => null, 'deleted_by' => null, 'removed_at' => null])->saveQuietly();

        return response()->json(['id' => $farmer->id, 'message' => __('কৃষক পুনরুদ্ধার করা হয়েছে।')]);
    }

    /**
     * Remove a deleted farmer for good. Only a record nothing else points to
     * may go; anything with land, bills, payments or history stays restorable.
     */
    public function purge(int $id): JsonResponse
    {
        $farmer = Farmer::onlyTrashed()->findOrFail($id);
        $uses = [
            'land_owners' => 'farmer_id', 'land_cultivations' => 'farmer_id', 'invoices' => 'farmer_id', 'receipts' => 'farmer_id',
            'combined_payments' => 'farmer_id', 'public_payment_requests' => 'farmer_id', 'members' => 'farmer_id',
            'membership_applications' => 'farmer_id', 'patwaris' => 'farmer_id', 'households' => 'head_farmer_id', 'farmers' => 'merged_into_id',
        ];
        foreach ($uses as $table => $col) {
            if (DB::table($table)->where($col, $farmer->id)->exists()) {
                throw ValidationException::withMessages(['farmer' => __('এই কৃষকের সাথে অন্য রেকর্ড যুক্ত আছে; স্থায়ীভাবে মুছা যাবে না।')]);
            }
        }

        DB::transaction(function () use ($farmer) {
            $files = $farmer->documents()->pluck('path')->push($farmer->photo)->filter()->all();
            AuditLogger::log('farmer', 'purge', $farmer, ['farmer_code' => $farmer->farmer_code, 'name_bn' => $farmer->name_bn]);
            $farmer->documents()->delete();
            $farmer->forceDelete();
            DB::afterCommit(fn () => Storage::disk('local')->delete($files));
        });

        return response()->json(['message' => __('কৃষক স্থায়ীভাবে মুছে ফেলা হয়েছে।')]);
    }

    public function photo(Farmer $farmer)
    {
        abort_unless($farmer->photo && Storage::disk('local')->exists($farmer->photo), 404);

        return Storage::disk('local')->response($farmer->photo);
    }

    /** Audit timeline for this farmer and their member record. */
    public function history(Request $request, Farmer $farmer): JsonResponse
    {
        $memberId = $farmer->member()->value('id');
        $q = AuditLog::with('user:id,name_bn')
            ->where(fn ($w) => $w->where(fn ($x) => $x->where('auditable_type', 'Farmer')->where('auditable_id', $farmer->id))
                ->when($memberId, fn ($x) => $x->orWhere(fn ($y) => $y->where('auditable_type', 'Member')->where('auditable_id', $memberId))))
            ->latest('id');

        return response()->json($q->paginate($this->perPage($request)));
    }

    /** Lightweight search for pickers (applications, households, patwaris, merge). */
    public function lookup(Request $request): JsonResponse
    {
        $term = trim((string) $request->query('q'));
        $q = Farmer::query()->live()->with('village:id,name_bn', 'member:id,farmer_id,member_no,status')
            ->when($request->boolean('active_only'), fn ($w) => $w->where('is_active', true))
            ->when($request->query('type') === 'non_member', fn ($w) => $w->whereDoesntHave('member'))
            ->when($request->query('type') === 'active_member', fn ($w) => $w->whereHas('member', fn ($m) => $m->where('status', 'active')));
        $this->applySearch($q, $term);

        return response()->json($q->orderBy('name_bn')->limit(20)->get()->map(fn ($f) => [
            'id' => $f->id,
            'farmer_code' => $f->farmer_code,
            'name_bn' => $f->name_bn,
            'father_name' => $f->father_name,
            'village' => $f->village?->name_bn,
            'village_id' => $f->village_id,
            'member_id' => $f->member?->id,
            'member_no' => $f->member?->member_no,
        ]));
    }

    private function filtered(Request $request): Builder
    {
        $q = Farmer::query()->live();
        $this->applySearch($q, trim((string) $request->query('search')));

        foreach (['mouza_id', 'village_id', 'household_id'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('union_id')) {
            $q->whereHas('village', fn ($v) => $v->where('union_id', $request->query('union_id')));
        }
        match ($request->query('type')) {
            'member' => $q->whereHas('member'),
            'non_member' => $q->whereDoesntHave('member'),
            default => null,
        };
        match ($request->query('member_status')) {
            'active', 'inactive', 'cancelled' => $q->whereHas('member', fn ($m) => $m->where('status', $request->query('member_status'))),
            'non_member' => $q->whereDoesntHave('member'),
            'pending' => $q->whereDoesntHave('member')->whereHas('applications', fn ($a) => $a->where('status', 'pending')),
            default => null,
        };
        if ($request->filled('occupation')) {
            $q->where('occupation', $request->query('occupation'));
        }
        match ($request->query('land_owner')) {
            'yes' => $q->whereHas('ownerships', fn ($o) => $o->whereNull('end_date')),
            'no' => $q->whereDoesntHave('ownerships', fn ($o) => $o->whereNull('end_date')),
            default => null,
        };
        if ($request->filled('is_active')) {
            $q->where('is_active', $request->boolean('is_active'));
        }

        return $q;
    }

    private function applySearch(Builder $q, string $term): void
    {
        if ($term === '') {
            return;
        }
        $en = Bn::toEnDigits($term);
        $q->where(function ($w) use ($term, $en) {
            $w->where('name_bn', 'like', "%$term%")
                ->orWhere('name_en', 'like', "%$term%")
                ->orWhere('father_name', 'like', "%$term%")
                ->orWhere('farmer_code', 'like', "%$en%")
                ->orWhere('nid', 'like', "$en%")
                ->orWhere('mobile', 'like', "%$en%");
            if (ctype_digit($en)) {
                $w->orWhereHas('member', fn ($m) => $m->where('member_no', (int) $en));
            }
        });
    }

    private function normalise(Request $request): array
    {
        $digits = ['nid', 'birth_reg_no', 'mobile', 'alt_mobile', 'post_code'];
        $request->merge(collect($digits)->mapWithKeys(fn ($k) => [$k => Bn::toEnDigits($request->input($k)) ?: null])->all());

        return $request->only(['nid', 'mobile', 'name_bn', 'father_name', 'village_id']);
    }

    private function validated(Request $request, ?Farmer $farmer = null): array
    {
        $this->normalise($request);
        $genders = array_keys(config('erp.farmer.genders'));

        $data = $request->validate([
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'father_name' => ['required', 'string', 'max:150'],
            'mother_name' => ['nullable', 'string', 'max:150'],
            'spouse_name' => ['nullable', 'string', 'max:150'],
            'gender' => ['required', Rule::in($genders)],
            'date_of_birth' => ['nullable', 'date', 'before:today'],
            'nid' => ['nullable', 'regex:/^(\d{10}|\d{13}|\d{17})$/', Rule::unique('farmers')->ignore($farmer)->whereNull('merged_into_id')],
            'birth_reg_no' => ['nullable', 'regex:/^\d{17}$/'],
            'mobile' => ['nullable', 'regex:/^01[3-9]\d{8}$/'],
            'alt_mobile' => ['nullable', 'regex:/^01[3-9]\d{8}$/'],
            'email' => ['nullable', 'email', 'max:150'],
            'village_id' => ['required', 'exists:villages,id'],
            'mouza_id' => ['required', 'exists:mouzas,id'],
            'para' => ['nullable', 'string', 'max:255'],
            'post_office' => ['nullable', 'string', 'max:100'],
            'post_code' => ['nullable', 'regex:/^\d{4}$/'],
            'blood_group' => ['nullable', Rule::in(array_keys(config('erp.farmer.blood_groups')))],
            'education_level' => ['nullable', Rule::in(array_keys(config('erp.farmer.education_levels')))],
            'farmer_type' => ['nullable', Rule::in(array_keys(config('erp.farmer.farmer_types')))],
            'household_id' => ['nullable', 'exists:households,id'],
            'household_relation' => ['nullable', 'required_with:household_id', Rule::in(array_keys(config('erp.farmer.relations')))],
            'occupation' => ['nullable', Rule::in(array_keys(config('erp.farmer.occupations')))],
            'remarks' => ['nullable', 'string', 'max:2000'],
            'photo' => ['nullable', 'image', 'max:2048'],
            'is_active' => ['boolean'],
        ], [
            'nid.regex' => __('NID ১০, ১৩ বা ১৭ অঙ্কের হতে হবে।'),
            'nid.unique' => __('এই NID দিয়ে আগে থেকেই একজন কৃষক আছেন।'),
            'birth_reg_no.regex' => __('জন্ম নিবন্ধন নম্বর ১৭ অঙ্কের হতে হবে।'),
            'mobile.regex' => __('সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।'),
            'alt_mobile.regex' => __('সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।'),
            'post_code.regex' => __('পোস্ট কোড ৪ অঙ্কের হতে হবে।'),
        ]);

        $linked = Mouza::whereKey($data['mouza_id'])->whereHas('villages', fn ($v) => $v->where('villages.id', $data['village_id']))->exists();
        if (! $linked) {
            throw ValidationException::withMessages(['mouza_id' => __('এই মৌজা বাছাই করা গ্রামের সাথে যুক্ত নয়। মৌজা পাতায় গ্রাম যুক্ত করুন।')]);
        }
        unset($data['photo']);

        return $data;
    }

    /**
     * Family rows, supporting documents and (new farmers only) an existing
     * member number. The form posts multipart data, so family comes as JSON.
     */
    private function validatedExtras(Request $request, bool $creating): array
    {
        if (is_string($request->input('family'))) {
            $request->merge(['family' => json_decode($request->input('family'), true) ?: []]);
        }
        $request->merge([
            'family' => collect($request->input('family', []))
                ->map(fn ($r) => is_array($r) ? ['mobile' => Bn::toEnDigits((string) ($r['mobile'] ?? '')) ?: null] + $r : $r)->all(),
        ]);
        if ($request->filled('legacy_member_no')) {
            $request->merge(['legacy_member_no' => Bn::toEnDigits((string) $request->input('legacy_member_no'))]);
        }
        $data = $request->validate([
            'family' => ['nullable', 'array', 'max:20'],
            'family.*.name' => ['required', 'string', 'max:150'],
            'family.*.relation' => ['nullable', Rule::in(array_keys(config('erp.farmer.relations')))],
            'family.*.occupation' => ['nullable', 'string', 'max:100'],
            'family.*.mobile' => ['nullable', 'regex:/^01[3-9]\d{8}$/'],
            'doc_nid_front' => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'doc_nid_back' => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'doc_other' => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'legacy_member_no' => $creating ? ['nullable', 'integer', 'min:1', 'unique:members,member_no'] : ['prohibited'],
            'legacy_admitted_on' => ['nullable', 'required_with:legacy_member_no', 'date', 'before_or_equal:today'],
        ], [
            'family.*.name.required' => __('পরিবারের সদস্যের নাম দিন।'),
            'family.*.mobile.regex' => __('সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।'),
            'legacy_member_no.unique' => __('এই সদস্য নম্বর ইতিমধ্যে ব্যবহৃত।'),
        ]);
        abort_if(! empty($data['legacy_member_no']) && ! $request->user()->can('member.admin'), 403, __('পুরোনো সদস্য নম্বর দেওয়ার অনুমতি নেই।'));

        return $data;
    }

    private function saveExtras(Request $request, Farmer $farmer, array $extras): void
    {
        if ($request->has('family')) {
            $farmer->family()->delete();
            foreach (array_values($extras['family'] ?? []) as $i => $row) {
                $farmer->family()->create(['name' => $row['name'], 'relation' => $row['relation'] ?? null,
                    'occupation' => $row['occupation'] ?? null, 'mobile' => $row['mobile'] ?? null, 'sort' => $i]);
            }
        }
        foreach (['nid_front', 'nid_back', 'other'] as $type) {
            if ($file = $request->file('doc_'.$type)) {
                $farmer->documents()->create([
                    'type' => $type,
                    // private disk: only reachable through the authenticated download route
                    'path' => $file->store("farmer-docs/{$farmer->id}", 'local'),
                    'original_name' => mb_substr($file->getClientOriginalName(), 0, 250),
                    'mime' => $file->getMimeType(),
                    'size' => $file->getSize(),
                    'uploaded_by' => $request->user()->id,
                ]);
            }
        }
    }

    /** NID match blocks; other matches need `confirm_duplicate=1` from the user. */
    private function guardDuplicates(Request $request, array $data, ?int $ignoreId = null): void
    {
        $result = $this->duplicates->check($data, $ignoreId);
        if ($result['block']) {
            throw ValidationException::withMessages(['nid' => __('এই NID দিয়ে আগে থেকেই একজন কৃষক আছেন।')]);
        }
        if ($result['warn'] && ! $request->boolean('confirm_duplicate')) {
            abort(response()->json([
                'message' => __('সম্ভাব্য ডুপ্লিকেট কৃষক পাওয়া গেছে।'),
                'code' => 'possible_duplicate',
                'matches' => $result['warn'],
            ], 409));
        }
    }

    private function attachNewHousehold(Request $request, Farmer $farmer): void
    {
        if (! $request->boolean('new_household')) {
            return;
        }
        $household = Household::create([
            'code' => SequenceService::next('household'),
            'village_id' => $farmer->village_id,
            'head_farmer_id' => $farmer->id,
        ]);
        $farmer->update(['household_id' => $household->id, 'household_relation' => 'self']);
    }

    private function row(Farmer $f): array
    {
        return [
            'id' => $f->id,
            'farmer_code' => $f->farmer_code,
            'name_bn' => $f->name_bn,
            'name_en' => $f->name_en,
            'father_name' => $f->father_name,
            'nid' => $f->nid,
            'mobile' => $f->mobile,
            'village' => $f->village?->name_bn,
            'mouza' => $f->mouza?->name_bn,
            'is_active' => $f->is_active,
            'member' => $f->member ? ['id' => $f->member->id, 'member_no' => $f->member->member_no, 'status' => $f->member->status] : null,
            'photo_url' => $f->photo ? url("api/farmers/{$f->id}/photo") : null,
            'occupation' => $f->occupation,
            'land_acre' => isset($f->owned_decimal) ? round((float) $f->owned_decimal / 100, 2) : null,
            'pending_application' => (bool) ($f->pending_application ?? false),
        ];
    }
}
