<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\ApprovalRule;
use App\Services\ApprovalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ApprovalController extends Controller
{
    public function __construct(private ApprovalService $approvals) {}

    /** tab = mine (awaiting me) | sent (I submitted) | all (admin) */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $q = ApprovalRequest::query()->with(['requester:id,name_bn', 'steps']);

        switch ($request->query('tab', 'mine')) {
            case 'sent':
                $q->where('requested_by', $user->id);
                break;
            case 'all':
                abort_unless($user->can('approval.admin'), 403);
                break;
            default:
                $q->where('requested_by', '!=', $user->id);
                if (! $user->isSuperAdmin()) {
                    $q->awaitingRoles($user->getRoleNames()->all());
                } else {
                    $q->where('status', ApprovalRequest::PENDING);
                }
        }

        foreach (['status', 'module', 'action_key'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }

        return response()->json($q->latest('id')->paginate($this->perPage($request)));
    }

    /** Badge count for the top bar. */
    public function pendingCount(Request $request): JsonResponse
    {
        $user = $request->user();
        $q = ApprovalRequest::where('requested_by', '!=', $user->id);
        $q = $user->isSuperAdmin() ? $q->where('status', ApprovalRequest::PENDING) : $q->awaitingRoles($user->getRoleNames()->all());

        return response()->json(['count' => $q->count()]);
    }

    public function show(Request $request, ApprovalRequest $approval): JsonResponse
    {
        $user = $request->user();
        $approval->load(['requester:id,name_bn,username', 'steps.actor:id,name_bn', 'comments.user:id,name_bn']);

        $involved = $approval->requested_by === $user->id
            || $user->can('approval.admin')
            || $approval->steps->contains(fn ($s) => $user->hasAnyRole($s->roles));
        abort_unless($involved, 403);

        return response()->json($approval->toArray() + ['can_act' => $this->approvals->canAct($user, $approval)]);
    }

    public function decide(Request $request, ApprovalRequest $approval): JsonResponse
    {
        $data = $request->validate([
            'decision' => ['required', 'in:approve,reject,return'],
            'remarks' => ['nullable', 'string', 'max:1000'],
        ]);

        return response()->json($this->approvals->act($approval, $request->user(), $data['decision'], $data['remarks'] ?? null));
    }

    public function comment(Request $request, ApprovalRequest $approval): JsonResponse
    {
        $data = $request->validate(['body' => ['required', 'string', 'max:2000']]);
        $comment = $approval->comments()->create(['user_id' => $request->user()->id, 'body' => $data['body']]);

        return response()->json($comment->load('user:id,name_bn'), 201);
    }

    public function rules(): JsonResponse
    {
        return response()->json(ApprovalRule::orderBy('module')->orderBy('id')->get()
            ->map(fn ($r) => array_merge($r->toArray(), ['label' => __($r->label)])));
    }

    public function updateRule(Request $request, ApprovalRule $rule): JsonResponse
    {
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'steps' => ['required', 'array', 'min:1', 'max:3'],
            'steps.*' => ['required', 'array', 'min:1'],
            'steps.*.*' => ['string', 'exists:roles,name'],
            'min_amount' => ['nullable', 'numeric', 'min:0'],
        ]);
        $rule->update($data);

        return response()->json($rule);
    }
}
