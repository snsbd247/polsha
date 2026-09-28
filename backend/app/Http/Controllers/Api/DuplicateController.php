<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\Farmer;
use App\Models\Member;
use App\Models\User;
use App\Services\FarmerDuplicateService;
use App\Services\FarmerMergeService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\Rule;

class DuplicateController extends Controller
{
    public function __construct(private FarmerDuplicateService $duplicates, private FarmerMergeService $merge) {}

    public function index(Request $request): JsonResponse
    {
        $pairs = $this->duplicates->pairs();
        $perPage = $this->perPage($request);
        $page = max(1, $request->integer('page', 1));

        return response()->json(new LengthAwarePaginator($pairs->forPage($page, $perPage)->values(), $pairs->count(), $perPage, $page));
    }

    public function dismiss(Request $request): JsonResponse
    {
        $data = $request->validate([
            'a' => ['required', 'exists:farmers,id'],
            'b' => ['required', 'exists:farmers,id', 'different:a'],
        ]);
        $this->duplicates->dismiss($data['a'], $data['b'], $request->user()->id);

        return response()->json(['message' => __('এই জোড়া আর ডুপ্লিকেট হিসেবে দেখাবে না।')]);
    }

    /** Side-by-side data for the merge screen; either side may still be empty. */
    public function compare(Request $request): JsonResponse
    {
        $ids = $request->validate(['a' => ['nullable', 'integer'], 'b' => ['nullable', 'integer']]);
        $load = function ($id) {
            if (! $id) {
                return null;
            }
            $f = Farmer::with(['village:id,name_bn', 'mouza:id,name_bn', 'member:id,farmer_id,member_no,status', 'household:id,code'])
                ->withCount('documents')->findOrFail($id);

            return $f->toArray() + [
                'photo_url' => $f->photo ? url("api/farmers/{$f->id}/photo") : null,
                'related' => FarmerMergeService::related($f),
            ];
        };

        return response()->json([
            'a' => $load($ids['a'] ?? null),
            'b' => $load($ids['b'] ?? null),
            'fields' => FarmerMergeService::MERGEABLE,
        ]);
    }

    public function mergeMeta(): JsonResponse
    {
        $users = User::whereIn('id', ApprovalRequest::where('action_key', 'farmer.merge')->select('requested_by'))->orderBy('name_bn')->get(['id', 'name_bn', 'name_en']);

        return response()->json(['reasons' => Tr::map(FarmerMergeService::REASONS), 'requesters' => $users]);
    }

    /** Merge requests, newest first, with both records, reason and outcome. */
    public function history(Request $request)
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $q = ApprovalRequest::where('action_key', 'farmer.merge')->with('requester.roles')->latest('id');
        if ($s = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($s);
            $ids = Farmer::withTrashed()->where(fn ($w) => $w->where('name_bn', 'like', "%$s%")->orWhere('name_en', 'like', "%$s%")
                ->orWhere('farmer_code', 'like', "%$en%")->orWhere('nid', 'like', "%$en%")->orWhere('mobile', 'like', "%$en%")
                ->orWhereIn('id', Member::where('member_no', $en)->select('farmer_id')))->pluck('id')->all();
            // payloads are JSON, so the farmer and number match happens in PHP
            $match = ApprovalRequest::where('action_key', 'farmer.merge')->get(['id', 'payload'])->filter(fn ($r) => str_contains(strtolower($r->payload['request_no'] ?? ''), strtolower($en))
                || in_array($r->payload['keep_id'] ?? 0, $ids) || in_array($r->payload['remove_id'] ?? 0, $ids)
                || in_array($en, array_filter([$r->payload['snapshot']['keep']['nid'] ?? null, $r->payload['snapshot']['remove']['nid'] ?? null]), true))->pluck('id');
            $q->whereIn('id', $match);
        }
        if ($request->filled('status')) {
            $q->whereIn('status', explode(',', (string) $request->query('status')));
        }
        if ($request->filled('requested_by')) {
            $q->where('requested_by', $request->integer('requested_by'));
        }
        if ($request->filled('from')) {
            $q->whereDate('created_at', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->whereDate('created_at', '<=', $request->date('to')->toDateString());
        }

        $user = $request->user();
        $row = function (ApprovalRequest $r) use ($user) {
            $side = function (string $which) use ($r) {
                $f = Farmer::withTrashed()->select('id', 'farmer_code', 'name_bn', 'name_en', 'nid', 'photo')->find($r->payload[$which.'_id'] ?? 0);
                if (! $f) {
                    return null;
                }
                $snap = $r->payload['snapshot'][$which] ?? [];

                return ['id' => $f->id, 'farmer_code' => $f->farmer_code, 'name_bn' => $f->name_bn, 'name_en' => $f->name_en,
                    'nid' => $snap['nid'] ?? $f->nid, 'member_no' => $snap['member_no'] ?? null,
                    'photo_url' => $f->photo ? url("api/farmers/{$f->id}/photo") : null];
            };
            $role = $r->requester?->roles->first();

            return [
                'id' => $r->id,
                'request_no' => $r->payload['request_no'] ?? '#'.$r->id,
                'status' => $r->status,
                'created_at' => $r->created_at,
                'requested_by' => $r->requester?->name_bn,
                'requester' => $r->requester ? ['id' => $r->requester->id, 'name_bn' => $r->requester->name_bn, 'name_en' => $r->requester->name_en, 'role' => Tr::label($role?->label)] : null,
                'reason' => $r->payload['reason'] ?? null,
                'reason_note' => $r->payload['reason_note'] ?? null,
                'keep' => $side('keep'),
                'remove' => $side('remove'),
                // the sender (or a Super Admin) may still change or withdraw a waiting request
                'can_change' => $r->status === ApprovalRequest::PENDING && ($r->requested_by === $user->id || $user->hasRole('super_admin')),
            ];
        };

        if ($request->query('export') === 'csv') {
            $reasons = FarmerMergeService::REASONS;
            $status = ['pending' => 'অপেক্ষমাণ', 'approved' => 'মার্জ সম্পন্ন', 'rejected' => 'প্রত্যাখ্যাত', 'returned' => 'ফেরত'];

            return CsvExport::download('farmer-merges.csv',
                [__('অনুরোধ নং'), __('কৃষক ১ (রাখা হবে)'), __('কৃষক ২ (মার্জ হবে)'), __('কারণ'), __('অনুরোধকারী'), __('অনুরোধের তারিখ'), __('অবস্থা')],
                $q->lazy()->map(function (ApprovalRequest $r) use ($row, $reasons, $status) {
                    $x = $row($r);

                    return [$x['request_no'], $x['keep'] ? "{$x['keep']['name_bn']} ({$x['keep']['farmer_code']})" : '', $x['remove'] ? "{$x['remove']['name_bn']} ({$x['remove']['farmer_code']})" : '',
                        $x['reason'] ? __($reasons[$x['reason']] ?? $x['reason']) : '', $x['requested_by'], $r->created_at?->toDateString(), __($status[$r->status] ?? $r->status)];
                }));
        }

        return response()->json($q->paginate($this->perPage($request))->through($row));
    }

    public function mergeSummary(): JsonResponse
    {
        $by = ApprovalRequest::where('action_key', 'farmer.merge')->groupBy('status')->selectRaw('status, count(*) as c')->pluck('c', 'status');

        return response()->json([
            'total' => (int) $by->sum(),
            'merged' => (int) ($by['approved'] ?? 0),
            'pending' => (int) (($by['pending'] ?? 0) + ($by['returned'] ?? 0)),
            'rejected' => (int) ($by['rejected'] ?? 0),
        ]);
    }

    /** Change a waiting request: it is replaced by a new one with the same number. */
    public function updateMerge(Request $request, ApprovalRequest $approval): JsonResponse
    {
        $this->assertCanChange($request, $approval);
        $data = $this->mergeData($request);
        $req = $this->merge->replace($approval, Farmer::findOrFail($data['keep_id']), Farmer::findOrFail($data['remove_id']), $data['choices'],
            $data['transfer'], $data['reason'], $data['reason_note']);

        return $this->merged($req, 200);
    }

    public function destroyMerge(Request $request, ApprovalRequest $approval): JsonResponse
    {
        $this->assertCanChange($request, $approval);
        $this->merge->withdraw($approval);

        return response()->json(['message' => __('মার্জ অনুরোধ মুছে ফেলা হয়েছে।')]);
    }

    private function assertCanChange(Request $request, ApprovalRequest $approval): void
    {
        abort_unless($approval->action_key === 'farmer.merge', 404);
        abort_unless($approval->requested_by === $request->user()->id || $request->user()->hasRole('super_admin'), 403, __('শুধু অনুরোধকারী এটি বদলাতে বা মুছতে পারেন।'));
    }

    private function mergeData(Request $request): array
    {
        $data = $request->validate([
            'keep_id' => ['required', 'exists:farmers,id'],
            'remove_id' => ['required', 'exists:farmers,id', 'different:keep_id'],
            'choices' => ['array'],
            'choices.*' => [Rule::in(['keep', 'remove'])],
            'transfer' => ['nullable', 'array'],
            'transfer.*' => [Rule::in(FarmerMergeService::TRANSFERABLE)],
            'reason' => ['nullable', Rule::in(array_keys(FarmerMergeService::REASONS))],
            'reason_note' => ['nullable', 'string', 'max:255'],
        ]);

        return [
            'keep_id' => $data['keep_id'],
            'remove_id' => $data['remove_id'],
            'choices' => array_intersect_key($data['choices'] ?? [], array_flip(FarmerMergeService::MERGEABLE)),
            'transfer' => $request->has('transfer') ? ($data['transfer'] ?? []) : null,
            'reason' => $data['reason'] ?? 'duplicate',
            'reason_note' => $data['reason_note'] ?? null,
        ];
    }

    public function requestMerge(Request $request): JsonResponse
    {
        $data = $this->mergeData($request);
        $req = $this->merge->request(Farmer::findOrFail($data['keep_id']), Farmer::findOrFail($data['remove_id']), $data['choices'],
            $data['transfer'], $data['reason'], $data['reason_note']);

        return $this->merged($req, 201);
    }

    private function merged(ApprovalRequest $req, int $status): JsonResponse
    {
        return response()->json([
            'approval_id' => $req->id,
            'status' => $req->status,
            'message' => $req->status === 'approved' ? __('মার্জ সম্পন্ন হয়েছে।') : __('মার্জ অনুরোধ অনুমোদনের জন্য পাঠানো হয়েছে।'),
        ], $status);
    }
}
