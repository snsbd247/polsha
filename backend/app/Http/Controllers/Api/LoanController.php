<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\Loan;
use App\Models\LoanPayment;
use App\Models\LoanProduct;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\Receipt;
use App\Services\LedgerService;
use App\Services\LoanService;
use App\Services\SettingService;
use App\Services\SmsService;
use App\Support\Bn;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

class LoanController extends Controller
{
    private const MEMBER = ['member:id,farmer_id,member_no,status', 'member.farmer:id,farmer_code,name_bn,name_en,father_name,mobile,village_id'];

    public function __construct(private LoanService $loans, private LedgerService $ledger) {}

    public function meta(): JsonResponse
    {
        return response()->json([
            'statuses' => Tr::map(Loan::STATUSES),
            'payment_statuses' => Tr::map(LoanPayment::STATUSES),
            'categories' => Tr::map(LoanProduct::CATEGORIES),
            'methods' => Tr::map(LoanProduct::METHODS),
            'frequencies' => Tr::map(LoanProduct::FREQUENCIES),
            'buckets' => Tr::map(LoanService::BUCKETS),
            'pay_methods' => Tr::map(Receipt::METHODS),
            'max_guarantees' => (int) SettingService::get('loan_max_guarantees', 2),
        ]);
    }

    /** Member picker for borrowers and guarantors: balances, open loan and guarantees in use. */
    public function members(Request $request): JsonResponse
    {
        $search = trim((string) $request->query('search'));
        $en = Bn::toEnDigits($search);
        $rows = Member::with(['farmer:id,farmer_code,name_bn,name_en,father_name,mobile'])
            ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w->when(ctype_digit($en), fn ($x) => $x->orWhere('member_no', (int) $en))
                ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                    ->orWhere('farmer_code', 'like', "%$en%")->orWhere('mobile', 'like', "%$en%"))))
            ->when(ctype_digit($en), fn ($q) => $q->orderByRaw('member_no = ? desc', [(int) $en]))
            ->orderBy('member_no')->limit(20)->get();
        $ids = $rows->pluck('id');
        $balances = MemberAccount::whereIn('member_id', $ids)->get()->groupBy('member_id');
        $open = Loan::whereIn('member_id', $ids)->whereIn('status', Loan::OPEN)->get(['id', 'member_id', 'loan_no', 'status'])->keyBy('member_id');

        return response()->json($rows->map(fn (Member $m) => [
            'id' => $m->id, 'member_no' => $m->member_no, 'status' => $m->status, 'farmer' => $m->farmer,
            'savings' => round((float) ($balances[$m->id] ?? collect())->firstWhere('kind', 'savings')?->balance, 2),
            'share' => round((float) ($balances[$m->id] ?? collect())->firstWhere('kind', 'share')?->balance, 2),
            'open_loan' => $open[$m->id] ?? null,
            'guarantees' => $this->loans->guaranteeCount($m->id),
        ]));
    }

    public function eligibility(Request $request): JsonResponse
    {
        $data = $request->validate(['member_id' => ['required', 'exists:members,id'], 'product_id' => ['required', 'exists:loan_products,id']]);
        $member = Member::findOrFail($data['member_id']);

        return response()->json($this->loans->limitFor($member, LoanProduct::findOrFail($data['product_id'])) + [
            'member_status' => $member->status,
            'open_loan' => $this->loans->openLoan($member->id)?->only(['id', 'loan_no', 'status']),
        ]);
    }

    public function index(Request $request)
    {
        $q = $this->query($request);
        $statuses = Tr::map(Loan::STATUSES);
        if ($request->query('export') === 'csv') {
            return CsvExport::download('loans-'.now()->format('Ymd').'.csv',
                [__('ঋণ নং'), __('সদস্য নং'), __('নাম'), __('ঋণের ধরন'), __('আবেদনের তারিখ'), __('বিতরণের তারিখ'), __('ঋণের পরিমাণ'), __('মোট সুদ'), __('আসল বাকি'), __('অবস্থা')],
                $q->with(['member.farmer', 'product'])->withSum('schedule as principal_paid', 'principal_paid')->orderBy('id')->lazy()->map(fn (Loan $l) => [
                    $l->loan_no, $l->member?->member_no, $l->member?->farmer?->name_bn, $l->product?->name_bn, $l->applied_on, $l->disbursed_on,
                    $l->amount, $l->total_interest, $l->disbursed_on ? round((float) $l->amount - (float) $l->principal_paid, 2) : '', $statuses[$l->status] ?? $l->status,
                ]));
        }
        $totals = (clone $q)->reorder()->selectRaw("COUNT(*) c, COALESCE(SUM(CASE WHEN status IN ('active','closed') THEN amount END), 0) d")->first();
        $page = $q->with([...self::MEMBER, 'product:id,code,name_bn,name_en'])
            ->withSum('schedule as principal_paid', 'principal_paid')->withSum('schedule as interest_paid', 'interest_paid')
            ->orderByDesc('id')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Loan $l) => $l->setAttribute('principal_outstanding',
            in_array($l->status, ['active', 'closed'], true) ? round((float) $l->amount - (float) $l->principal_paid, 2) : null));

        return response()->json($page->toArray() + ['totals' => ['loans' => (int) $totals->c, 'disbursed' => round((float) $totals->d, 2)]]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'member_id' => ['required', 'exists:members,id'],
            'product_id' => ['required', 'exists:loan_products,id'],
            'applied_on' => ['required', 'date', 'before_or_equal:today'],
            'amount' => ['required', 'numeric', 'min:1', 'max:9999999999999'],
            'purpose' => ['nullable', 'string', 'max:300'],
            'remarks' => ['nullable', 'string', 'max:500'],
            'guarantors' => ['array', 'max:5'],
            'guarantors.*.member_id' => ['required', 'integer'],
            'guarantors.*.relation' => ['nullable', 'string', 'max:100'],
        ]);
        $loan = $this->loans->apply($data);

        return response()->json(['id' => $loan->id, 'loan_no' => $loan->loan_no, 'status' => $loan->status,
            'message' => $loan->status === 'pending' ? __('অনুমোদনের জন্য পাঠানো হয়েছে।') : __('ঋণ অনুমোদিত হয়েছে।')], 201);
    }

    public function show(Loan $loan): JsonResponse
    {
        $loan->load([...self::MEMBER, 'product', 'guarantors.member:id,farmer_id,member_no,status', 'guarantors.member.farmer:id,farmer_code,name_bn,name_en,father_name,mobile',
            'fund:id,code,name_bn,name_en', 'journal:id,voucher_no,status', 'creator:id,name_bn,name_en', 'disburser:id,name_bn,name_en']);
        $position = in_array($loan->status, ['active', 'closed'], true) ? $this->loans->position($loan) : null;
        $preview = $position ? null : $this->loans->buildSchedule($loan->only(['interest_rate', 'interest_method', 'frequency', 'installments', 'term_months']),
            (float) $loan->amount, $this->loans->defaultFirstDue($loan->only(['frequency', 'term_months']), now()->toDateString()));

        return response()->json($loan->toArray() + [
            'position' => $position,
            'preview' => $preview,
            'payments' => $loan->payments()->with('creator:id,name_bn,name_en')->orderByDesc('date')->orderByDesc('id')->get(),
            'approval' => $loan->approvalRequest?->only(['id', 'status', 'current_step', 'total_steps']),
        ]);
    }

    /** Loan statement: disbursement, then every payment split three ways, with principal still owed. */
    public function statement(Request $request, Loan $loan)
    {
        abort_unless($loan->disbursed_on, 422, __('ঋণটি এখনও বিতরণ হয়নি।'));
        $payments = $loan->payments()->whereIn('status', ['posted', 'cancel_pending'])->orderBy('date')->orderBy('id')->get();
        $bal = (float) $loan->amount;
        $rows = collect([['date' => $loan->disbursed_on->toDateString(), 'ref' => $loan->loan_no, 'label' => __('ঋণ বিতরণ'), 'disbursed' => $bal,
            'paid' => 0.0, 'penalty' => 0.0, 'interest' => 0.0, 'principal' => 0.0, 'balance' => $bal, 'id' => null]]);
        foreach ($payments as $p) {
            $bal = round($bal - (float) $p->principal, 2);
            $rows->push(['date' => $p->date->toDateString(), 'ref' => $p->payment_no, 'label' => __('কিস্তি পরিশোধ'), 'disbursed' => 0.0,
                'paid' => (float) $p->amount, 'penalty' => (float) $p->penalty, 'interest' => (float) $p->interest, 'principal' => (float) $p->principal,
                'balance' => $bal, 'id' => $p->id]);
        }
        $totals = ['paid' => round($payments->sum(fn ($p) => (float) $p->amount), 2), 'penalty' => round($payments->sum(fn ($p) => (float) $p->penalty), 2),
            'interest' => round($payments->sum(fn ($p) => (float) $p->interest), 2), 'principal' => round($payments->sum(fn ($p) => (float) $p->principal), 2)];

        if ($request->query('export') === 'csv') {
            return CsvExport::download('loan-statement-'.$loan->loan_no.'.csv',
                [__('তারিখ'), __('রেফারেন্স'), __('বিবরণ'), __('বিতরণ'), __('পরিশোধ'), __('জরিমানা'), __('সুদ'), __('আসল'), __('আসল বাকি')],
                $rows->map(fn ($r) => [$r['date'], $r['ref'], $r['label'], $r['disbursed'], $r['paid'], $r['penalty'], $r['interest'], $r['principal'], $r['balance']]));
        }

        return response()->json(['loan' => $loan->only(['id', 'loan_no', 'amount', 'status']), 'rows' => $rows->values(), 'totals' => $totals, 'closing' => $bal]);
    }

    public function disburse(Request $request, Loan $loan): JsonResponse
    {
        $data = $request->validate([
            'date' => ['required', 'date', 'before_or_equal:today'],
            'method' => ['required', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'first_due_on' => ['nullable', 'date'],
        ]);
        $loan = $this->loans->disburse($loan, $data);

        return response()->json(['id' => $loan->id, 'status' => $loan->status, 'message' => __('ঋণ বিতরণ সম্পন্ন হয়েছে।')]);
    }

    public function cancel(Request $request, Loan $loan): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);
        $this->loans->cancelApplication($loan, $data['reason']);

        return response()->json(['message' => __('ঋণ আবেদন বাতিল হয়েছে।')]);
    }

    public function pay(Request $request, Loan $loan): JsonResponse
    {
        $this->allowCollect($request);
        $data = $request->validate([
            'date' => ['required', 'date', 'before_or_equal:today'],
            'amount' => ['required', 'numeric', 'min:0.01', 'max:9999999999999'],
            'method' => ['required', Rule::in(array_keys(Receipt::METHODS))],
            'fund_account_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:100'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $payment = $this->loans->pay($loan, $data);
        $farmer = $loan->member?->farmer;
        $payment->status === 'posted' && app(SmsService::class)->paymentConfirmation($farmer?->mobile, (string) $farmer?->name_bn, (float) $payment->amount, $payment->payment_no, $data['date'], $payment);

        return response()->json(['id' => $payment->id, 'payment_no' => $payment->payment_no, 'status' => $payment->status,
            'loan_status' => $loan->fresh()->status, 'message' => __('কিস্তি জমা হয়েছে।')], 201);
    }

    /** What is owed on a date — for the payment form. */
    public function position(Request $request, Loan $loan): JsonResponse
    {
        $data = $request->validate(['date' => ['nullable', 'date']]);
        abort_unless($loan->disbursed_on, 422, __('ঋণটি এখনও বিতরণ হয়নি।'));

        return response()->json($this->loans->position($loan, $data['date'] ?? null));
    }

    public function payments(Request $request)
    {
        $q = LoanPayment::query()->when($request->filled('loan_id'), fn ($x) => $x->where('loan_id', $request->query('loan_id')))
            ->when($request->filled('status'), fn ($x) => $x->where('status', $request->query('status')))
            ->when($request->filled('method'), fn ($x) => $x->where('method', $request->query('method')))
            ->when($request->filled('from'), fn ($x) => $x->where('date', '>=', $request->query('from')))
            ->when($request->filled('to'), fn ($x) => $x->where('date', '<=', $request->query('to')));
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('payment_no', 'like', "%$en%")->orWhere('reference', 'like', "%$en%")
                ->orWhereHas('loan', fn ($l) => $l->where('loan_no', 'like', "%$en%")
                    ->orWhereHas('member', fn ($m) => $m->when(ctype_digit($en), fn ($x) => $x->where('member_no', (int) $en))
                        ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")))));
        }
        $statuses = Tr::map(LoanPayment::STATUSES);
        if ($request->query('export') === 'csv') {
            return CsvExport::download('loan-payments-'.now()->format('Ymd').'.csv',
                [__('রশিদ নং'), __('তারিখ'), __('ঋণ নং'), __('নাম'), __('মোট'), __('জরিমানা'), __('সুদ'), __('আসল'), __('অবস্থা')],
                $q->with('loan.member.farmer')->orderBy('date')->orderBy('id')->lazy()->map(fn (LoanPayment $p) => [
                    $p->payment_no, $p->date, $p->loan?->loan_no, $p->loan?->member?->farmer?->name_bn, $p->amount, $p->penalty, $p->interest, $p->principal,
                    $statuses[$p->status] ?? $p->status,
                ]));
        }
        $sums = (clone $q)->whereIn('status', ['posted', 'cancel_pending'])
            ->selectRaw('COALESCE(SUM(amount),0) a, COALESCE(SUM(penalty),0) pe, COALESCE(SUM(interest),0) i, COALESCE(SUM(principal),0) pr')->first();

        return response()->json($q->with(['loan:id,loan_no,member_id', 'loan.member:id,farmer_id,member_no', 'loan.member.farmer:id,farmer_code,name_bn,name_en'])
            ->orderByDesc('date')->orderByDesc('id')->paginate($this->perPage($request))->toArray()
            + ['totals' => ['amount' => round((float) $sums->a, 2), 'penalty' => round((float) $sums->pe, 2), 'interest' => round((float) $sums->i, 2), 'principal' => round((float) $sums->pr, 2)]]);
    }

    /** One payment — also the printable receipt. */
    public function showPayment(LoanPayment $payment): JsonResponse
    {
        $payment->load(['loan:id,loan_no,member_id,amount,product_id,status', 'loan.product:id,name_bn,name_en', 'loan.member:id,farmer_id,member_no',
            'loan.member.farmer:id,farmer_code,name_bn,name_en,father_name,mobile', 'fund:id,code,name_bn,name_en',
            'journal:id,voucher_no,status,reversed_by_id', 'journal.reversedBy:id,voucher_no', 'creator:id,name_bn,name_en']);
        $latest = ! LoanPayment::where('loan_id', $payment->loan_id)->where('status', 'posted')->where('id', '>', $payment->id)->exists();

        return response()->json($payment->toArray() + [
            'can_cancel' => $payment->status === 'posted' && $latest,
            'society' => SettingService::society(),
        ]);
    }

    public function cancelPayment(Request $request, LoanPayment $payment): JsonResponse
    {
        $this->allowCollect($request);
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);

        return response()->json($this->loans->requestPaymentCancel($payment, $data['reason']), 201);
    }

    /**
     * Due list with overdue aging on a date: every running loan with money
     * past due, how long the oldest unpaid instalment has waited and the
     * penalty so far. `upcoming` adds loans with an instalment due within N days.
     */
    public function dues(Request $request)
    {
        $data = $request->validate([
            'as_of' => ['nullable', 'date'], 'bucket' => ['nullable', Rule::in(array_keys(LoanService::BUCKETS))],
            'upcoming' => ['nullable', 'integer', 'min:0', 'max:90'], 'search' => ['nullable', 'string', 'max:100'],
        ]);
        $asOf = $data['as_of'] ?? now()->toDateString();
        $until = Carbon::parse($asOf)->addDays((int) ($data['upcoming'] ?? 0))->toDateString();
        $loans = $this->query($request)->where('status', 'active')->where('disbursed_on', '<=', $asOf)
            ->whereHas('schedule', fn ($s) => $s->where('due_date', '<=', $until)->whereRaw('principal + interest > principal_paid + interest_paid'))
            ->with([...self::MEMBER, 'member.farmer.village:id,name_bn,name_en', 'product:id,code,name_bn,name_en', 'schedule'])->orderBy('loan_no')->get();

        $rows = $loans->map(function (Loan $l) use ($asOf, $until) {
            $p = $this->loans->position($l, $asOf, $l->schedule);
            $next = collect($p['installments'])->first(fn ($i) => $i['outstanding'] > 0 && $i['due_date'] >= $asOf && $i['due_date'] <= $until);

            return [
                'id' => $l->id, 'loan_no' => $l->loan_no, 'member' => $l->member, 'product' => $l->product, 'amount' => (float) $l->amount,
                'principal_outstanding' => $p['principal_outstanding'], 'overdue_amount' => $p['overdue_amount'], 'penalty_due' => $p['penalty_due'],
                'due_now' => $p['due_now'], 'days_overdue' => $p['days_overdue'], 'oldest_overdue' => $p['oldest_overdue'], 'bucket' => $p['bucket'],
                'next_due' => $next ? ['date' => $next['due_date'], 'amount' => $next['outstanding']] : null,
                'overdue_installments' => collect($p['installments'])->where('overdue', true)->count(),
            ];
        })->filter(fn ($r) => $r['bucket'] || $r['next_due']);

        $summary = [];
        foreach (array_keys(LoanService::BUCKETS) as $b) {
            $g = $rows->where('bucket', $b);
            $summary[$b] = ['loans' => $g->count(), 'overdue' => round($g->sum('overdue_amount'), 2), 'penalty' => round($g->sum('penalty_due'), 2),
                'principal' => round($g->sum('principal_outstanding'), 2)];
        }
        if (! empty($data['bucket'])) {
            $rows = $rows->where('bucket', $data['bucket']);
        }
        $rows = $rows->sortByDesc('days_overdue')->values();
        $buckets = Tr::map(LoanService::BUCKETS);

        if ($request->query('export') === 'csv') {
            return CsvExport::download('loan-dues-'.$asOf.'.csv',
                [__('ঋণ নং'), __('সদস্য নং'), __('নাম'), __('মোবাইল'), __('আসল বাকি'), __('মেয়াদোত্তীর্ণ'), __('জরিমানা'), __('এখন দেয়'), __('দিন'), __('মেয়াদোত্তীর্ণের সময়')],
                $rows->map(fn ($r) => [$r['loan_no'], $r['member']?->member_no, $r['member']?->farmer?->name_bn, $r['member']?->farmer?->mobile,
                    $r['principal_outstanding'], $r['overdue_amount'], $r['penalty_due'], $r['due_now'], $r['days_overdue'], $r['bucket'] ? $buckets[$r['bucket']] : '']));
        }

        return response()->json([
            'as_of' => $asOf, 'rows' => $rows, 'summary' => $summary,
            'total' => ['loans' => $rows->count(), 'overdue' => round($rows->sum('overdue_amount'), 2), 'penalty' => round($rows->sum('penalty_due'), 2),
                'due_now' => round($rows->sum('due_now'), 2)],
        ]);
    }

    /**
     * Loan book vs ledger: principal still owed on every disbursed loan must
     * equal the loans receivable account; every loan's payments must add up
     * to what its schedule shows paid, and every posting must have its voucher.
     */
    public function audit(): JsonResponse
    {
        $issues = collect();
        $book = 0.0;
        Loan::whereIn('status', ['active', 'closed'])->with('schedule', 'journal:id,status,amount', 'member.farmer:id,name_bn')->orderBy('id')
            ->chunk(200, function ($chunk) use (&$issues, &$book) {
                foreach ($chunk as $l) {
                    $name = $l->member?->farmer?->name_bn;
                    $scheduled = round($l->schedule->sum(fn ($i) => (float) $i->principal), 2);
                    $owed = round($l->schedule->sum(fn ($i) => $i->principalDue()), 2);
                    $book += $owed;
                    $paid = $l->payments()->whereIn('status', ['posted', 'cancel_pending'])
                        ->selectRaw('COALESCE(SUM(principal),0) pr, COALESCE(SUM(interest),0) i, COALESCE(SUM(penalty),0) pe')->first();
                    if ($scheduled !== round((float) $l->amount, 2)) {
                        $issues->push(['kind' => 'schedule', 'loan_id' => $l->id, 'ref' => $l->loan_no, 'name' => $name, 'expected' => (float) $l->amount, 'actual' => $scheduled]);
                    }
                    foreach (['pr' => 'principal_paid', 'i' => 'interest_paid', 'pe' => 'penalty_paid'] as $k => $col) {
                        $inSchedule = round($l->schedule->sum(fn ($x) => (float) $x->{$col}), 2);
                        if (round((float) $paid->{$k}, 2) !== $inSchedule) {
                            $issues->push(['kind' => 'payments', 'loan_id' => $l->id, 'ref' => $l->loan_no, 'name' => $name, 'expected' => round((float) $paid->{$k}, 2), 'actual' => $inSchedule]);
                        }
                    }
                    if ($l->status === 'closed' && $owed > 0) {
                        $issues->push(['kind' => 'closed_open', 'loan_id' => $l->id, 'ref' => $l->loan_no, 'name' => $name, 'expected' => 0, 'actual' => $owed]);
                    }
                    if (! $l->journal || $l->journal->status !== 'posted' || round((float) $l->journal->amount, 2) !== round((float) $l->amount, 2)) {
                        $issues->push(['kind' => 'voucher', 'loan_id' => $l->id, 'ref' => $l->loan_no, 'name' => $name, 'expected' => (float) $l->amount, 'actual' => $l->journal ? (float) $l->journal->amount : null]);
                    }
                }
            });
        LoanPayment::whereIn('status', ['posted', 'cancel_pending', 'cancelled'])->with(['journal:id,status,amount', 'loan:id,loan_no'])->orderBy('id')
            ->chunk(500, function ($chunk) use (&$issues) {
                foreach ($chunk as $p) {
                    $want = $p->status === 'cancelled' ? 'reversed' : 'posted';
                    if (! $p->journal || $p->journal->status !== $want || round((float) $p->journal->amount, 2) !== round((float) $p->amount, 2)) {
                        $issues->push(['kind' => 'voucher', 'payment_id' => $p->id, 'ref' => $p->payment_no, 'name' => $p->loan?->loan_no, 'expected' => (float) $p->amount, 'actual' => $p->journal ? (float) $p->journal->amount : null]);
                    }
                }
            });

        $book = round($book, 2);
        $account = Account::byKey('loans_receivable');
        $ledger = round($this->ledger->balance($account->id), 2); // asset: debit − credit
        $income = fn (string $key) => round(-$this->ledger->balance(Account::byKey($key)->id), 2) + 0.0;

        return response()->json([
            'book_balance' => $book, 'ledger_balance' => $ledger, 'difference' => round($ledger - $book, 2),
            'loans' => Loan::whereIn('status', ['active', 'closed'])->count(),
            'account' => $account->only(['id', 'code', 'name_bn', 'name_en']),
            'interest_income' => $income('loan_interest_income'), 'penalty_income' => $income('loan_penalty_income'),
            'issues' => $issues->values(),
            'kinds' => [
                'schedule' => __('কিস্তির তালিকার আসল ঋণের পরিমাণের সমান নয়'),
                'payments' => __('পরিশোধের যোগফল ও কিস্তিতে জমা মেলে না'),
                'closed_open' => __('পরিশোধিত ঋণে আসল বাকি'),
                'voucher' => __('ভাউচার নেই বা মেলে না'),
            ],
        ]);
    }

    private function query(Request $request): Builder
    {
        $q = Loan::query();
        foreach (['status', 'product_id', 'member_id'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('from')) {
            $q->where('applied_on', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->where('applied_on', '<=', $request->query('to'));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('loan_no', 'like', "%$en%")
                ->orWhereHas('member', fn ($m) => $m->when(ctype_digit($en), fn ($x) => $x->where('member_no', (int) $en))
                    ->orWhereHas('farmer', fn ($f) => $f->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%")
                        ->orWhere('farmer_code', 'like', "%$en%")->orWhere('mobile', 'like', "%$en%"))));
        }

        return $q;
    }

    /** Repayments are taken by loan staff and by cashiers. */
    private function allowCollect(Request $request): void
    {
        abort_unless($request->user()->can('loan.create') || $request->user()->can('payment.create'), 403, __('অনুমতি নেই'));
    }
}
