<?php

namespace App\Services;

use App\Models\Account;
use App\Models\BankAccount;
use App\Models\LoanPayment;
use App\Models\MemberTransaction;
use App\Models\Receipt;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The income-expense cash book of a fund (society or irrigation), laid out
 * the way the society keeps it on paper: every cash voucher of the period
 * on its own line — income on one side, expense on the other — with its
 * money spread over head columns, a day total, and below the totals, the
 * cash brought from before the period and the cash in hand at the end.
 *
 * A column is a head: well-known ones (share, savings, loan, interest, bank
 * deposits and withdrawals…) in a fixed order, then one per other account
 * used in the period (an expense account such as "electricity bill" becomes
 * its own column), the smallest folding into Miscellaneous.
 */
class IncomeExpenseCashBookService
{
    private const MAX_HEADS = 9;

    /** @return array<string, mixed> */
    public function build(string $stream, string $from, string $to): array
    {
        $irrigation = $stream === 'irrigation';
        $cash = Account::whereIn('key', IrrigationCashStatementService::STREAMS[$stream])->pluck('id')->flip();
        $banks = BankAccount::pluck('account_id')->flip();
        $keyOf = Account::whereNotNull('key')->pluck('key', 'id');
        $en = app()->getLocale() === 'en';
        $names = Account::get(['id', 'name_bn', 'name_en'])->mapWithKeys(fn ($a) => [$a->id => $en && $a->name_en ? $a->name_en : $a->name_bn]);
        $others = Account::whereIn('key', array_merge(...array_values(array_diff_key(IrrigationCashStatementService::STREAMS, [$stream => 1]))))->pluck('id')->flip();

        // fixed heads per side, in the order the book shows them
        $fixed = $irrigation
            ? ['income' => ['irrigation' => __('সেচ চার্জ'), 'bank' => __('ব্যাংক থেকে উত্তোলন'), 'transfer' => __('অন্য তহবিল থেকে')],
                'expense' => ['bank' => __('নগদ ব্যাংকে জমা'), 'transfer' => __('অন্য তহবিলে')]]
            : ['income' => ['share' => __('শেয়ার'), 'savings' => __('সঞ্চয় জমা'), 'bank' => __('ব্যাংক থেকে উত্তোলন'), 'loan' => __('ঋণ আদায় (আসল)'),
                'interest' => __('ঋণের সুদ ও জরিমানা'), 'admission' => __('ভর্তি ফি'), 'field' => __('মাঠ-আদায় জমা'), 'transfer' => __('অন্য তহবিল থেকে')],
                'expense' => ['refund' => __('সঞ্চয়/শেয়ার ফেরত'), 'bank' => __('নগদ ব্যাংকে জমা'), 'loan' => __('ঋণ বিতরণ'), 'transfer' => __('অন্য তহবিলে')]];
        $head = function (int $accountId, string $side) use ($irrigation, $banks, $keyOf, $others): string {
            $key = $keyOf[$accountId] ?? null;

            return match (true) {
                isset($banks[$accountId]) => 'bank',
                isset($others[$accountId]) => 'transfer',
                $irrigation && in_array($key, ['irrigation_receivable', 'irrigation_income', 'cash_field'], true) => 'irrigation',
                ! $irrigation && $key === 'cash_field' => 'field',
                ! $irrigation && in_array($key, ['savings_deposits', 'share_capital'], true) && $side === 'expense' => 'refund',
                ! $irrigation && $key === 'savings_deposits' => 'savings',
                ! $irrigation && $key === 'share_capital' => 'share',
                ! $irrigation && $key === 'loans_receivable' => 'loan',
                ! $irrigation && in_array($key, ['loan_interest_income', 'loan_penalty_income'], true) => 'interest',
                ! $irrigation && $key === 'admission_fee_income' => 'admission',
                default => 'acc:'.$accountId,
            };
        };

        $lines = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)->whereBetween('journals.date', [$from, $to])
            ->whereIn('journals.id', DB::table('journal_lines')->whereIn('account_id', $cash->keys())->select('journal_id'))
            ->orderBy('journals.date')->orderBy('journals.id')
            ->get(['journals.id as jid', 'journals.date', 'journals.voucher_no', 'journals.narration', 'journals.source_type', 'journals.source_id',
                'journal_lines.account_id', 'journal_lines.debit', 'journal_lines.credit'])
            ->groupBy('jid');
        $refs = $this->references($lines->map->first());

        $sides = ['income' => [], 'expense' => []];
        $totals = ['income' => [], 'expense' => []];
        foreach ($lines as $jid => $rows) {
            $p = fn ($r) => (int) round(((float) $r->debit - (float) $r->credit) * 100);
            $cashNet = $rows->filter(fn ($r) => isset($cash[$r->account_id]))->sum($p);
            if ($cashNet === 0) {
                continue; // between two of the fund's own cash accounts
            }
            $side = $cashNet > 0 ? 'income' : 'expense';
            // one voucher bringing money into both funds (a field hand-in split by stream): each fund's
            // book takes its share of the heads, and the other fund's cash is not a transfer
            $otherNet = $rows->filter(fn ($r) => isset($others[$r->account_id]))->sum($p);
            $counters = $rows->reject(fn ($r) => isset($cash[$r->account_id]));
            $share = 1.0;
            if ($otherNet !== 0 && ($otherNet > 0) === ($cashNet > 0) && $counters->contains(fn ($r) => ! isset($others[$r->account_id]))) {
                $counters = $counters->reject(fn ($r) => isset($others[$r->account_id]));
                $share = $cashNet / ($cashNet + $otherNet);
            }
            $cells = [];
            foreach ($counters as $r) {
                // a line against the flow (a shortage on a hand-in, a fee kept back) shows as a minus in its own head
                $k = $head($r->account_id, $side);
                $cells[$k] = ($cells[$k] ?? 0) + ($side === 'income' ? -$p($r) : $p($r));
            }
            if ($share !== 1.0) {
                $cells = array_map(fn ($v) => (int) round($v * $share), $cells);
                // the paisa lost to rounding goes to the biggest head, so the line still adds up
                $cells[array_search(max($cells), $cells, true)] += abs($cashNet) - array_sum($cells);
            }
            $cells = array_filter($cells);
            foreach ($cells as $k => $v) {
                $totals[$side][$k] = ($totals[$side][$k] ?? 0) + $v;
            }
            $first = $rows->first();
            $sides[$side][] = ['id' => $jid, 'date' => substr((string) $first->date, 0, 10),
                'ref' => $refs[$jid]['ref'] ?? $first->voucher_no, 'party' => $refs[$jid]['party'] ?? $first->narration,
                'voucher_no' => $first->voucher_no, 'cells' => $cells, 'total' => abs($cashNet)];
        }

        $out = [];
        foreach (['income', 'expense'] as $side) {
            // the fixed heads that were used, then the busiest other accounts; the rest fold into miscellaneous
            $dynamic = collect($totals[$side])->filter(fn ($v, $k) => str_starts_with($k, 'acc:'))->sortDesc()->keys();
            $keep = $dynamic->take(self::MAX_HEADS)->all();
            $fold = $dynamic->slice(self::MAX_HEADS)->flip();
            $rows = collect($sides[$side])->map(function ($row) use ($fold) {
                foreach ($row['cells'] as $k => $v) {
                    if (isset($fold[$k])) {
                        $row['cells']['misc'] = ($row['cells']['misc'] ?? 0) + $v;
                        unset($row['cells'][$k]);
                    }
                }
                $row['cells'] = array_map(fn ($v) => $v / 100, $row['cells']);
                $row['total'] /= 100;

                return $row;
            })->values();
            $columns = collect($fixed[$side])->filter(fn ($l, $k) => isset($totals[$side][$k]) || $k === 'bank')
                ->map(fn ($label, $key) => ['key' => $key, 'label' => $label])->values()
                ->concat(collect($keep)->map(fn ($k) => ['key' => $k, 'label' => $names[(int) substr($k, 4)] ?? '—']))
                ->push(['key' => 'misc', 'label' => __('বিবিধ')])->all();
            $out[$side] = ['columns' => $columns, 'rows' => $rows->all(), 'total' => round($rows->sum('total'), 2)];
        }

        $opening = round((float) DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journal_lines.account_id', $cash->keys())->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', '<', $from)
            ->selectRaw('COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) b')->value('b'), 2);

        return [
            'stream' => $stream, 'from' => $from, 'to' => $to,
            'society' => [
                'name' => SettingService::get('society_name_bn'),
                'address' => SettingService::get('print_address') ?: SettingService::get('address'),
                'mobile' => SettingService::get('contact_mobile') ?: SettingService::get('phone'),
                'email' => SettingService::get('contact_email') ?: SettingService::get('email'),
            ],
            'income' => $out['income'], 'expense' => $out['expense'],
            'opening' => $opening, 'closing' => round($opening + $out['income']['total'] - $out['expense']['total'], 2),
        ];
    }

    /**
     * The number and person a reader looks for: the receipt number and payer,
     * the loan payment or savings transaction and its member; otherwise the
     * voucher number and its narration.
     *
     * @return array<int, array{ref: string, party: ?string}>
     */
    private function references(Collection $journals): array
    {
        $by = $journals->groupBy('source_type');
        $out = [];
        $receipts = Receipt::whereIn('id', ($by[Receipt::class] ?? collect())->pluck('source_id'))->get(['id', 'receipt_no', 'legacy_no', 'payer_name'])->keyBy('id');
        $loanPays = LoanPayment::with('loan.member.farmer:id,name_bn')->whereIn('id', ($by[LoanPayment::class] ?? collect())->pluck('source_id'))->get()->keyBy('id');
        $txns = MemberTransaction::with('account.member.farmer:id,name_bn')->whereIn('id', ($by[MemberTransaction::class] ?? collect())->pluck('source_id'))->get()->keyBy('id');
        foreach ($journals as $jid => $j) {
            $out[$jid] = match ($j->source_type) {
                Receipt::class => isset($receipts[$j->source_id]) ? ['ref' => $receipts[$j->source_id]->legacy_no ?: $receipts[$j->source_id]->receipt_no, 'party' => $receipts[$j->source_id]->payer_name] : null,
                LoanPayment::class => isset($loanPays[$j->source_id]) ? ['ref' => $loanPays[$j->source_id]->payment_no, 'party' => $loanPays[$j->source_id]->loan?->member?->farmer?->name_bn] : null,
                MemberTransaction::class => isset($txns[$j->source_id]) ? ['ref' => $txns[$j->source_id]->txn_no, 'party' => $txns[$j->source_id]->account?->member?->farmer?->name_bn] : null,
                default => null,
            };
            if (! $out[$jid]) {
                unset($out[$jid]);
            }
        }

        return $out;
    }
}
