<?php

namespace App\Services;

use App\Models\Account;
use App\Models\JournalLine;
use Illuminate\Support\Facades\DB;

/** Read-only views over posted journals. Balances are shown in the account's natural sign. */
class AccountingReportService
{
    public function __construct(private LedgerService $ledger) {}

    /** General ledger / cash book / bank statement for one account. */
    public function ledger(Account $account, string $from, string $to): array
    {
        $sign = $account->isDebitNature() ? 1 : -1;
        $opening = $this->ledger->balance($account->id, $from, true) * $sign;

        $lines = JournalLine::with(['journal:id,voucher_no,voucher_type,date,narration,status,reversal_of_id', 'journal.lines.account:id,code,name_bn,name_en'])
            ->where('account_id', $account->id)
            ->whereHas('journal', fn ($q) => $q->whereIn('status', LedgerService::EFFECTIVE)->whereBetween('date', [$from, $to]))
            ->get()
            ->sortBy(fn ($l) => $l->journal->date->format('Y-m-d').sprintf('%012d', $l->journal_id))
            ->values();

        $running = $opening;
        $rows = $lines->map(function (JournalLine $l) use (&$running, $sign) {
            $running = round($running + ($l->debit - $l->credit) * $sign, 2);
            // "Against" = the other side(s) of the voucher, what a cash book shows as particulars.
            $against = $l->journal->lines->where('account_id', '!=', $l->account_id)->map(fn ($o) => $o->account->only(['id', 'code', 'name_bn', 'name_en']))->unique('id')->values();

            return [
                'line_id' => $l->id, 'journal_id' => $l->journal_id, 'date' => $l->journal->date->format('Y-m-d'),
                'voucher_no' => $l->journal->voucher_no, 'voucher_type' => $l->journal->voucher_type,
                'narration' => $l->journal->narration, 'remarks' => $l->remarks, 'against' => $against,
                'debit' => (float) $l->debit, 'credit' => (float) $l->credit, 'balance' => $running,
                'reconciled_at' => $l->reconciled_at?->toDateTimeString(),
            ];
        });

        return [
            'account' => $account->only(['id', 'key', 'code', 'name_bn', 'name_en', 'type']),
            'from' => $from, 'to' => $to,
            'opening' => round($opening, 2),
            'rows' => $rows,
            'total_debit' => round($lines->sum('debit'), 2),
            'total_credit' => round($lines->sum('credit'), 2),
            'closing' => round($running, 2),
        ];
    }

    /** Trial balance as of a date: every postable account with a non-zero balance. */
    public function trialBalance(string $asOf): array
    {
        $sums = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', '<=', $asOf)
            ->groupBy('journal_lines.account_id')
            ->selectRaw('journal_lines.account_id, SUM(journal_lines.debit) d, SUM(journal_lines.credit) c')
            ->get()->keyBy('account_id');

        $rows = Account::where('is_postable', true)->orderBy('code')->get()
            ->map(function (Account $a) use ($sums) {
                $s = $sums[$a->id] ?? null;
                $net = round((float) ($s->d ?? 0) - (float) ($s->c ?? 0), 2);

                return $a->only(['id', 'code', 'name_bn', 'name_en', 'type']) + [
                    'debit' => $net > 0 ? $net : 0.0, 'credit' => $net < 0 ? -$net : 0.0,
                ];
            })
            ->filter(fn ($r) => $r['debit'] != 0 || $r['credit'] != 0)->values();

        $dr = round($rows->sum('debit'), 2);
        $cr = round($rows->sum('credit'), 2);

        return ['as_of' => $asOf, 'rows' => $rows, 'total_debit' => $dr, 'total_credit' => $cr, 'balanced' => $dr === $cr];
    }

    /** Net movement per account in a date range (debit − credit), optionally skipping year-end close journals. */
    private function sums(?string $from, string $to, bool $skipYearClose = false)
    {
        return DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', '<=', $to)
            ->when($from, fn ($q) => $q->where('journals.date', '>=', $from))
            ->when($skipYearClose, fn ($q) => $q->where(fn ($w) => $w->whereNull('journals.module')->orWhere('journals.module', '!=', FinancialYearService::MODULE)))
            ->groupBy('journal_lines.account_id')
            ->selectRaw('journal_lines.account_id, SUM(journal_lines.debit) - SUM(journal_lines.credit) as net')
            ->pluck('net', 'account_id');
    }

    /** Income & expenditure for a period; the year-end close entry is left out so closed years still show their result. */
    public function incomeStatement(string $from, string $to): array
    {
        $net = $this->sums($from, $to, true);
        $rows = fn (string $type, int $sign) => Account::where('is_postable', true)->where('type', $type)->orderBy('code')->get()
            ->map(fn (Account $a) => $a->only(['id', 'code', 'name_bn', 'name_en']) + ['amount' => round((float) ($net[$a->id] ?? 0) * $sign, 2)])
            ->filter(fn ($r) => $r['amount'] != 0)->values();
        $income = $rows('income', -1);
        $expense = $rows('expense', 1);
        $ti = round($income->sum('amount'), 2);
        $te = round($expense->sum('amount'), 2);

        return ['income' => $income, 'expense' => $expense, 'total_income' => $ti, 'total_expense' => $te, 'surplus' => round($ti - $te, 2)];
    }

    /** Statement of financial position. Income/expense not yet swept by a year-end close shows as current surplus. */
    public function balanceSheet(string $asOf): array
    {
        $net = $this->sums(null, $asOf);
        $out = [];
        foreach (['asset' => 1, 'liability' => -1, 'equity' => -1] as $type => $sign) {
            $out[$type] = Account::where('is_postable', true)->where('type', $type)->orderBy('code')->get()
                ->map(fn (Account $a) => $a->only(['id', 'code', 'name_bn', 'name_en']) + ['amount' => round((float) ($net[$a->id] ?? 0) * $sign, 2)])
                ->filter(fn ($r) => $r['amount'] != 0)->values()->all();
        }
        $pl = Account::whereIn('type', ['income', 'expense'])->pluck('id');
        $surplus = round(-$pl->sum(fn ($id) => (float) ($net[$id] ?? 0)), 2);
        if ($surplus != 0) {
            $out['equity'][] = ['id' => null, 'code' => '', 'name_bn' => __('চলতি উদ্বৃত্ত / (ঘাটতি) — বছর বন্ধ হয়নি'), 'name_en' => null, 'amount' => $surplus];
        }
        $ta = round(array_sum(array_column($out['asset'], 'amount')), 2);
        $tle = round(array_sum(array_column($out['liability'], 'amount')) + array_sum(array_column($out['equity'], 'amount')), 2);

        return $out + ['total_assets' => $ta, 'total_liabilities_equity' => $tle, 'balanced' => abs($ta - $tle) < 0.01];
    }

    /** Postable cash-in-hand streams and bank-linked accounts. */
    public function fundAccountIds(): array
    {
        return Account::where('is_postable', true)->where(fn ($q) => $q->whereIn('key', Account::CASH_STREAMS)->orWhereHas('bankAccount'))->pluck('id')->all();
    }

    /** Receipts into cash/bank (posted, not reversed), line-level. */
    public function collectionQuery(string $from, string $to)
    {
        return DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')
            ->where('j.voucher_type', 'receipt')->where('j.status', 'posted')->whereNull('j.reversal_of_id')
            ->whereBetween('j.date', [$from, $to])->whereIn('l.account_id', $this->fundAccountIds())->where('l.debit', '>', 0);
    }

    /** [date => [module => amount]] */
    public function collectionsByDay(string $from, string $to): array
    {
        $out = [];
        $this->collectionQuery($from, $to)->groupBy('j.date', 'j.module')->orderBy('j.date')
            ->selectRaw('j.date as d, j.module as m, SUM(l.debit) as amount')->get()
            ->each(function ($r) use (&$out) {
                $d = substr((string) $r->d, 0, 10);
                $out[$d][$r->m ?? 'other'] = round(($out[$d][$r->m ?? 'other'] ?? 0) + (float) $r->amount, 2);
            });

        return $out;
    }

    /** Cash flow: net cash/bank movement per journal, grouped by module; transfers between funds are skipped. */
    public function cashFlow(string $from, string $to): array
    {
        $funds = $this->fundAccountIds();
        $opening = round(collect($funds)->sum(fn ($id) => $this->ledger->balance($id, $from, true)), 2);
        $modules = config('erp.modules');

        $journals = DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')
            ->whereIn('j.status', LedgerService::EFFECTIVE)->whereBetween('j.date', [$from, $to])
            ->groupBy('j.id', 'j.module')
            ->selectRaw('j.id, j.module, SUM(CASE WHEN l.account_id IN ('.($funds ? implode(',', array_map('intval', $funds)) : '0').') THEN l.debit - l.credit ELSE 0 END) as fund_net')
            ->get();

        $in = [];
        $out = [];
        foreach ($journals as $j) {
            $n = round((float) $j->fund_net, 2);
            if ($n == 0) {
                continue; // contra or a non-cash entry
            }
            $label = $j->module ? __($modules[$j->module] ?? $j->module) : __('সাধারণ ভাউচার');
            if ($n > 0) {
                $in[$label] = round(($in[$label] ?? 0) + $n, 2);
            } else {
                $out[$label] = round(($out[$label] ?? 0) - $n, 2);
            }
        }
        $toRows = fn ($a) => collect($a)->map(fn ($amount, $label) => ['label' => $label, 'amount' => $amount])->sortByDesc('amount')->values()->all();
        $ti = round(array_sum($in), 2);
        $to_ = round(array_sum($out), 2);

        return ['opening' => $opening, 'inflows' => $toRows($in), 'outflows' => $toRows($out), 'total_in' => $ti, 'total_out' => $to_, 'closing' => round($opening + $ti - $to_, 2)];
    }

    /** Per fund account: opening, receipts from one module, other receipts, payments, closing. Irrigation cash + bank accounts. */
    public function fundMovement(string $from, string $to, string $module)
    {
        $ids = Account::where('is_postable', true)->where(fn ($q) => $q->where('key', 'cash_'.$module)->orWhereHas('bankAccount'))->orderBy('code')->get();

        return $ids->map(function (Account $a) use ($from, $to, $module) {
            $m = DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')->where('l.account_id', $a->id)
                ->whereIn('j.status', LedgerService::EFFECTIVE)->whereBetween('j.date', [$from, $to])
                ->selectRaw('SUM(CASE WHEN j.module = ? THEN l.debit ELSE 0 END) as mod_in, SUM(CASE WHEN j.module = ? THEN 0 ELSE l.debit END) as other_in, SUM(l.credit) as out_', [$module, $module])
                ->first();
            $opening = $this->ledger->balance($a->id, $from, true);

            return $a->only(['id', 'code', 'name_bn', 'name_en']) + [
                'opening' => round($opening, 2), 'module_in' => round((float) $m->mod_in, 2), 'other_in' => round((float) $m->other_in, 2),
                'out' => round((float) $m->out_, 2), 'closing' => round($opening + (float) $m->mod_in + (float) $m->other_in - (float) $m->out_, 2),
            ];
        })->filter(fn ($r) => $r['opening'] != 0 || $r['module_in'] != 0 || $r['other_in'] != 0 || $r['out'] != 0)->values();
    }
}
