<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Models\Member;
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
        $q = $this->filtered($request)->with(['farmer:id,farmer_code,name_bn,father_name,mobile,village_id,mouza_id', 'farmer.village:id,name_bn', 'farmer.mouza:id,name_bn']);
        $sort = in_array($request->query('sort'), ['member_no', 'admitted_on'], true) ? $request->query('sort') : 'member_no';
        $q->orderBy($sort, $request->query('order') === 'desc' ? 'desc' : 'asc');

        return response()->json($q->paginate($this->perPage($request)));
    }

    public function export(Request $request)
    {
        $rows = $this->filtered($request)->with(['farmer.village:id,name_bn', 'farmer.mouza:id,name_bn'])->orderBy('member_no')->lazy()
            ->map(fn (Member $m) => [
                $m->member_no, $m->farmer->farmer_code, $m->farmer->name_bn, $m->farmer->father_name, $m->farmer->mobile,
                $m->farmer->village?->name_bn, $m->farmer->mouza?->name_bn, $m->admitted_on, self::STATUS[$m->status] ?? $m->status,
            ]);

        return CsvExport::download('members-'.now()->format('Ymd').'.csv',
            ['সদস্য নং', 'Farmer ID', 'নাম', 'পিতা', 'মোবাইল', 'গ্রাম', 'মৌজা', 'ভর্তির তারিখ', 'অবস্থা'], $rows);
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
        ], ['resolution_no.required_if' => 'সদস্যপদ বাতিলে সভার সিদ্ধান্ত নম্বর আবশ্যক।', 'reason_type.required_if' => 'বাতিলের কারণ বাছাই করুন।']);

        $req = $this->membership->requestStatusChange($member, $data['action'], $data);

        return response()->json([
            'approval_id' => $req->id,
            'status' => $req->status,
            'message' => $req->status === 'approved' ? 'পরিবর্তন সম্পন্ন হয়েছে।' : 'অনুমোদনের জন্য পাঠানো হয়েছে।',
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
        ], ['member_no.unique' => 'এই সদস্য নম্বর ইতিমধ্যে ব্যবহৃত।']);

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
            ['ক্রমিক', 'সদস্য নং', 'নাম', 'পিতা', 'ঠিকানা', 'ভর্তির তারিখ', 'ভর্তি ফি', 'প্রাথমিক শেয়ার', 'নমিনি', 'সভার সিদ্ধান্ত নং', 'বাতিলের তারিখ', 'বাতিলের কারণ'], $rows);
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
                    ->orWhere('father_name', 'like', "%$search%")
                    ->orWhere('farmer_code', 'like', "%$en%")
                    ->orWhere('mobile', 'like', "%$en%"));
            });
        }
        if ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }
        foreach (['mouza_id', 'village_id'] as $f) {
            if ($request->filled($f)) {
                $q->whereHas('farmer', fn ($w) => $w->where($f, $request->query($f)));
            }
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
