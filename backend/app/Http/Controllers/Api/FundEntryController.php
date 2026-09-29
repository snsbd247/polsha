<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\MemberTransaction;
use App\Models\User;
use App\Services\FundHistoryService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The savings menu's entry screens (deposits, share collection, withdrawals):
 * summary cards for one transaction type, and the history of those
 * transactions from the audit log.
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
            'cancelled' => $base()->where('status', 'cancelled')->count(),
        ]);
    }

    /** Every recorded step of this type's transactions, newest first. */
    public function history(Request $request, string $kind)
    {
        $type = $this->type($request, $kind);
        $data = $request->validate([
            'event' => ['nullable', Rule::in(array_keys(FundHistoryService::EVENTS))],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'],
            'user_id' => ['nullable', 'integer'], 'search' => ['nullable', 'string', 'max:100'],
        ]);
        $txns = MemberTransaction::where('kind', $kind)->where('type', $type)->select('id');
        if ($search = trim((string) ($data['search'] ?? ''))) {
            $en = Bn::toEnDigits($search);
            $txns->where(fn ($w) => $w->where('txn_no', 'like', "%$en%")->orWhereHas('account', fn ($a) => $a->where('account_no', 'like', "%$en%")
                // grouped, or the "or" would escape the member relation's own condition
                ->orWhereHas('member', fn ($m) => $m->where(fn ($g) => $g->when(ctype_digit($en), fn ($x) => $x->where('member_no', (int) $en))
                    ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")->orWhere('mobile', 'like', "%$en%"))))));
        }
        $q = $this->history->query($kind, isset($data['event']) ? [$data['event']] : null)->whereIn('auditable_id', $txns)
            ->when($data['from'] ?? null, fn ($w, $v) => $w->where('created_at', '>=', $v))
            ->when($data['to'] ?? null, fn ($w, $v) => $w->where('created_at', '<', date('Y-m-d', strtotime($v.' +1 day'))))
            ->when($data['user_id'] ?? null, fn ($w, $v) => $w->where('user_id', $v))
            ->with('user:id,name_bn,name_en')->orderByDesc('id');

        $load = fn ($logs) => MemberTransaction::whereIn('id', $logs->pluck('auditable_id')->unique())
            ->with(['account:id,account_no,member_id', 'account.member:id,farmer_id,member_no', 'account.member.farmer:id,farmer_code,name_bn,name_en'])->get()->keyBy('id');

        if ($request->query('export') === 'csv') {
            $types = Tr::map(MemberTransaction::TYPES[$kind]);

            return CsvExport::download($kind.'-'.$type.'-history-'.now()->format('Ymd').'.csv',
                [__('সময়'), __('কার্যক্রম'), __('লেনদেন নং'), __('ধরন'), __('হিসাব নং'), __('সদস্য নং'), __('নাম'), __('টাকা'), __('সম্পাদনকারী'), __('কারণ')],
                $q->lazy()->chunk(500)->flatMap(function ($logs) use ($load, $types) {
                    $byId = $load($logs);

                    return $logs->map(function (AuditLog $l) use ($byId, $types) {
                        $r = $this->history->row($l, $t = $byId[$l->auditable_id] ?? null);

                        return [$r['at'], $r['event_label'], $t?->txn_no, $t ? ($types[$t->type] ?? $t->type) : '', $t?->account?->account_no,
                            $t?->account?->member?->member_no, $t?->account?->member?->farmer?->name_bn, $t?->amount, $l->user?->name_bn, $r['reason']];
                    });
                }));
        }

        $page = $q->paginate(min(100, max(5, (int) $request->query('per_page', 25))));
        $byId = $load($page->getCollection());
        $rows = $page->getCollection()->map(fn (AuditLog $l) => $this->history->row($l, $byId[$l->auditable_id] ?? null));

        return response()->json(['data' => $rows, 'total' => $page->total(), 'current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage()]);
    }

    /** Counts per event for the history cards, plus the users who appear in it. */
    public function historySummary(Request $request, string $kind): JsonResponse
    {
        $type = $this->type($request, $kind);
        $txns = MemberTransaction::where('kind', $kind)->where('type', $type)->select('id');
        $counts = collect(array_keys(FundHistoryService::EVENTS))
            ->mapWithKeys(fn ($e) => [$e => $this->history->query($kind, [$e])->whereIn('auditable_id', $txns)->count()]);
        $userIds = $this->history->query($kind)->whereIn('auditable_id', $txns)->distinct()->pluck('user_id')->filter();

        return response()->json([
            'total' => $counts->sum(),
            'counts' => $counts,
            'today' => $this->history->query($kind)->whereIn('auditable_id', $txns)->where('created_at', '>=', now()->startOfDay())->count(),
            'events' => collect(FundHistoryService::LABELS)->map(fn ($l) => __($l)),
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
