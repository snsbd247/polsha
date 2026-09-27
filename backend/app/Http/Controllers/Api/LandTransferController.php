<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Land;
use App\Models\LandTransfer;
use App\Services\LandTransferService;
use App\Services\SequenceService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** The land-transfer form: drafts, submission for approval, and the list of open transfers. */
class LandTransferController extends Controller
{
    public function __construct(private LandTransferService $transfers) {}

    public function meta(): JsonResponse
    {
        return response()->json(['types' => Tr::map(LandTransfer::TYPES), 'reasons' => Tr::map(LandTransfer::REASONS)]);
    }

    /** Every transfer — drafts, waiting, approved and rejected — with search and filters. */
    public function index(Request $request)
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $q = LandTransfer::query()->join('lands', 'lands.id', '=', 'land_transfers.land_id')->leftJoin('mouzas', 'mouzas.id', '=', 'lands.mouza_id')
            ->select('land_transfers.*')
            ->with(['land:id,land_code,dag_no,khatian_no,area_decimal,mouza_id', 'land.mouza:id,name_bn',
                'fromFarmer:id,farmer_code,name_bn,name_en,photo', 'toFarmer:id,farmer_code,name_bn,name_en,photo']);
        if ($s = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($s);
            $people = fn ($col) => fn ($w) => $w->whereIn("land_transfers.$col", DB::table('farmers')
                ->where(fn ($f) => $f->where('name_bn', 'like', "%$s%")->orWhere('name_en', 'like', "%$s%")->orWhere('farmer_code', 'like', "%$en%"))->select('id'));
            $q->where(fn ($w) => $w->where('lands.land_code', 'like', "%$en%")->orWhere('lands.dag_no', $en)->orWhere('land_transfers.transfer_no', 'like', "%$en%")
                ->orWhere('mouzas.name_bn', 'like', "%$s%")->orWhere($people('from_farmer_id'))->orWhere($people('to_farmer_id')));
        }
        if ($request->filled('status')) {
            $q->whereIn('land_transfers.status', explode(',', (string) $request->query('status')));
        }
        foreach (['type', 'reason'] as $f) {
            if ($request->filled($f)) {
                $q->where("land_transfers.$f", $request->query($f));
            }
        }
        if ($request->filled('mouza_id')) {
            $q->where('lands.mouza_id', $request->integer('mouza_id'));
        }
        if ($request->filled('upazila_id')) {
            $q->where('mouzas.upazila_id', $request->integer('upazila_id'));
        }
        if ($request->filled('district_id')) {
            $q->whereIn('mouzas.upazila_id', DB::table('upazilas')->where('district_id', $request->integer('district_id'))->select('id'));
        }
        if ($request->filled('from')) {
            $q->where('land_transfers.transfer_date', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('land_transfers.transfer_date', '<=', $request->date('to')->toDateString());
        }
        $q->orderByDesc('land_transfers.transfer_date')->orderByDesc('land_transfers.id');

        $row = fn (LandTransfer $t) => $t->toArray() + [
            'from_photo_url' => $t->fromFarmer?->photo ? url("api/farmers/{$t->from_farmer_id}/photo") : null,
            'to_photo_url' => $t->toFarmer?->photo ? url("api/farmers/{$t->to_farmer_id}/photo") : null,
        ];
        if ($request->query('export') === 'csv') {
            $reasons = LandTransfer::REASONS;
            $statuses = ['draft' => 'খসড়া', 'pending' => 'অনুমোদনের অপেক্ষায়', 'approved' => 'অনুমোদিত', 'rejected' => 'প্রত্যাখ্যাত'];

            return CsvExport::download('land-transfers.csv',
                [__('হস্তান্তর নং'), __('জমির নং'), __('মৌজা'), __('দাগ নং'), __('বর্তমান মালিক'), __('নতুন মালিক'), __('তারিখ'), __('ধরন'), __('কারণ'), __('অংশ %'), __('টাকা'), __('অবস্থা')],
                $q->lazy()->map(fn (LandTransfer $t) => [$t->transfer_no, $t->land?->land_code, $t->land?->mouza?->name_bn, $t->land?->dag_no, $t->fromFarmer?->name_bn, $t->toFarmer?->name_bn,
                    $t->transfer_date?->toDateString(), __(LandTransfer::TYPES[$t->type] ?? $t->type), __($reasons[$t->reason] ?? $t->reason), $t->share_percent, $t->amount, __($statuses[$t->status] ?? $t->status)]));
        }

        return response()->json($q->paginate($this->perPage($request))->through($row));
    }

    public function summary(): JsonResponse
    {
        $by = LandTransfer::groupBy('status')->selectRaw('status, count(*) as c')->pluck('c', 'status');

        return response()->json([
            'total' => (int) $by->sum(),
            'approved' => (int) ($by['approved'] ?? 0),
            'pending' => (int) ($by['pending'] ?? 0),
            'rejected' => (int) ($by['rejected'] ?? 0),
            'draft' => (int) ($by['draft'] ?? 0),
        ]);
    }

    public function show(LandTransfer $landTransfer): JsonResponse
    {
        return response()->json($landTransfer->load(['land:id,land_code', 'fromFarmer:id,farmer_code,name_bn,name_en', 'toFarmer:id,farmer_code,name_bn,name_en']));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $t = DB::transaction(fn () => LandTransfer::create($data + ['transfer_no' => SequenceService::next('land_transfer'), 'status' => 'draft', 'created_by' => $request->user()->id]));

        return $this->finish($request, $t, 201);
    }

    public function update(Request $request, LandTransfer $landTransfer): JsonResponse
    {
        if (! in_array($landTransfer->status, ['draft', 'rejected'], true)) {
            throw ValidationException::withMessages(['status' => __('পাঠানো হস্তান্তর আর বদলানো যায় না।')]);
        }
        $landTransfer->update($this->validated($request));

        return $this->finish($request, $landTransfer, 200);
    }

    public function destroy(LandTransfer $landTransfer): JsonResponse
    {
        abort_unless(in_array($landTransfer->status, ['draft', 'rejected'], true), 422, __('পাঠানো হস্তান্তর মুছা যায় না।'));
        $landTransfer->delete();

        return response()->json(['message' => __('মুছে ফেলা হয়েছে।')]);
    }

    /** Saved as a draft, or sent for approval straight away (submit=1). */
    private function finish(Request $request, LandTransfer $t, int $status): JsonResponse
    {
        $t->refresh();
        if ($request->boolean('submit')) {
            $req = $this->transfers->submit($t);
            $t->refresh();

            return response()->json($t->toArray() + [
                'approval_id' => $req->id,
                'message' => $t->status === 'approved' ? __('হস্তান্তর সম্পন্ন হয়েছে।') : __('হস্তান্তর অনুমোদনের জন্য পাঠানো হয়েছে।'),
            ], $status);
        }

        return response()->json($t->toArray() + ['message' => __('খসড়া সংরক্ষণ হয়েছে।')], $status);
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'land_id' => ['required', Rule::exists('lands', 'id')->whereNull('deleted_at')],
            'from_farmer_id' => ['required', 'exists:farmers,id'],
            'to_farmer_id' => ['required', 'exists:farmers,id', 'different:from_farmer_id'],
            'type' => ['required', Rule::in(array_keys(LandTransfer::TYPES))],
            'share_percent' => ['required_if:type,partial', 'nullable', 'numeric', 'gt:0', 'max:100'],
            'reason' => ['required', Rule::in(array_keys(LandTransfer::REASONS))],
            'transfer_date' => ['required', 'date', 'before_or_equal:today'],
            'amount' => ['nullable', 'numeric', 'min:0'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ], ['to_farmer_id.different' => __('একই কৃষকের কাছে হস্তান্তর করা যায় না।')]);

        // a full transfer hands over everything the seller owns now
        if ($data['type'] === 'full') {
            $share = Land::findOrFail($data['land_id'])->owners()->where('farmer_id', $data['from_farmer_id'])->value('share_percent');
            if ($share === null) {
                throw ValidationException::withMessages(['from_farmer_id' => __('এই কৃষক এখন এই জমির মালিক নন।')]);
            }
            $data['share_percent'] = (float) $share;
        }

        return $data;
    }
}
