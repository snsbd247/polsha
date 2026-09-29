<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\User;
use App\Services\FundHistoryService;
use App\Services\MemberFundService;
use App\Support\Bn;
use App\Support\CsvExport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The savings menu's lists (share collection, withdrawals): summary cards for
 * one transaction type; closing an account; the accounts' history from the
 * audit log.
 */
class FundEntryController extends Controller
{
    public function __construct(private FundHistoryService $history) {}

    /** Card figures for one type: effective count / amount, today, this month, members, pending, cancelled. */
    public function summary(Request $request, string $kind): JsonResponse
    {
        $type = $this->type($request, $kind);
        $base = fn () => MemberTransaction::where('kind', $kind)->where('type', $type);
        $effective = fn () => $base()->whereIn('status', ['posted', 'cancel_pending']);
        $today = now()->toDateString();

        return response()->json([
            'count' => $effective()->count(),
            'amount' => round((float) $effective()->sum('amount'), 2),
            'today_count' => $effective()->whereDate('date', $today)->count(),
            'today_amount' => round((float) $effective()->whereDate('date', $today)->sum('amount'), 2),
            'month_amount' => round((float) $effective()->whereBetween('date', [now()->startOfMonth()->toDateString(), $today])->sum('amount'), 2),
            'members' => $effective()->distinct()->count('member_account_id'),
            'pending' => $base()->whereIn('status', ['pending', 'cancel_pending'])->count(),
            'pending_amount' => round((float) $base()->where('status', 'pending')->sum('amount'), 2),
            'approved_today' => $base()->where('status', 'posted')->where('posted_at', '>=', now()->startOfDay())->whereNotNull('approval_request_id')->count(),
            'rejected' => $base()->where('status', 'rejected')->count(),
            'cancelled' => $base()->where('status', 'cancelled')->count(),
        ]);
    }

    /** Ask to close an account whose balance is already zero; it waits for the manager. */
    public function close(Request $request, string $kind, MemberAccount $account): JsonResponse
    {
        abort_unless($request->user()->can($kind.'.edit'), 403, __('অনুমতি নেই'));
        abort_unless($account->kind === $kind, 404);
        $data = $request->validate([
            'date' => ['required', 'date', 'before_or_equal:today', 'after_or_equal:'.$account->opened_on?->toDateString()],
            'reason' => ['required', 'string', 'max:300'],
        ]);
        $account = app(MemberFundService::class)->requestClose($account, $data['date'], $data['reason']);

        return response()->json($account->toArray() + [
            'message' => $account->status === 'closed' ? __('হিসাব বন্ধ হয়েছে।') : __('হিসাব বন্ধের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'),
        ], 201);
    }

    /** Openings, close requests, closings and reopenings of one kind's accounts, newest first. */
    public function accountHistory(Request $request, string $kind)
    {
        abort_unless($request->user()->can($kind.'.view'), 403, __('অনুমতি নেই'));
        $data = $request->validate([
            'event' => ['nullable', Rule::in(array_keys(FundHistoryService::ACCOUNT_EVENTS))],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'],
            'user_id' => ['nullable', 'integer'], 'search' => ['nullable', 'string', 'max:100'],
            'member_account_id' => ['nullable', 'integer'],
        ]);
        $q = $this->history->accountQuery($kind, isset($data['event']) ? [$data['event']] : null)
            ->when($data['member_account_id'] ?? null, fn ($w, $v) => $w->where('auditable_id', $v))
            ->when($data['from'] ?? null, fn ($w, $v) => $w->where('created_at', '>=', $v))
            ->when($data['to'] ?? null, fn ($w, $v) => $w->where('created_at', '<', date('Y-m-d', strtotime($v.' +1 day'))))
            ->when($data['user_id'] ?? null, fn ($w, $v) => $w->where('user_id', $v))
            ->with('user:id,name_bn,name_en')->orderByDesc('id');
        if ($search = trim((string) ($data['search'] ?? ''))) {
            $en = Bn::toEnDigits($search);
            $q->whereIn('auditable_id', MemberAccount::where('kind', $kind)->select('id')->where(fn ($w) => $w->where('account_no', 'like', "%$en%")
                ->orWhereHas('member', fn ($m) => $m->where(fn ($g) => $g->when(ctype_digit($en), fn ($x) => $x->where('member_no', (int) $en))
                    ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")->orWhere('mobile', 'like', "%$en%"))))));
        }
        $row = function (AuditLog $l, ?MemberAccount $a) {
            $event = $this->history->accountEventOf($l);

            return [
                'id' => $l->id, 'event' => $event, 'event_label' => __(FundHistoryService::ACCOUNT_LABELS[$event] ?? $l->action),
                'at' => $l->created_at?->toDateTimeString(), 'by' => $l->user?->only(['id', 'name_bn', 'name_en']),
                'reason' => $l->new_values['close_reason'] ?? null,
                'account' => $a ? ['id' => $a->id, 'account_no' => $a->account_no, 'status' => $a->status, 'balance' => (float) $a->balance,
                    'member_no' => $a->member?->member_no, 'farmer' => $a->member?->farmer?->only(['id', 'farmer_code', 'name_bn', 'name_en'])] : null,
            ];
        };
        $load = fn ($logs) => MemberAccount::whereIn('id', $logs->pluck('auditable_id')->unique())
            ->with(['member:id,farmer_id,member_no', 'member.farmer:id,farmer_code,name_bn,name_en'])->get()->keyBy('id');

        if ($request->query('export') === 'csv') {
            return CsvExport::download($kind.'-account-history-'.now()->format('Ymd').'.csv',
                [__('সময়'), __('কার্যক্রম'), __('হিসাব নং'), __('সদস্য নং'), __('নাম'), __('সম্পাদনকারী'), __('কারণ')],
                $q->lazy()->chunk(500)->flatMap(function ($logs) use ($load, $row) {
                    $byId = $load($logs);

                    return $logs->map(function (AuditLog $l) use ($byId, $row) {
                        $r = $row($l, $byId[$l->auditable_id] ?? null);

                        return [$r['at'], $r['event_label'], $r['account']['account_no'] ?? '', $r['account']['member_no'] ?? '', $r['account']['farmer']['name_bn'] ?? '', $l->user?->name_bn, $r['reason']];
                    });
                }));
        }
        $page = $q->paginate(min(100, max(5, (int) $request->query('per_page', 25))));
        $byId = $load($page->getCollection());

        return response()->json([
            'data' => $page->getCollection()->map(fn (AuditLog $l) => $row($l, $byId[$l->auditable_id] ?? null))->values(),
            'total' => $page->total(), 'current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage(),
        ]);
    }

    public function accountHistorySummary(Request $request, string $kind): JsonResponse
    {
        abort_unless($request->user()->can($kind.'.view'), 403, __('অনুমতি নেই'));
        $counts = collect(array_keys(FundHistoryService::ACCOUNT_EVENTS))->mapWithKeys(fn ($e) => [$e => $this->history->accountQuery($kind, [$e])->count()]);
        $userIds = $this->history->accountQuery($kind)->distinct()->pluck('user_id')->filter();

        return response()->json([
            'total' => $counts->sum(), 'counts' => $counts,
            'today' => $this->history->accountQuery($kind)->where('created_at', '>=', now()->startOfDay())->count(),
            'events' => collect(FundHistoryService::ACCOUNT_LABELS)->map(fn ($l) => __($l)),
            'users' => User::whereIn('id', $userIds)->orderBy('name_bn')->get(['id', 'name_bn', 'name_en']),
        ]);
    }

    private function type(Request $request, string $kind): string
    {
        abort_unless($request->user()->can($kind.'.view'), 403, __('অনুমতি নেই'));
        $type = (string) $request->query('type');
        abort_unless(array_key_exists($type, MemberTransaction::TYPES[$kind]), 422, __('লেনদেনের ধরন সঠিক নয়'));

        return $type;
    }
}
