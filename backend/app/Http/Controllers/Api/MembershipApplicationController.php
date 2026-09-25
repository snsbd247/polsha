<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Models\MembershipApplication;
use App\Services\ImageService;
use App\Services\MembershipService;
use App\Services\SequenceService;
use App\Services\SettingService;
use App\Support\Bn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MembershipApplicationController extends Controller
{
    public function __construct(private MembershipService $membership) {}

    public function index(Request $request): JsonResponse
    {
        $q = MembershipApplication::query()->with(['farmer:id,farmer_code,name_bn,father_name,mouza_id,village_id', 'farmer.village:id,name_bn', 'member:id,member_no']);

        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('application_no', 'like', "%$en%")
                ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('farmer_code', 'like', "%$en%")));
        }
        if ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }
        if ($request->filled('mouza_id')) {
            $q->whereHas('farmer', fn ($f) => $f->where('mouza_id', $request->query('mouza_id')));
        }
        if ($request->filled('from')) {
            $q->where('applied_on', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('applied_on', '<=', $request->date('to')->toDateString());
        }

        return response()->json($q->latest('id')->paginate($this->perPage($request)));
    }

    public function show(MembershipApplication $application): JsonResponse
    {
        return response()->json($application->load([
            'farmer:id,farmer_code,name_bn,father_name,village_id', 'farmer.village:id,name_bn',
            'nominees', 'proposer.farmer:id,name_bn', 'seconder.farmer:id,name_bn',
            'member:id,member_no', 'creator:id,name_bn', 'approvalRequest:id,status,current_step,total_steps',
        ]));
    }

    /** Defaults for a new form. */
    public function defaults(): JsonResponse
    {
        return response()->json([
            'admission_fee' => (float) SettingService::get('admission_fee', 0),
            'share_unit_price' => (float) SettingService::get('share_unit_price', 10) ?: 10.0,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $this->membership->assertFarmerCanApply(Farmer::findOrFail($data['farmer_id']));

        $app = DB::transaction(function () use ($request, $data) {
            $app = MembershipApplication::create($this->columns($request, $data) + [
                'application_no' => SequenceService::next('membership_application'),
                'status' => 'draft',
                'created_by' => $request->user()->id,
            ]);
            $app->nominees()->createMany($data['nominees']);
            $this->updateFarmer($request, $data, $app->farmer);

            return $app;
        });

        if ($request->boolean('submit')) {
            $app = $this->membership->submitApplication($app);
        }

        return response()->json($app->fresh(), 201);
    }

    public function update(Request $request, MembershipApplication $application): JsonResponse
    {
        $this->assertEditable($application);
        $data = $this->validated($request, $application);
        if ((int) $data['farmer_id'] !== $application->farmer_id) {
            $this->membership->assertFarmerCanApply(Farmer::findOrFail($data['farmer_id']), $application->id);
        }

        DB::transaction(function () use ($request, $application, $data) {
            $application->update($this->columns($request, $data, $application));
            $application->nominees()->delete();
            $application->nominees()->createMany($data['nominees']);
            $this->updateFarmer($request, $data, $application->fresh()->farmer);
        });

        if ($request->boolean('submit')) {
            $application = $this->membership->submitApplication($application->fresh());
        }

        return response()->json($application->fresh());
    }

    public function submit(MembershipApplication $application): JsonResponse
    {
        return response()->json($this->membership->submitApplication($application));
    }

    public function cancel(MembershipApplication $application): JsonResponse
    {
        $this->assertEditable($application);
        $application->update(['status' => 'cancelled']);

        return response()->json($application);
    }

    /** kind = form_scan | signature */
    public function file(MembershipApplication $application, string $kind)
    {
        abort_unless(in_array($kind, ['form_scan', 'signature'], true), 404);
        $path = $application->{$kind};
        abort_unless($path && Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path);
    }

    private function assertEditable(MembershipApplication $app): void
    {
        if (! in_array($app->status, MembershipApplication::EDITABLE, true)) {
            throw ValidationException::withMessages(['status' => __('শুধু খসড়া বা ফেরত আসা আবেদন সম্পাদনা করা যায়।')]);
        }
    }

    private function validated(Request $request, ?MembershipApplication $app = null): array
    {
        // Nominees arrive as JSON when the request is multipart (file uploads).
        if (is_string($request->input('nominees'))) {
            $request->merge(['nominees' => json_decode($request->input('nominees'), true) ?: []]);
        }
        $request->merge(['nominees' => collect($request->input('nominees', []))->map(fn ($n) => array_merge($n, [
            'nid' => Bn::toEnDigits($n['nid'] ?? null) ?: null,
            'mobile' => Bn::toEnDigits($n['mobile'] ?? null) ?: null,
        ]))->all()]);

        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'applied_on' => ['required', 'date', 'before_or_equal:today'],
            'proposer_member_id' => ['nullable', Rule::exists('members', 'id')->where('status', 'active')],
            'seconder_member_id' => ['nullable', 'different:proposer_member_id', Rule::exists('members', 'id')->where('status', 'active')],
            'admission_fee' => ['required', 'numeric', 'min:0'],
            'fee_override_reason' => ['nullable', 'string', 'max:500'],
            'fee_status' => ['required', Rule::in(['paid', 'due'])],
            'initial_shares' => ['nullable', 'integer', 'min:0'],
            'resolution_no' => ['nullable', 'string', 'max:50'],
            'resolution_date' => ['nullable', 'date'],
            'form_scan' => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'signature' => ['nullable', 'image', 'max:2048'],
            'remarks' => ['nullable', 'string', 'max:300'],
            // farmer's own papers and details, kept on the farmer record
            'nid_front' => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'nid_back' => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'photo' => ['nullable', 'image', 'max:2048'],
            'occupation' => ['nullable', Rule::in(array_keys(config('erp.farmer.occupations')))],
            'education_level' => ['nullable', Rule::in(array_keys(config('erp.farmer.education_levels')))],
            'blood_group' => ['nullable', Rule::in(array_keys(config('erp.farmer.blood_groups')))],
            'nominees' => ['required', 'array', 'min:1'],
            'nominees.*.name' => ['required', 'string', 'max:150'],
            'nominees.*.relation' => ['required', 'string', 'max:30'],
            'nominees.*.nid' => ['nullable', 'regex:/^(\d{10}|\d{13}|\d{17})$/'],
            'nominees.*.mobile' => ['nullable', 'regex:/^01[3-9]\d{8}$/'],
            'nominees.*.share_percent' => ['required', 'numeric', 'min:0.01', 'max:100'],
        ], [
            'applied_on.before_or_equal' => __('আবেদনের তারিখ ভবিষ্যতের হতে পারবে না।'),
            'nominees.required' => __('কমপক্ষে একজন নমিনি দিন।'),
            'seconder_member_id.different' => __('প্রস্তাবক ও সমর্থক একই ব্যক্তি হতে পারবেন না।'),
        ]);

        $total = round(collect($data['nominees'])->sum('share_percent'), 2);
        if (abs($total - 100) > 0.001) {
            throw ValidationException::withMessages(['nominees' => __('নমিনিদের অংশের যোগফল ১০০% হতে হবে (এখন :p0%)।', ['p0' => $total])]);
        }

        // Fee differs from the configured default → a reason is mandatory.
        $default = $app ? (float) $app->default_fee : (float) SettingService::get('admission_fee', 0);
        if (abs((float) $data['admission_fee'] - $default) > 0.001 && blank($data['fee_override_reason'] ?? null)) {
            throw ValidationException::withMessages(['fee_override_reason' => __('নির্ধারিত ফি থেকে ভিন্ন হলে কারণ লেখা আবশ্যক।')]);
        }
        $data['default_fee'] = $default;

        return $data;
    }

    private const FARMER_FIELDS = ['nid_front', 'nid_back', 'photo', 'occupation', 'education_level', 'blood_group'];

    /**
     * The application form also collects the farmer's NID copies, photo and a
     * few profile fields; they belong to the farmer, not to the application.
     */
    private function updateFarmer(Request $request, array $data, Farmer $farmer): void
    {
        $fields = collect($data)->only(['occupation', 'education_level', 'blood_group'])->filter(fn ($v) => $v !== null)->all();
        if ($request->hasFile('photo')) {
            $old = $farmer->photo;
            $fields['photo'] = ImageService::storeCompressed($request->file('photo'), 'farmers');
            if ($old) {
                Storage::disk('local')->delete($old);
            }
        }
        if ($fields) {
            $farmer->update($fields);
        }
        foreach (['nid_front', 'nid_back'] as $type) {
            if ($file = $request->file($type)) {
                $farmer->documents()->create([
                    'type' => $type,
                    'path' => $file->store("farmer-docs/{$farmer->id}", 'local'),
                    'original_name' => mb_substr($file->getClientOriginalName(), 0, 250),
                    'mime' => $file->getMimeType(),
                    'size' => $file->getSize(),
                    'uploaded_by' => $request->user()->id,
                ]);
            }
        }
    }

    private function columns(Request $request, array $data, ?MembershipApplication $app = null): array
    {
        $cols = collect($data)->except(['nominees', 'form_scan', 'signature', ...self::FARMER_FIELDS])->all();
        if ($request->hasFile('form_scan')) {
            $cols['form_scan'] = $request->file('form_scan')->store('membership', 'local');
        }
        if ($request->hasFile('signature')) {
            $cols['signature'] = ImageService::storeCompressed($request->file('signature'), 'membership', 600);
        }

        return $cols;
    }
}
