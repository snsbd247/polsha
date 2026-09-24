<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Farmer;
use App\Models\Household;
use App\Models\Mouza;
use App\Services\FarmerDuplicateService;
use App\Services\ImageService;
use App\Services\SequenceService;
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
    public function __construct(private FarmerDuplicateService $duplicates) {}

    public function meta(): JsonResponse
    {
        return response()->json(Tr::map(config('erp.farmer')) + ['cancel_reasons' => Tr::map(config('erp.member.cancel_reasons'))]);
    }

    public function index(Request $request): JsonResponse
    {
        $q = $this->filtered($request)->with(['village:id,name_bn', 'mouza:id,name_bn', 'member:id,farmer_id,member_no,status']);

        $sort = in_array($request->query('sort'), ['farmer_code', 'name_bn', 'created_at'], true) ? $request->query('sort') : 'id';
        $q->orderBy($sort, $request->query('order') === 'asc' ? 'asc' : 'desc');

        return response()->json($q->paginate($this->perPage($request))->through(fn ($f) => $this->row($f)));
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
            'para' => $farmer->para,
            'post_office' => $farmer->post_office,
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
        $this->guardDuplicates($request, $data);

        $farmer = DB::transaction(function () use ($request, $data) {
            $data['farmer_code'] = SequenceService::next('farmer');
            $data['created_by'] = $request->user()->id;
            if ($request->hasFile('photo')) {
                $data['photo'] = ImageService::storeCompressed($request->file('photo'), 'farmers');
            }
            $farmer = Farmer::create($data);
            $this->attachNewHousehold($request, $farmer);

            return $farmer;
        });

        return response()->json(['id' => $farmer->id, 'farmer_code' => $farmer->farmer_code], 201);
    }

    public function update(Request $request, Farmer $farmer): JsonResponse
    {
        abort_if($farmer->merged_into_id, 422, __('মার্জ হয়ে যাওয়া রেকর্ড সম্পাদনা করা যায় না।'));
        $data = $this->validated($request, $farmer);
        $this->guardDuplicates($request, $data, $farmer->id);

        DB::transaction(function () use ($request, $farmer, $data) {
            if ($request->hasFile('photo')) {
                $old = $farmer->photo;
                $data['photo'] = ImageService::storeCompressed($request->file('photo'), 'farmers');
                if ($old) {
                    Storage::disk('local')->delete($old);
                }
            }
            $farmer->update($data);
            $this->attachNewHousehold($request, $farmer);
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
        $reason = $request->validate(['reason' => ['nullable', 'string', 'max:300']])['reason'] ?? null;
        if ($farmer->member()->exists() || $farmer->applications()->exists()) {
            throw ValidationException::withMessages(['farmer' => __('সদস্যপদ বা আবেদন আছে এমন কৃষক মুছা যাবে না; নিষ্ক্রিয় করুন।')]);
        }
        $farmer->delete();
        if ($reason) {
            AuditLog::where('auditable_type', 'Farmer')->where('auditable_id', $farmer->id)->where('action', 'delete')
                ->latest('id')->first()?->update(['description' => $reason]);
        }

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    /** Deleted (soft) farmers with who deleted them, when and why. */
    public function deleted(Request $request): JsonResponse
    {
        $q = Farmer::onlyTrashed()->with(['village:id,name_bn,name_en', 'mouza:id,name_bn,name_en'])->latest('deleted_at');
        if ($s = $request->query('q')) {
            $s = Bn::toEnDigits($s);
            $q->where(fn ($w) => $w->where('name_bn', 'like', "%$s%")->orWhere('name_en', 'like', "%$s%")
                ->orWhere('farmer_code', 'like', "%$s%")->orWhere('mobile', 'like', "%$s%")->orWhere('nid', 'like', "%$s%"));
        }
        $page = $q->paginate($this->perPage($request));
        $logs = AuditLog::with('user:id,name_bn,name_en')->where('auditable_type', 'Farmer')
            ->whereIn('auditable_id', $page->getCollection()->pluck('id'))->where('action', 'delete')->latest('id')->get()->unique('auditable_id')->keyBy('auditable_id');
        $page->getCollection()->transform(fn (Farmer $f) => $f->only(['id', 'farmer_code', 'name_bn', 'name_en', 'father_name', 'mobile', 'nid', 'deleted_at'])
            + ['village' => $f->village, 'mouza' => $f->mouza, 'deleted_by' => $logs[$f->id]->user ?? null, 'reason' => $logs[$f->id]->description ?? null]);

        return response()->json($page);
    }

    public function restore(int $id): JsonResponse
    {
        $farmer = Farmer::onlyTrashed()->findOrFail($id);
        if ($farmer->nid && Farmer::where('nid', $farmer->nid)->exists()) {
            throw ValidationException::withMessages(['farmer' => __('এই NID দিয়ে আরেকজন সক্রিয় কৃষক আছে; আগে সেটি যাচাই করুন।')]);
        }
        $farmer->restore();

        return response()->json(['id' => $farmer->id, 'message' => __('কৃষক পুনরুদ্ধার করা হয়েছে।')]);
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
        $digits = ['nid', 'birth_reg_no', 'mobile', 'alt_mobile'];
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
            'village_id' => ['required', 'exists:villages,id'],
            'mouza_id' => ['required', 'exists:mouzas,id'],
            'para' => ['nullable', 'string', 'max:150'],
            'post_office' => ['nullable', 'string', 'max:100'],
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
        ]);

        $linked = Mouza::whereKey($data['mouza_id'])->whereHas('villages', fn ($v) => $v->where('villages.id', $data['village_id']))->exists();
        if (! $linked) {
            throw ValidationException::withMessages(['mouza_id' => __('এই মৌজা বাছাই করা গ্রামের সাথে যুক্ত নয়। মৌজা পাতায় গ্রাম যুক্ত করুন।')]);
        }
        unset($data['photo']);

        return $data;
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
        ];
    }
}
