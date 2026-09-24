<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\Receipt;
use App\Services\LedgerService;
use App\Services\MemberFundService;
use App\Services\SettingService;
use App\Services\SmsService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Savings and share accounts share one engine; {kind} (savings|share) picks
 * the book and the permission set ("savings.*" / "share.*").
 */
class MemberFundController extends Controller
{
    public function __construct(private MemberFundService $funds, private LedgerService $ledger) {}

    public function meta(Request $request, string $kind): JsonResponse
    {
        $this->allow($request, $kind, 'view');
        $ledger = MemberAccount::make(['kind' => $kind])->ledgerAccount();

        return response()->json([
            'types' => Tr::map(MemberTransaction::TYPES[$kind]),
            'statuses' => Tr::map(MemberTransaction::STATUSES),
            'directions' => Tr::map(MemberTransaction::DIRECTIONS),
            'methods' => Tr::map(Receipt::METHODS),
            'account_statuses' => Tr::map(MemberAccount::STATUSES),
            'ledger_account' => $ledger->only(['id', 'code', 'name_bn', 'name_en']),
        ]);
    }

    public function accounts(Request $request, string $kind)
    {
        $this->allow($request, $kind, 'view');
        $q = $this->accountQuery($request, $kind);
        if ($request->query('export') === 'csv') {
            $statuses = Tr::map(MemberAccount::STATUSES);

            return CsvExport::download($kind.'-accounts-'.now()->format('Ymd').'.csv',
                [__('হিসাব নং'), __('সদস্য নং'), __('নাম'), __('পিতার নাম'), __('মোবাইল'), __('খোলার তারিখ'), __('জের'), __('অবস্থা')],
                $q->with('member.farmer')->orderBy('account_no')->lazy()->map(fn (MemberAccount $a) => [
                    $a->account_no, $a->member?->member_no, $a->member?->farmer?->name_bn, $a->member?->farmer?->father_name,
                    $a->member?->farmer?->mobile, $a->opened_on, $a->balance, $statuses[$a->status] ?? $a->status,
                ]));
        }
        $totals = (clone $q)->reorder()->selectRaw('COUNT(*) c, COALESCE(SUM(balance), 0) b')->first();
        $page = $q->with(['member:id,farmer_id,member_no,status', 'member.farmer:id,farmer_code,name_bn,name_en,father_name,mobile'])
            ->withSum(['transactions as held' => fn ($t) => $t->where('status', 'pending')->where('direction', 'out')], 'amount')
            ->orderBy('account_no')->paginate($this->perPage($request));

        return response()->json($page->toArray() + [
            'totals' => ['accounts' => (int) $totals->c, 'balance' => round((float) $totals->b, 2)],
            'ledger_balance' => $this->ledgerBalance($kind),
            'book_balance' => round((float) MemberAccount::where('kind', $kind)->sum('balance'), 2),
        ]);
    }

    public function open(Request $request, string $kind): JsonResponse
    {
        $this->allow($request, $kind, 'create');
        $data = $request->validate([
            'member_id' => ['required', 'exists:members,id'],
            'opened_on' => ['required', 'date', 'before_or_equal:today'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $account = $this->funds->openAccount(Member::findOrFail($data['member_id']), $kind, $data['opened_on'], $data['remarks'] ?? null);

        return response()->json($account, 201);
    }

    /** Accounts of one member, both kinds (for the member picker screens). */
    public function lookup(Request $request, string $kind): JsonResponse
    {
        $this->allow($request, $kind, 'view');
        $search = trim((string) $request->query('search'));
        $en = Bn::toEnDigits($search);
        $rows = Member::with(['farmer:id,farmer_code,name_bn,name_en,father_name,mobile'])
            ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w->when(ctype_digit($en), fn ($x) => $x->orWhere('member_no', (int) $en))
                ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                    ->orWhere('farmer_code', 'like', "%$en%")->orWhere('mobile', 'like', "%$en%"))))
            // an exact member number beats partial mobile/code hits
            ->when(ctype_digit($en), fn ($q) => $q->orderByRaw('member_no = ? desc', [(int) $en]))
            ->orderBy('member_no')->limit(20)->get();
        $accounts = MemberAccount::where('kind', $kind)->whereIn('member_id', $rows->pluck('id'))->get()->keyBy('member_id');

        return response()->json($rows->map(fn (Member $m) => [
            'id' => $m->id, 'member_no' => $m->member_no, 'status' => $m->status, 'farmer' => $m->farmer,
            'account' => ($a = $accounts[$m->id] ?? null) ? ['id' => $a->id, 'account_no' => $a->account_no, 'balance' => (float) $a->balance, 'status' => $a->status] : null,
        ]));
    }

    public function show(Request $request, string $kind, MemberAccount $account): JsonResponse
    {
        $this->allow($request, $kind, 'view', $account);
        $account->load(['member:id,farmer_id,member_no,status,admitted_on', 'member.farmer:id,farmer_code,name_bn,name_en,father_name,mobile', 'creator:id,name_bn,name_en']);
        $other = MemberAccount::where('member_id', $account->member_id)->where('kind', '!=', $kind)->first(['id', 'kind', 'account_no', 'balance']);

        return response()->json($account->toArray() + [
            'held' => $account->heldAmount(), 'available' => $account->available(), 'other_account' => $other,
            'pending' => $account->transactions()->whereIn('status', ['pending', 'cancel_pending'])->orderBy('id')->get(),
        ]);
    }

    /**
     * Member statement: opening balance before `from`, then either every
     * transaction with a running balance or daily / monthly / yearly totals.
     */
    public function statement(Request $request, string $kind, MemberAccount $account)
    {
        $this->allow($request, $kind, 'view', $account);
        $data = $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'group' => ['nullable', Rule::in(['none', 'day', 'month', 'year'])],
        ]);
        $from = $data['from'] ?? null;
        $to = $data['to'] ?? null;
        $group = $data['group'] ?? 'none';
        $effective = fn ($q) => $q->whereIn('status', ['posted', 'cancel_pending']);
        $opening = $from ? round((float) $account->transactions()->where($effective)->where('date', '<', $from)
            ->sum(DB::raw("CASE WHEN direction = 'in' THEN amount ELSE -amount END")), 2) : 0.0;

        $txns = $account->transactions()->where($effective)->when($from, fn ($q) => $q->where('date', '>=', $from))
            ->when($to, fn ($q) => $q->where('date', '<=', $to))->orderBy('date')->orderBy('id')->get();
        $running = $opening;
        $types = Tr::map(MemberTransaction::TYPES[$kind]);
        $rows = $txns->map(function (MemberTransaction $t) use (&$running, $types) {
            $running = round($running + $t->signed(), 2);

            return [
                'id' => $t->id, 'txn_no' => $t->txn_no, 'date' => $t->date->toDateString(), 'type' => $t->type, 'type_label' => $types[$t->type] ?? $t->type,
                'in' => $t->direction === 'in' ? (float) $t->amount : 0.0, 'out' => $t->direction === 'out' ? (float) $t->amount : 0.0,
                'balance' => $running, 'reference' => $t->reference, 'remarks' => $t->remarks, 'status' => $t->status,
            ];
        });

        if ($group !== 'none') {
            $fmt = ['day' => 'Y-m-d', 'month' => 'Y-m', 'year' => 'Y'][$group];
            $bal = $opening;
            $rows = $rows->groupBy(fn ($r) => date($fmt, strtotime($r['date'])))->map(function ($g, $period) use (&$bal) {
                $open = $bal;
                $in = round($g->sum('in'), 2);
                $out = round($g->sum('out'), 2);
                $bal = round($open + $in - $out, 2);

                return ['period' => (string) $period, 'opening' => $open, 'in' => $in, 'out' => $out, 'balance' => $bal, 'count' => $g->count()];
            })->values();
        }

        $totalIn = round($txns->where('direction', 'in')->sum(fn ($t) => (float) $t->amount), 2);
        $totalOut = round($txns->where('direction', 'out')->sum(fn ($t) => (float) $t->amount), 2);
        $closing = round($opening + $totalIn - $totalOut, 2);

        if ($request->query('export') === 'csv') {
            $name = $kind.'-statement-'.$account->account_no.'.csv';

            return $group === 'none'
                ? CsvExport::download($name, [__('তারিখ'), __('লেনদেন নং'), __('ধরন'), __('জমা'), __('খরচ'), __('জের'), __('রেফারেন্স')],
                    collect([['', '', __('প্রারম্ভিক জের'), '', '', $opening, '']])->concat($rows->map(fn ($r) => [$r['date'], $r['txn_no'], $r['type_label'], $r['in'], $r['out'], $r['balance'], $r['reference']])))
                : CsvExport::download($name, [__('সময়কাল'), __('প্রারম্ভিক জের'), __('জমা'), __('খরচ'), __('সমাপনী জের'), __('লেনদেন')],
                    $rows->map(fn ($r) => [$r['period'], $r['opening'], $r['in'], $r['out'], $r['balance'], $r['count']]));
        }

        return response()->json([
            'account' => $account->only(['id', 'account_no', 'kind', 'balance', 'status']),
            'from' => $from, 'to' => $to, 'group' => $group,
            'opening' => $opening, 'rows' => $rows->values(), 'total_in' => $totalIn, 'total_out' => $totalOut, 'closing' => $closing,
        ]);
    }

    public function storeTransaction(Request $request, string $kind, MemberAccount $account): JsonResponse
    {
        $this->allow($request, $kind, 'create', $account);
        $in = MemberAccount::CONFIG[$kind]['in'];
        $allowed = $kind === 'savings' ? [$in, 'withdrawal', 'opening', 'adjustment'] : [$in, 'opening', 'adjustment', 'transfer'];
        $type = $request->input('type');
        $money = in_array($type, [$in, 'withdrawal'], true);
        $data = $request->validate([
            'type' => ['required', Rule::in($allowed)],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'amount' => ['required', 'numeric', 'min:0.01', 'max:9999999999999'],
            'method' => [$money ? 'required' : 'nullable', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'remarks' => [in_array($type, ['adjustment', 'transfer'], true) ? 'required' : 'nullable', 'string', 'max:500'],
            'direction' => [$type === 'adjustment' ? 'required' : 'nullable', Rule::in(['in', 'out'])],
            'counter_account_id' => ['nullable', 'integer'],
            'to_member_id' => [$type === 'transfer' ? 'required' : 'nullable', 'exists:members,id'],
        ]);

        $txn = match ($type) {
            $in => $this->funds->moneyIn($account, $data),
            'withdrawal' => $this->funds->requestWithdrawal($account, $data),
            'opening' => $this->funds->requestOpening($account, $data),
            'adjustment' => $this->funds->requestAdjustment($account, $data['direction'], $data),
            'transfer' => $this->funds->requestTransfer($account, Member::findOrFail($data['to_member_id']), $data),
        };
        if ($kind === 'savings' && $type === $in && $txn->status === 'posted' && SettingService::get('sms_auto_savings')) {
            $farmer = $account->member?->farmer;
            app(SmsService::class)->queue('savings', $farmer?->mobile, [
                'name' => $farmer?->name_bn, 'account_no' => $account->account_no, 'amount' => number_format((float) $txn->amount, 2),
                'balance' => number_format((float) ($txn->balance_after ?? $account->fresh()->balance), 2),
            ], $txn);
        }

        return response()->json([
            'id' => $txn->id, 'txn_no' => $txn->txn_no, 'status' => $txn->status,
            'message' => $txn->status === 'posted' ? __('লেনদেন সম্পন্ন হয়েছে।') : __('অনুমোদনের জন্য পাঠানো হয়েছে।'),
        ], 201);
    }

    /** Savings / share history across all accounts. */
    public function transactions(Request $request, string $kind)
    {
        $this->allow($request, $kind, 'view');
        $q = MemberTransaction::where('member_transactions.kind', $kind);
        foreach (['type', 'status', 'member_account_id', 'method', 'direction'] as $f) {
            if ($request->filled($f)) {
                $q->where('member_transactions.'.$f, $request->query($f));
            }
        }
        if ($request->filled('from')) {
            $q->where('date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->where('date', '<=', $request->query('to'));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('txn_no', 'like', "%$en%")->orWhere('reference', 'like', "%$en%")
                ->orWhereHas('account', fn ($a) => $a->where('account_no', 'like', "%$en%")
                    ->orWhereHas('member.farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%"))));
        }
        $types = Tr::map(MemberTransaction::TYPES[$kind]);
        $statuses = Tr::map(MemberTransaction::STATUSES);

        if ($request->query('export') === 'csv') {
            return CsvExport::download($kind.'-transactions-'.now()->format('Ymd').'.csv',
                [__('লেনদেন নং'), __('তারিখ'), __('হিসাব নং'), __('নাম'), __('ধরন'), __('জমা'), __('খরচ'), __('অবস্থা'), __('রেফারেন্স')],
                $q->with('account.member.farmer')->orderBy('date')->orderBy('id')->lazy()->map(fn (MemberTransaction $t) => [
                    $t->txn_no, $t->date, $t->account?->account_no, $t->account?->member?->farmer?->name_bn, $types[$t->type] ?? $t->type,
                    $t->direction === 'in' ? $t->amount : '', $t->direction === 'out' ? $t->amount : '', $statuses[$t->status] ?? $t->status, $t->reference,
                ]));
        }
        $sums = (clone $q)->whereIn('status', ['posted', 'cancel_pending'])
            ->selectRaw("COALESCE(SUM(CASE WHEN direction = 'in' THEN amount END), 0) i, COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) o")->first();

        return response()->json($q->with(['account:id,account_no,member_id', 'account.member:id,farmer_id,member_no', 'account.member.farmer:id,farmer_code,name_bn,name_en'])
            ->orderByDesc('date')->orderByDesc('id')->paginate($this->perPage($request))->toArray()
            + ['total_in' => round((float) $sums->i, 2), 'total_out' => round((float) $sums->o, 2)]);
    }

    /** One transaction — also the printable deposit / withdrawal slip. */
    public function showTransaction(Request $request, string $kind, MemberTransaction $txn): JsonResponse
    {
        abort_unless($txn->kind === $kind, 404);
        $this->allow($request, $kind, 'view');
        $txn->load(['account:id,account_no,member_id,kind,balance', 'account.member:id,farmer_id,member_no',
            'account.member.farmer:id,farmer_code,name_bn,name_en,father_name,mobile', 'fund:id,code,name_bn,name_en',
            'counterAccount:id,code,name_bn,name_en', 'journal:id,voucher_no,status,reversed_by_id', 'journal.reversedBy:id,voucher_no',
            'creator:id,name_bn,name_en', 'pair:id,txn_no,member_account_id', 'pair.account:id,account_no,member_id',
            'pair.account.member:id,farmer_id,member_no', 'pair.account.member.farmer:id,name_bn,name_en', 'run:id,run_no,title']);
        $settings = SettingService::all();

        return response()->json($txn->toArray() + [
            'type_label' => $txn->typeLabel(),
            'can_cancel' => $txn->status === 'posted' && in_array($txn->type, MemberTransaction::CANCELLABLE, true),
            'society' => ['name_bn' => $settings['society_name_bn'], 'name_en' => $settings['society_name_en'], 'address' => $settings['address'],
                'phone' => $settings['phone'], 'registration_no' => $settings['registration_no'], 'logo' => $settings['logo']],
        ]);
    }

    public function cancelTransaction(Request $request, string $kind, MemberTransaction $txn): JsonResponse
    {
        abort_unless($txn->kind === $kind, 404);
        $this->allow($request, $kind, 'create');
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);

        return response()->json($this->funds->requestCancel($txn, $data['reason']), 201);
    }

    /**
     * Savings audit / share capital reconciliation: every account's stored
     * balance must equal its transactions, every posting must have its
     * voucher, and the total must equal the ledger account.
     */
    public function audit(Request $request, string $kind): JsonResponse
    {
        $this->allow($request, $kind, 'view');
        $issues = collect();
        $sums = MemberTransaction::where('kind', $kind)->whereIn('status', ['posted', 'cancel_pending'])->groupBy('member_account_id')
            ->selectRaw("member_account_id, SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) s")->pluck('s', 'member_account_id');
        MemberAccount::where('kind', $kind)->with('member.farmer:id,name_bn')->orderBy('id')->chunk(500, function ($chunk) use (&$issues, $sums) {
            foreach ($chunk as $a) {
                $sum = round((float) ($sums[$a->id] ?? 0), 2);
                if ($sum !== round((float) $a->balance, 2)) {
                    $issues->push(['kind' => 'balance_vs_txns', 'account_id' => $a->id, 'ref' => $a->account_no, 'name' => $a->member?->farmer?->name_bn, 'expected' => $sum, 'actual' => (float) $a->balance]);
                }
                if ((float) $a->balance < 0) {
                    $issues->push(['kind' => 'negative', 'account_id' => $a->id, 'ref' => $a->account_no, 'name' => $a->member?->farmer?->name_bn, 'expected' => 0, 'actual' => (float) $a->balance]);
                }
            }
        });
        MemberTransaction::where('kind', $kind)->whereIn('status', ['posted', 'cancel_pending', 'cancelled'])
            ->whereNotIn('type', ['transfer_in', 'transfer_out'])->whereNull('run_id')
            ->with(['journal:id,status,amount', 'account:id,account_no'])->orderBy('id')->chunk(500, function ($chunk) use (&$issues) {
                foreach ($chunk as $t) {
                    $want = $t->status === 'cancelled' ? 'reversed' : 'posted';
                    if (! $t->journal || $t->journal->status !== $want || round((float) $t->journal->amount, 2) !== round((float) $t->amount, 2)) {
                        $issues->push(['kind' => 'voucher', 'transaction_id' => $t->id, 'ref' => $t->txn_no, 'name' => $t->account?->account_no,
                            'expected' => (float) $t->amount, 'actual' => $t->journal ? (float) $t->journal->amount : null]);
                    }
                }
            });
        $pairs = MemberTransaction::where('kind', 'share')->where('type', 'transfer_out')->with('pair:id,status,amount')->get();
        foreach ($kind === 'share' ? $pairs : [] as $t) {
            if (! $t->pair || $t->pair->status !== $t->status || (float) $t->pair->amount !== (float) $t->amount) {
                $issues->push(['kind' => 'transfer_pair', 'transaction_id' => $t->id, 'ref' => $t->txn_no, 'name' => null, 'expected' => (float) $t->amount, 'actual' => $t->pair ? (float) $t->pair->amount : null]);
            }
        }

        $book = round((float) MemberAccount::where('kind', $kind)->sum('balance'), 2);
        $ledger = $this->ledgerBalance($kind);
        $account = MemberAccount::make(['kind' => $kind])->ledgerAccount();

        return response()->json([
            'book_balance' => $book, 'ledger_balance' => $ledger, 'difference' => round($ledger - $book, 2),
            'accounts' => MemberAccount::where('kind', $kind)->count(),
            'account' => $account->only(['id', 'code', 'name_bn', 'name_en']),
            'issues' => $issues->values(),
            'kinds' => [
                'balance_vs_txns' => __('হিসাবের জের ও লেনদেনের যোগফল মেলে না'),
                'negative' => __('হিসাবের জের ঋণাত্মক'),
                'voucher' => __('লেনদেনের ভাউচার নেই বা মেলে না'),
                'transfer_pair' => __('হস্তান্তরের দুই অংশ মেলে না'),
            ],
        ]);
    }

    /** Liability / equity: members' side is credit − debit. */
    private function ledgerBalance(string $kind): float
    {
        return round(-$this->ledger->balance(MemberAccount::make(['kind' => $kind])->ledgerAccount()->id), 2);
    }

    private function accountQuery(Request $request, string $kind): Builder
    {
        $q = MemberAccount::where('kind', $kind);
        if ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }
        if ($request->filled('member_status')) {
            $q->whereHas('member', fn ($m) => $m->where('status', $request->query('member_status')));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('account_no', 'like', "%$en%")
                ->orWhereHas('member', fn ($m) => $m->when(ctype_digit($en), fn ($x) => $x->where('member_no', (int) $en))
                    ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                        ->orWhere('farmer_code', 'like', "%$en%")->orWhere('mobile', 'like', "%$en%"))));
        }

        return $q;
    }

    private function allow(Request $request, string $kind, string $ability, ?MemberAccount $account = null): void
    {
        abort_unless($request->user()->can($kind.'.'.$ability), 403, __('অনুমতি নেই'));
        abort_if($account && $account->kind !== $kind, 404);
    }
}
