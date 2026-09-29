<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\MemberTransaction;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * The life of savings / share transactions, read from the audit log: entered,
 * sent for approval, approved, rejected, cancel requested / refused, cancelled.
 * Transaction rows are never deleted, so the log is the whole story.
 */
class FundHistoryService
{
    /** event => [audit action, new status, old status or null]. */
    public const EVENTS = [
        'entered' => ['create', 'posted', null],
        'submitted' => ['create', 'pending', null],
        'approved' => ['update', 'posted', 'pending'],
        'rejected' => ['update', 'rejected', null],
        'cancel_requested' => ['update', 'cancel_pending', null],
        'cancel_rejected' => ['update', 'posted', 'cancel_pending'],
        'cancelled' => ['update', 'cancelled', null],
    ];

    public const LABELS = [
        'entered' => 'এন্ট্রি ও পোস্ট',
        'submitted' => 'অনুমোদনে পাঠানো',
        'approved' => 'অনুমোদিত',
        'rejected' => 'প্রত্যাখ্যাত',
        'cancel_requested' => 'বাতিলের আবেদন',
        'cancel_rejected' => 'বাতিলের আবেদন নামঞ্জুর',
        'cancelled' => 'বাতিল',
    ];

    /** Audit rows of one kind's transactions that are one of the events (optionally only some events). */
    public function query(string $kind, ?array $events = null): Builder
    {
        $events = $events ? array_intersect_key(self::EVENTS, array_flip($events)) : self::EVENTS;

        return AuditLog::where('auditable_type', 'MemberTransaction')->where('module', $kind)
            ->where(function ($w) use ($events) {
                foreach ($events as [$action, $new, $old]) {
                    $w->orWhere(function ($e) use ($action, $new, $old) {
                        $e->where('action', $action);
                        $this->hasStatus($e, 'new_values', $new);
                        if ($old) {
                            $this->hasStatus($e, 'old_values', $old);
                        }
                    });
                }
            });
    }

    /** The event an audit row stands for, or null when it is only bookkeeping (balance, voucher). */
    public function eventOf(AuditLog $log): ?string
    {
        $new = $log->new_values['status'] ?? null;
        $old = $log->old_values['status'] ?? null;
        foreach (self::EVENTS as $key => [$action, $status, $from]) {
            if ($log->action === $action && $new === $status && (! $from || $old === $from)) {
                return $key;
            }
        }

        return null;
    }

    /** One transaction's timeline, oldest first. */
    public function timeline(MemberTransaction $txn): Collection
    {
        return $this->query($txn->kind)->where('auditable_id', $txn->id)->with('user:id,name_bn,name_en')->orderBy('id')->get()
            ->map(fn (AuditLog $l) => $this->row($l, $txn))->values();
    }

    public function row(AuditLog $log, ?MemberTransaction $txn): array
    {
        $event = $this->eventOf($log);

        return [
            'id' => $log->id, 'event' => $event, 'event_label' => __(self::LABELS[$event] ?? $log->action),
            'at' => $log->created_at?->toDateTimeString(), 'by' => $log->user?->only(['id', 'name_bn', 'name_en']),
            'reason' => $event === 'cancel_requested' ? ($log->new_values['cancel_reason'] ?? null) : null,
            'transaction' => $txn ? [
                'id' => $txn->id, 'txn_no' => $txn->txn_no, 'date' => $txn->date?->toDateString(), 'type' => $txn->type,
                'amount' => (float) $txn->amount, 'status' => $txn->status, 'method' => $txn->method,
                'account' => $txn->account ? [
                    'id' => $txn->account->id, 'account_no' => $txn->account->account_no,
                    'member_no' => $txn->account->member?->member_no, 'farmer' => $txn->account->member?->farmer?->only(['id', 'farmer_code', 'name_bn', 'name_en']),
                ] : null,
            ] : null,
        ];
    }

    /** Account events: event => [audit action, new status or null, old status or null]. */
    public const ACCOUNT_EVENTS = [
        'opened' => ['create', null, null],
        'close_requested' => ['update', 'closing', null],
        'closed' => ['update', 'closed', null],
        'close_rejected' => ['update', 'active', 'closing'],
        'reopened' => ['update', 'active', 'closed'],
    ];

    public const ACCOUNT_LABELS = [
        'opened' => 'হিসাব খোলা',
        'close_requested' => 'বন্ধের আবেদন',
        'closed' => 'হিসাব বন্ধ',
        'close_rejected' => 'বন্ধের আবেদন নামঞ্জুর',
        'reopened' => 'আবার চালু',
    ];

    /** Audit rows of one kind's accounts that open, close or reopen them (balance updates are left out). */
    public function accountQuery(string $kind, ?array $events = null): Builder
    {
        $events = $events ? array_intersect_key(self::ACCOUNT_EVENTS, array_flip($events)) : self::ACCOUNT_EVENTS;

        return AuditLog::where('auditable_type', 'MemberAccount')->where('module', $kind)
            ->where(function ($w) use ($events) {
                foreach ($events as [$action, $new, $old]) {
                    $w->orWhere(function ($e) use ($action, $new, $old) {
                        $e->where('action', $action);
                        if ($new) {
                            $this->hasStatus($e, 'new_values', $new);
                        }
                        if ($old) {
                            $this->hasStatus($e, 'old_values', $old);
                        }
                    });
                }
            });
    }

    public function accountEventOf(AuditLog $log): ?string
    {
        $new = $log->new_values['status'] ?? null;
        $old = $log->old_values['status'] ?? null;
        foreach (self::ACCOUNT_EVENTS as $key => [$action, $status, $from]) {
            if ($log->action === $action && (! $status || $new === $status) && (! $from || $old === $from)) {
                return $key;
            }
        }

        return null;
    }

    /** The JSON may be stored compact ("a":"b") or spaced ("a": "b") depending on the database. */
    private function hasStatus(Builder $q, string $column, string $status): void
    {
        $q->where(fn ($s) => $s->where($column, 'like', '%"status":"'.$status.'"%')->orWhere($column, 'like', '%"status": "'.$status.'"%'));
    }
}
