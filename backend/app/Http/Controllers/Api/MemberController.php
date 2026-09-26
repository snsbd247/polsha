<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Models\Member;
use App\Models\MembershipStatusHistory;
use App\Services\MembershipService;
use App\Support\Bn;
use App\Support\CsvExport;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class MemberController extends Controller
{
    public function __construct(private MembershipService $membership) {}

    public function index(Request $request): JsonResponse
    {
        $q = $this->filtered($request)->with([
            'farmer:id,farmer_code,name_bn,name_en,father_name,mobile,nid,photo,occupation,education_level,village_id,mouza_id',
            'farmer.village:id,name_bn', 'farmer.mouza:id,name_bn',
        ]);
        $sort = in_array($request->query('sort'), ['member_no', 'admitted_on'], true) ? $request->query('sort') : 'member_no';
        $q->orderBy($sort, $request->query('order') === 'desc' ? 'desc' : 'asc');

        return response()->json($q->paginate($this->perPage($request))->through(fn (Member $m) => $m->toArray() + [
            'photo_url' => $m->farmer?->photo ? url("api/farmers/{$m->farmer_id}/photo") : null,
        ]));
    }

    /**
     * Header cards: members by status now, new this month, and the change
     * against the end of last month (status then = the last status change
     * effective on or before that day).
     */
    public function summary(): JsonResponse
    {
        $prevEnd = now()->startOfMonth()->subDay()->toDateString();
        $monthStart = now()->startOfMonth()->toDateString();
        $members = Member::get(['id', 'status', 'admitted_on']);
        $history = MembershipStatusHistory::where('effective_date', '<=', $prevEnd)->orderBy('effective_date')->orderBy('id')
            ->get(['member_id', 'to_status'])->groupBy('member_id')->map(fn ($h) => $h->last()->to_status);
        $then = $members->filter(fn ($m) => $m->admitted_on->toDateString() <= $prevEnd)
            ->map(fn ($m) => $history[$m->id] ?? Member::ACTIVE);
        $pct = fn (float $now, float $before) => $before > 0 ? round(($now - $before) / $before * 100, 1) : null;

        $now = ['total' => $members->count(), 'active' => $members->where('status', Member::ACTIVE)->count(), 'inactive' => $members->where('status', Member::INACTIVE)->count()];
        $newNow = $members->filter(fn ($m) => $m->admitted_on->toDateString() >= $monthStart)->count();
        $newBefore = $members->filter(fn ($m) => $m->admitted_on->toDateString() > now()->startOfMonth()->subMonth()->subDay()->toDateString() && $m->admitted_on->toDateString() <= $prevEnd)->count();

        return response()->json($now + [
            'cancelled' => $members->where('status', Member::CANCELLED)->count(),
            'new' => $newNow,
            'change' => [
                'total' => $pct($now['total'], $then->count()),
                'active' => $pct($now['active'], $then->filter(fn ($s) => $s === Member::ACTIVE)->count()),
                'inactive' => $pct($now['inactive'], $then->filter(fn ($s) => $s === Member::INACTIVE)->count()),
                'new' => $pct($newNow, $newBefore),
            ],
        ]);
    }

    public function export(Request $request)
    {
        $rows = $this->filtered($request)->with(['farmer.village:id,name_bn', 'farmer.mouza:id,name_bn'])->orderBy('member_no')->lazy()
            ->map(fn (Member $m) => [
                $m->member_no, $m->farmer->farmer_code, $m->farmer->name_bn, $m->farmer->father_name, $m->farmer->mobile,
                $m->farmer->village?->name_bn, $m->farmer->mouza?->name_bn, $m->admitted_on, __(self::STATUS[$m->status] ?? $m->status),
            ]);

        return CsvExport::download('members-'.now()->format('Ymd').'.csv',
            [__('সদস্য নং'), 'Farmer ID', __('নাম'), __('পিতা'), __('মোবাইল'), __('গ্রাম'), __('মৌজা'), __('ভর্তির তারিখ'), __('অবস্থা')], $rows);
    }

    /** status: deactivate | activate | cancel | reactivate — always goes through approval. */
    public function requestStatusChange(Request $request, Member $member): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', Rule::in(array_keys(MembershipService::STATUS_ACTIONS))],
            'effective_date' => ['required', 'date'],
            'reason_type' => ['nullable', 'required_if:action,cancel', Rule::in(array_keys(config('erp.member.cancel_reasons')))],
            'reason' => ['required', 'string', 'max:1000'],
            'resolution_no' => ['nullable', 'required_if:action,cancel', 'string', 'max:50'],
            'fee' => ['nullable', 'numeric', 'min:0'],
        ], ['resolution_no.required_if' => __('সদস্যপদ বাতিলে সভার সিদ্ধান্ত নম্বর আবশ্যক।'), 'reason_type.required_if' => __('বাতিলের কারণ বাছাই করুন।')]);

        $req = $this->membership->requestStatusChange($member, $data['action'], $data);

        return response()->json([
            'approval_id' => $req->id,
            'status' => $req->status,
            'message' => $req->status === 'approved' ? __('পরিবর্তন সম্পন্ন হয়েছে।') : __('অনুমোদনের জন্য পাঠানো হয়েছে।'),
        ], 201);
    }

    /** Old paper-register member with their original number (member.admin). */
    public function storeLegacy(Request $request): JsonResponse
    {
        $request->merge(['member_no' => Bn::toEnDigits((string) $request->input('member_no'))]);
        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'member_no' => ['required', 'integer', 'min:1', 'unique:members,member_no'],
            'admitted_on' => ['required', 'date', 'before_or_equal:today'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ], ['member_no.unique' => __('এই সদস্য নম্বর ইতিমধ্যে ব্যবহৃত।')]);

        $member = $this->membership->createLegacy(
            Farmer::findOrFail($data['farmer_id']), (int) $data['member_no'], $data['admitted_on'], $data['remarks'] ?? null, $request->user()->id,
        );

        return response()->json($member, 201);
    }

    public function admissionRegister(Request $request): JsonResponse
    {
        return response()->json($this->registerQuery($request)->paginate($this->perPage($request))->through(fn ($m) => $this->registerRow($m)));
    }

    public function admissionRegisterExport(Request $request)
    {
        $rows = $this->registerQuery($request)->lazy()->values()->map(function (Member $m, int $i) {
            $r = $this->registerRow($m);

            return [$i + 1, $r['member_no'], $r['name'], $r['father_name'], $r['address'], $r['admitted_on'], $r['admission_fee'],
                $r['initial_shares'], $r['nominees'], $r['resolution_no'], $r['cancelled_on'], $r['cancel_reason']];
        });

        return CsvExport::download('admission-register-'.now()->format('Ymd').'.csv',
            [__('ক্রমিক'), __('সদস্য নং'), __('নাম'), __('পিতা'), __('ঠিকানা'), __('ভর্তির তারিখ'), __('ভর্তি ফি'), __('প্রাথমিক শেয়ার'), __('নমিনি'), __('সভার সিদ্ধান্ত নং'), __('বাতিলের তারিখ'), __('বাতিলের কারণ')], $rows);
    }

    private const STATUS = ['active' => 'সক্রিয়', 'inactive' => 'নিষ্ক্রিয়', 'cancelled' => 'বাতিল'];

    private function filtered(Request $request): Builder
    {
        $q = Member::query();
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(function ($w) use ($search, $en) {
                if (ctype_digit($en)) {
                    $w->orWhere('member_no', (int) $en);
                }
                $w->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")
                    ->orWhere('name_en', 'like', "%$search%")
                    ->orWhere('father_name', 'like', "%$search%")
                    ->orWhere('farmer_code', 'like', "%$en%")
                    ->orWhere('mobile', 'like', "%$en%")
                    ->orWhere('nid', $en));
            });
        }
        if ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }
        foreach (['mouza_id', 'village_id', 'occupation', 'education_level'] as $f) {
            if ($request->filled($f)) {
                $q->whereHas('farmer', fn ($w) => $w->where($f, $request->query($f)));
            }
        }
        if ($request->filled('from')) {
            $q->where('admitted_on', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('admitted_on', '<=', $request->date('to')->toDateString());
        }

        return $q;
    }

    private function registerQuery(Request $request): Builder
    {
        $q = Member::query()->with([
            'farmer.village.union.upazila', 'application:id,admission_fee,initial_shares,resolution_no',
            'nominees', 'history' => fn ($h) => $h->where('action', 'cancel'),
        ]);
        if ($request->filled('from')) {
            $q->where('admitted_on', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('admitted_on', '<=', $request->date('to')->toDateString());
        }

        return $q->orderBy('admitted_on')->orderBy('member_no');
    }

    private function registerRow(Member $m): array
    {
        $v = $m->farmer->village;
        $cancel = $m->history->first();

        return [
            'id' => $m->id,
            'farmer_id' => $m->farmer_id,
            'member_no' => $m->member_no,
            'name' => $m->farmer->name_bn,
            'father_name' => $m->farmer->father_name,
            'address' => implode(', ', array_filter([$v?->name_bn, $v?->union?->name_bn, $v?->union?->upazila?->name_bn])),
            'admitted_on' => $m->admitted_on->toDateString(),
            'admission_fee' => $m->application?->admission_fee,
            'initial_shares' => $m->application?->initial_shares,
            'nominees' => $m->nominees->map(fn ($n) => "{$n->name} ({$n->relation})")->implode(', '),
            'resolution_no' => $m->application?->resolution_no,
            'is_legacy' => $m->is_legacy,
            'status' => $m->status,
            'cancelled_on' => $m->status === Member::CANCELLED ? $cancel?->effective_date?->toDateString() : null,
            'cancel_reason' => $m->status === Member::CANCELLED ? $cancel?->reason : null,
        ];
    }
}
