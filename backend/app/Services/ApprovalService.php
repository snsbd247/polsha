<?php

namespace App\Services;

use App\Approvals\ApprovalHandler;
use App\Models\ApprovalRequest;
use App\Models\ApprovalRule;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class ApprovalService
{
    /**
     * Open an approval request. When the action has no enabled rule (or the
     * amount is under the rule's threshold) it is approved immediately so
     * callers never need a separate "no approval" code path.
     */
    public function submit(
        string $actionKey,
        string $title,
        ?Model $approvable = null,
        array $payload = [],
        ?array $before = null,
        ?float $amount = null,
    ): ApprovalRequest {
        return DB::transaction(function () use ($actionKey, $title, $approvable, $payload, $before, $amount) {
            $rule = ApprovalRule::where('action_key', $actionKey)->first();
            $needsApproval = $rule && $rule->enabled && $rule->steps
                && ($rule->min_amount === null || $amount === null || $amount >= (float) $rule->min_amount);

            $request = ApprovalRequest::create([
                'action_key' => $actionKey,
                'module' => $rule?->module ?? explode('.', $actionKey)[0],
                'title' => $title,
                'approvable_type' => $approvable ? $approvable::class : null,
                'approvable_id' => $approvable?->getKey(),
                'payload' => $payload,
                'before' => $before,
                'amount' => $amount,
                'status' => ApprovalRequest::PENDING,
                'current_step' => 1,
                'total_steps' => $needsApproval ? count($rule->steps) : 0,
                'requested_by' => auth()->id(),
            ]);

            if (! $needsApproval) {
                $request->update(['status' => ApprovalRequest::APPROVED, 'decided_at' => now()]);
                $this->handler($actionKey)->approved($request);
                AuditLogger::log($request->module, 'auto_approve', $request, null, null, $title);

                return $request;
            }

            foreach (array_values($rule->steps) as $i => $roles) {
                $request->steps()->create(['step_no' => $i + 1, 'roles' => $roles, 'status' => 'waiting']);
            }
            AuditLogger::log($request->module, 'submit', $request, null, $payload, $title);

            return $request;
        });
    }

    public function canAct(User $user, ApprovalRequest $request): bool
    {
        if ($request->status !== ApprovalRequest::PENDING || $request->requested_by === $user->id) {
            return false;
        }
        $step = $request->steps()->where('step_no', $request->current_step)->first();

        return $step && ($user->isSuperAdmin() || $user->hasAnyRole($step->roles));
    }

    /** @param  string  $decision  approve|reject|return */
    public function act(ApprovalRequest $request, User $user, string $decision, ?string $remarks = null): ApprovalRequest
    {
        return DB::transaction(function () use ($request, $user, $decision, $remarks) {
            $request = ApprovalRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();

            if ($request->requested_by === $user->id) {
                throw ValidationException::withMessages(['decision' => 'নিজের পাঠানো অনুরোধ নিজে অনুমোদন করা যাবে না।']);
            }
            if (! $this->canAct($user, $request)) {
                throw ValidationException::withMessages(['decision' => 'এই ধাপে আপনার অনুমোদনের ক্ষমতা নেই।']);
            }
            if ($decision !== 'approve' && blank($remarks)) {
                throw ValidationException::withMessages(['remarks' => 'কারণ লেখা আবশ্যক।']);
            }

            $step = $request->steps()->where('step_no', $request->current_step)->first();
            $step->update([
                'status' => ['approve' => 'approved', 'reject' => 'rejected', 'return' => 'returned'][$decision],
                'acted_by' => $user->id,
                'acted_at' => now(),
                'remarks' => $remarks,
            ]);

            $handler = $this->handler($request->action_key);

            if ($decision === 'approve' && $request->current_step < $request->total_steps) {
                $request->increment('current_step');
            } elseif ($decision === 'approve') {
                $request->update(['status' => ApprovalRequest::APPROVED, 'decided_at' => now()]);
                $handler->approved($request);
            } elseif ($decision === 'reject') {
                $request->update(['status' => ApprovalRequest::REJECTED, 'decided_at' => now()]);
                $handler->rejected($request);
            } else {
                $request->update(['status' => ApprovalRequest::RETURNED, 'decided_at' => now()]);
                $handler->returned($request);
            }

            AuditLogger::log($request->module, $decision, $request, null, ['step' => $step->step_no, 'remarks' => $remarks], $request->title);

            return $request->fresh(['steps.actor', 'requester']);
        });
    }

    private function handler(string $actionKey): ApprovalHandler
    {
        $class = config("erp.approval_handlers.$actionKey");
        if (! $class) {
            throw new RuntimeException("No approval handler registered for [$actionKey].");
        }

        return app($class);
    }
}
