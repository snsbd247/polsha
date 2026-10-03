<?php

namespace App\Services;

use App\Models\Account;
use App\Models\BankAccount;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The irrigation fund's cash statement for a period, the way the society's
 * audit sheet is laid out: income heads on one side, expense heads on the
 * other, opening fund, closing fund and how much of it sits in the bank.
 *
 * The fund is the irrigation cash plus irrigation money put in the bank:
 * moving money between the two is neither income nor expense, it only
 * changes the bank part. Field collections handed in at the office count as
 * irrigation charge collection. An opening-balance voucher inside the period
 * adds to the opening fund rather than to income.
 */
class IrrigationCashStatementService
{
    /** @return array<string, mixed> */
    public function build(string $from, string $to, ?float $openingOverride = null): array
    {
        $cash = Account::byKey('cash_irrigation')->id;
        $banks = BankAccount::pluck('account_id')->flip();
        $collection = Account::whereIn('key', ['irrigation_receivable', 'irrigation_income', 'cash_field'])->pluck('id')->flip();
        $otherFunds = Account::whereIn('key', ['cash_society', 'cash_misc'])->pluck('id')->flip();
        $names = Account::pluck('name_bn', 'id');

        // every voucher that moves the irrigation fund: its cash lines, or bank lines of an irrigation voucher
        $journalIds = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', '<=', $to)
            ->where(fn ($q) => $q->where('journal_lines.account_id', $cash)
                ->orWhere(fn ($w) => $w->where('journals.module', 'irrigation')->whereIn('journal_lines.account_id', $banks->keys())))
            ->distinct()->pluck('journals.id');
        $lines = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.id', $journalIds)
            ->get(['journals.id as jid', 'journals.date', 'journals.voucher_type', 'journals.module', 'journal_lines.account_id', 'journal_lines.debit', 'journal_lines.credit'])
            ->groupBy('jid');

        $opening = 0;     // paisa
        $bank = 0;        // irrigation money in the bank, paisa
        $income = [];     // label => [paisa, account ids]
        $expense = [];
        foreach ($lines as $rows) {
            $first = $rows->first();
            $inPeriod = Carbon::parse($first->date)->toDateString() >= $from;
            $net = fn ($r) => (int) round(((float) $r->debit - (float) $r->credit) * 100);
            $isFundBank = fn ($r) => isset($banks[$r->account_id]) && $first->module === 'irrigation';
            $cashNet = $rows->where('account_id', $cash)->sum($net);
            $bankLines = $rows->filter(fn ($r) => isset($banks[$r->account_id]));
            $counters = $rows->reject(fn ($r) => $r->account_id === $cash || isset($banks[$r->account_id]));

            // cash ↔ bank inside the fund
            if ($counters->isEmpty() && $bankLines->isNotEmpty() && $cashNet !== 0) {
                $bank -= $cashNet;

                continue;
            }
            $fundBankNet = $rows->filter($isFundBank)->sum($net);
            $bank += $fundBankNet;
            $flow = $cashNet + $fundBankNet;
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
                    isset($collection[$c->account_id]) => __('সেচ চার্জ আদায় (বকেয়াসহ)'),
                    isset($otherFunds[$c->account_id]) => $amount > 0 ? __('অন্য তহবিল থেকে স্থানান্তর') : __('অন্য তহবিলে স্থানান্তর'),
                    default => $names[$c->account_id] ?? '—',
                };
                $side = $amount > 0 ? 'income' : 'expense';
                ${$side}[$label][0] = (${$side}[$label][0] ?? 0) + abs($amount);
                ${$side}[$label][1][$c->account_id] = true;
            }
        }

        // a cancelled receipt gives collection money back: it lowers the collection, it is not an expense
        $collect = __('সেচ চার্জ আদায় (বকেয়াসহ)');
        if (isset($expense[$collect])) {
            $income[$collect][0] = ($income[$collect][0] ?? 0) - $expense[$collect][0];
            $income[$collect][1] = ($income[$collect][1] ?? []) + $expense[$collect][1];
            unset($expense[$collect]);
        }
        $list = fn (array $heads) => collect($heads)->map(fn ($v, $label) => ['label' => $label, 'amount' => $v[0] / 100, 'account_ids' => array_keys($v[1])])
            ->sortByDesc('amount')->values()->all();
        $incomeRows = $list($income);
        // the collection head first, as the sheet shows it; the rest by size
        usort($incomeRows, fn ($a, $b) => ($b['label'] === __('সেচ চার্জ আদায় (বকেয়াসহ)')) <=> ($a['label'] === __('সেচ চার্জ আদায় (বকেয়াসহ)')) ?: $b['amount'] <=> $a['amount']);
        $totalIncome = round(array_sum(array_column($incomeRows, 'amount')), 2);
        $expenseRows = $list($expense);
        $totalExpense = round(array_sum(array_column($expenseRows, 'amount')), 2);
        $openingFund = $openingOverride ?? $opening / 100;

        return [
            'society' => SettingService::get('society_name_bn'),
            'from' => $from, 'to' => $to, 'cash_account_id' => $cash,
            'income' => $incomeRows, 'expense' => $expenseRows,
            'total_income' => $totalIncome, 'total_expense' => $totalExpense,
            'opening' => round($openingFund, 2), 'opening_computed' => round($opening / 100, 2),
            'closing' => round($openingFund + $totalIncome - $totalExpense, 2),
            'bank_balance' => round($bank / 100, 2),
        ];
    }
}
