<?php

namespace App\Services;

use App\Models\Account;
use App\Models\BankAccount;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * A fund's cash statement for a period, the way the society's audit sheet is
 * laid out: income heads on one side, expense heads on the other, opening
 * fund and the fund in hand at the end.
 *
 * Irrigation: the fund is the irrigation cash plus irrigation money put in
 * the bank. Moving money between the two is neither income nor expense; it
 * only changes the bank part shown at the bottom.
 *
 * Society: the fund is the society's cash (society + miscellaneous cash).
 * Money taken to or brought from the bank shows as its own head, so the fund
 * at the end is the cash really in hand; the bank accounts are listed
 * separately with their movements over the period.
 *
 * In both, field collections handed in at the office count with the
 * collection they came from, a cancelled irrigation receipt lowers the
 * irrigation collection, and an opening-balance voucher inside the period
 * adds to the opening fund rather than to income.
 */
class IrrigationCashStatementService
{
    public const STREAMS = ['irrigation' => ['cash_irrigation'], 'society' => ['cash_society', 'cash_misc'], 'water' => ['cash_water']];

    /** Funds that keep their own money in the bank and collect their own bills: the head their collections are shown under. */
    private const BILLED = [
        'irrigation' => ['সেচ চার্জ আদায় (বকেয়াসহ)', ['irrigation_receivable', 'irrigation_income', 'cash_field']],
        'water' => ['পানির বিল আদায় (বকেয়াসহ)', ['water_receivable', 'water_income', 'water_penalty_income', 'water_connection_fee_income', 'cash_field']],
    ];

    /** @return array<string, mixed> */
    public function build(string $from, string $to, ?float $openingOverride = null, string $stream = 'irrigation'): array
    {
        // irrigation and water: the fund's cash and its money in the bank, and its own bill collection
        $irrigation = isset(self::BILLED[$stream]);
        $collect = $irrigation ? __(self::BILLED[$stream][0]) : null;
        $cash = Account::whereIn('key', self::STREAMS[$stream])->pluck('id')->flip();
        $banks = BankAccount::pluck('account_id')->flip();
        $collectionKeys = $irrigation ? self::BILLED[$stream][1] : [];
        $collection = Account::whereIn('key', $collectionKeys)->pluck('id')->flip();
        $field = Account::where('key', 'cash_field')->value('id');
        $otherFunds = Account::whereIn('key', array_merge(...array_values(array_diff_key(self::STREAMS, [$stream => 1]))))->pluck('id')->flip();
        $names = Account::pluck('name_bn', 'id');

        // every voucher that moves the fund: its cash lines, or (irrigation) bank lines of an irrigation voucher
        $journalIds = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', '<=', $to)
            ->where(fn ($q) => $q->whereIn('journal_lines.account_id', $cash->keys())
                ->when($irrigation, fn ($w) => $w->orWhere(fn ($x) => $x->where('journals.module', $stream)->whereIn('journal_lines.account_id', $banks->keys()))))
            ->distinct()->pluck('journals.id');
        $lines = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.id', $journalIds)
            ->get(['journals.id as jid', 'journals.date', 'journals.voucher_type', 'journals.module', 'journal_lines.account_id', 'journal_lines.debit', 'journal_lines.credit'])
            ->groupBy('jid');

        $opening = 0;     // paisa
        $bank = 0;        // (irrigation) fund money in the bank, paisa
        $income = [];     // label => [paisa, account ids]
        $expense = [];
        foreach ($lines as $rows) {
            $first = $rows->first();
            $inPeriod = Carbon::parse($first->date)->toDateString() >= $from;
            $net = fn ($r) => (int) round(((float) $r->debit - (float) $r->credit) * 100);
            $cashNet = $rows->filter(fn ($r) => isset($cash[$r->account_id]))->sum($net);
            $bankLines = $rows->filter(fn ($r) => isset($banks[$r->account_id]));
            $counters = $rows->reject(fn ($r) => isset($cash[$r->account_id]) || ($irrigation && isset($banks[$r->account_id])));

            // irrigation cash ↔ bank stays inside the fund
            if ($irrigation && $counters->isEmpty() && $bankLines->isNotEmpty() && $cashNet !== 0) {
                $bank -= $cashNet;

                continue;
            }
            $fundBankNet = $irrigation && $first->module === $stream ? $bankLines->sum($net) : 0;
            $bank += $fundBankNet;
            $flow = $cashNet + $fundBankNet;
            if ($flow === 0 && $counters->isEmpty()) {
                continue; // society cash ↔ miscellaneous cash
            }
            if ($first->voucher_type === 'opening' || ! $inPeriod) {
                $opening += $flow;

                continue;
            }
            foreach ($counters as $c) {
                $amount = -$net($c); // credit on the other side = money into the fund
                if ($amount === 0) {
                    continue;
                }
                $label = match (true) {
                    isset($collection[$c->account_id]) => $collect,
                    isset($banks[$c->account_id]) => $amount > 0 ? __('ব্যাংক থেকে নগদ উত্তোলন') : __('নগদ ব্যাংকে জমা'),
                    $c->account_id === $field => __('মাঠ-আদায় জমা'),
                    isset($otherFunds[$c->account_id]) => $amount > 0 ? __('অন্য তহবিল থেকে স্থানান্তর') : __('অন্য তহবিলে স্থানান্তর'),
                    default => $names[$c->account_id] ?? '—',
                };
                $side = $amount > 0 ? 'income' : 'expense';
                ${$side}[$label][0] = (${$side}[$label][0] ?? 0) + abs($amount);
                ${$side}[$label][1][$c->account_id] = true;
            }
        }

        // a cancelled receipt gives collection money back: it lowers the collection, it is not an expense
        if ($collect !== null && isset($expense[$collect])) {
            $income[$collect][0] = ($income[$collect][0] ?? 0) - $expense[$collect][0];
            $income[$collect][1] = ($income[$collect][1] ?? []) + $expense[$collect][1];
            unset($expense[$collect]);
        }
        $list = fn (array $heads) => collect($heads)->map(fn ($v, $label) => ['label' => $label, 'amount' => $v[0] / 100, 'account_ids' => array_keys($v[1])])
            ->sortByDesc('amount')->values()->all();
        $incomeRows = $list($income);
        // the collection head first, as the sheet shows it; the rest by size
        usort($incomeRows, fn ($a, $b) => ($b['label'] === $collect) <=> ($a['label'] === $collect) ?: $b['amount'] <=> $a['amount']);
        $totalIncome = round(array_sum(array_column($incomeRows, 'amount')), 2);
        $expenseRows = $list($expense);
        $totalExpense = round(array_sum(array_column($expenseRows, 'amount')), 2);
        $openingFund = $openingOverride ?? $opening / 100;

        return [
            'stream' => $stream,
            'society' => SettingService::get('society_name_bn'),
            'from' => $from, 'to' => $to, 'cash_account_id' => $cash->keys()->first(),
            'income' => $incomeRows, 'expense' => $expenseRows,
            'total_income' => $totalIncome, 'total_expense' => $totalExpense,
            'opening' => round($openingFund, 2), 'opening_computed' => round($opening / 100, 2),
            'closing' => round($openingFund + $totalIncome - $totalExpense, 2),
            'bank_balance' => $irrigation ? round($bank / 100, 2) : null,
            'banks' => $irrigation ? [] : $this->banks($from, $to),
        ];
    }

    /**
     * Every bank account over the period: balance at the start, interest
     * received, bank charges, other deposits and withdrawals, balance at the end.
     *
     * @return list<array<string, mixed>>
     */
    private function banks(string $from, string $to): array
    {
        $charges = Account::where('key', 'bank_charges')->value('id');
        $incomeAccounts = Account::where('type', 'income')->pluck('id')->flip();

        return BankAccount::with('account:id,name_bn')->orderBy('id')->get()->map(function (BankAccount $b) use ($from, $to, $charges, $incomeAccounts) {
            $id = $b->account_id;
            $before = (float) DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
                ->where('journal_lines.account_id', $id)->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', '<', $from)
                ->selectRaw('COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) b')->value('b');
            $journals = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
                ->whereIn('journals.status', LedgerService::EFFECTIVE)->whereBetween('journals.date', [$from, $to])
                ->whereIn('journals.id', DB::table('journal_lines')->where('account_id', $id)->select('journal_id'))
                ->get(['journals.id as jid', 'journal_lines.account_id', 'journal_lines.debit', 'journal_lines.credit'])->groupBy('jid');
            $t = ['interest' => 0, 'charges' => 0, 'deposits' => 0, 'withdrawals' => 0];
            foreach ($journals as $rows) {
                $net = $rows->where('account_id', $id)->sum(fn ($r) => (int) round(((float) $r->debit - (float) $r->credit) * 100));
                $others = $rows->where('account_id', '!=', $id)->pluck('account_id');
                $key = match (true) {
                    $net < 0 && $others->contains($charges) => 'charges',
                    $net > 0 && $others->contains(fn ($a) => isset($incomeAccounts[$a])) && $others->count() === 1 => 'interest',
                    $net > 0 => 'deposits',
                    default => 'withdrawals',
                };
                $t[$key] += abs($net);
            }
            $t = array_map(fn ($p) => $p / 100, $t);

            return [
                'id' => $b->id, 'account_no' => $b->account_no, 'bank_name' => $b->bank_name, 'account_type' => $b->account_type,
                'opening' => round($before, 2), 'interest' => $t['interest'], 'charges' => $t['charges'], 'deposits' => $t['deposits'], 'withdrawals' => $t['withdrawals'],
                'closing' => round($before + $t['interest'] - $t['charges'] + $t['deposits'] - $t['withdrawals'], 2),
            ];
        })->all();
    }
}
