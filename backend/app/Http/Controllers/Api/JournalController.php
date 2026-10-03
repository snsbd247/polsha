<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\BankAccount;
use App\Models\Journal;
use App\Models\JournalLine;
use App\Services\LedgerService;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class JournalController extends Controller
{
    public function __construct(private LedgerService $ledger) {}

    public function index(Request $request)
    {
        $q = Journal::with('creator:id,name_bn,name_en')
            ->when($request->query('type'), fn ($q, $v) => $q->where('voucher_type', $v))
            ->when($request->query('status'), fn ($q, $v) => $q->where('status', $v))
            ->when($request->query('from'), fn ($q, $v) => $q->where('date', '>=', $v))
            ->when($request->query('to'), fn ($q, $v) => $q->where('date', '<=', $v))
            ->when($request->query('account_id'), fn ($q, $v) => $q->whereHas('lines', fn ($l) => $l->where('account_id', $v)))
            ->when($request->query('search'), fn ($q, $v) => $q->where(fn ($w) => $w->where('voucher_no', 'like', "%$v%")->orWhere('narration', 'like', "%$v%")))
            ->orderByDesc('date')->orderByDesc('id');

        if ($request->query('export') === 'csv') {
            $types = Tr::map(Journal::TYPES);
            $statuses = Tr::map(Journal::STATUSES);

            return CsvExport::download('vouchers.csv', [__('ভাউচার নং'), __('তারিখ'), __('ধরন'), __('বিবরণ'), __('পরিমাণ'), __('অবস্থা')],
                $q->lazy()->map(fn ($j) => [$j->voucher_no, $j->date, $types[$j->voucher_type] ?? $j->voucher_type, $j->narration, $j->amount, $statuses[$j->status] ?? $j->status]));
        }

        $month = fn () => Journal::where('date', '>=', now()->startOfMonth()->toDateString())->where('status', 'posted');

        $page = $q->paginate($this->perPage($request));
        $summaries = $this->summaries($page->getCollection());
        $page->getCollection()->each(fn ($j) => $j->setAttribute('summary', $summaries[$j->id] ?? null));

        return response()->json($page->toArray() + [
            'types' => Tr::map(Journal::TYPES), 'statuses' => Tr::map(Journal::STATUSES),
            // the voucher cards: all, posted this month (count and money), waiting for approval, reversed
            'counts' => [
                'total' => Journal::count(),
                'month' => $month()->count(),
                'month_amount' => round((float) $month()->sum('amount'), 2),
                'pending' => Journal::where('status', 'pending')->count(),
                'reversed' => Journal::where('status', 'reversed')->count(),
            ],
        ]);
    }

    public function show(Journal $journal): JsonResponse
    {
        $journal->load(['lines.account:id,code,name_bn,name_en,type', 'creator:id,name_bn,name_en', 'poster:id,name_bn,name_en',
            'reversalOf:id,voucher_no', 'reversedBy:id,voucher_no', 'period:id,period_key,status']);

        return response()->json($journal->toArray() + [
            'source_label' => $journal->source_type ? class_basename($journal->source_type) : null,
            'can_reverse' => $journal->status === 'posted' && ! $journal->reversal_of_id,
            'types' => Tr::map(Journal::TYPES), 'statuses' => Tr::map(Journal::STATUSES),
        ]);
    }

    /** Manual journal or opening-balance voucher → pending approval. */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $lines = $data['lines'];
        if ($data['voucher_type'] === 'opening') {
            $lines = $this->balanceOpening($lines);
        }

        return response()->json($this->ledger->submit($data['voucher_type'], $data['date'], $data['narration'] ?? null, $lines), 201);
    }

    public function update(Request $request, Journal $journal): JsonResponse
    {
        $data = $this->validated($request);
        $lines = $journal->voucher_type === 'opening' ? $this->balanceOpening($data['lines']) : $data['lines'];

        return response()->json($this->ledger->resubmit($journal, $data['date'], $data['narration'] ?? null, $lines));
    }

    public function reverse(Request $request, Journal $journal): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:300']]);

        return response()->json($this->ledger->requestReversal($journal, $data['reason']), 201);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'voucher_type' => ['required', Rule::in(['journal', 'opening', 'payment', 'receipt', 'contra'])],
            'date' => ['required', 'date'],
            'narration' => ['nullable', 'string', 'max:500'],
            'lines' => ['required', 'array', 'min:1', 'max:100'],
            'lines.*.account_id' => ['required', 'exists:chart_of_accounts,id'],
            'lines.*.debit' => ['nullable', 'numeric', 'min:0', 'max:9999999999999'],
            'lines.*.credit' => ['nullable', 'numeric', 'min:0', 'max:9999999999999'],
            'lines.*.remarks' => ['nullable', 'string', 'max:255'],
        ]);
    }

    /** Opening balances: the difference goes to "Opening Balance Equity" so users enter only real balances. */
    private function balanceOpening(array $lines): array
    {
        $obe = Account::byKey('opening_balance_equity');
        $lines = array_values(array_filter($lines, fn ($l) => (int) $l['account_id'] !== $obe->id));
        $diff = round(array_sum(array_map(fn ($l) => (float) ($l['debit'] ?? 0) - (float) ($l['credit'] ?? 0), $lines)), 2);
        if ($diff != 0) {
            $lines[] = ['account_id' => $obe->id, 'debit' => $diff < 0 ? -$diff : 0, 'credit' => $diff > 0 ? $diff : 0];
        }

        return $lines;
    }

    /**
     * What each voucher did, in plain words: money in to a cash or bank
     * account for some heads, money out of one, a move between them, or an
     * adjustment that touches no money at all.
     *
     * @return array<int, string>
     */
    private function summaries($journals): array
    {
        $en = app()->getLocale() === 'en';
        $name = fn ($a) => $en && $a->name_en ? $a->name_en : $a->name_bn;
        $banks = BankAccount::pluck('account_id')->flip();
        $isFund = fn ($a) => str_starts_with((string) $a->key, 'cash_') || isset($banks[$a->id]);
        $lines = JournalLine::with('account:id,key,name_bn,name_en')->whereIn('journal_id', $journals->pluck('id'))->get()->groupBy('journal_id');
        $out = [];
        foreach ($lines as $jid => $ls) {
            $funds = $ls->filter(fn ($l) => $l->account && $isFund($l->account));
            $others = $ls->reject(fn ($l) => $l->account && $isFund($l->account));
            $list = fn ($c) => $c->map(fn ($l) => $name($l->account))->unique()->take(3)->implode(', ');
            $net = round($funds->sum(fn ($l) => (float) $l->debit - (float) $l->credit), 2);
            $out[$jid] = match (true) {
                $funds->isEmpty() => __('সমন্বয় — :a', ['a' => $list($ls)]),
                $others->isEmpty() => __('স্থানান্তর — :from থেকে :to', ['from' => $list($funds->filter(fn ($l) => $l->credit > 0)), 'to' => $list($funds->filter(fn ($l) => $l->debit > 0))]),
                $net > 0 => __('টাকা এলো — :heads (জমা: :fund)', ['heads' => $list($others), 'fund' => $list($funds)]),
                default => __('টাকা গেল — :heads (:fund থেকে)', ['heads' => $list($others), 'fund' => $list($funds)]),
            };
        }

        return $out;
    }
}
