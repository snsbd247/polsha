<?php

namespace App\Services;

use App\Models\Account;
use App\Models\BankAccount;
use App\Models\Invoice;
use App\Models\Receipt;
use App\Models\StatementHead;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The receipts & payments statement (জমা-খরচ বিবরণী) of one fund — society,
 * irrigation or water supply — as the society prints it: every head in its
 * fixed order, the month's amount beside the amount from the start of the
 * financial year, the opening cash (প্রারম্ভিক মজুদ) and the cash in hand at
 * the end (হস্ত মজুদ), both sides adding to the same grand total.
 *
 * Only the fund's cash is counted. Money taken to or from the bank, or to
 * or from another fund, is a line like any other; moving money between the
 * fund's own cash accounts (society ↔ miscellaneous) is not. A cancelled
 * voucher takes its amount back off the head it went to. Irrigation charges
 * are split by the season of the bills they paid.
 */
class ReceiptPaymentStatementService
{
    public const FUNDS = ['society' => 'সমিতি', 'irrigation' => 'সেচ', 'water' => 'ওয়াটার সাপ্লাই'];

    public const SIDES = ['receipt' => 'জমা', 'payment' => 'খরচ'];

    /** @return array<string, mixed> */
    public function build(string $fund, string $month): array
    {
        $end = CarbonImmutable::parse($month.'-01')->endOfMonth();
        $monthStart = $end->startOfMonth();
        $yearStart = $this->yearStart($end);

        $cash = Account::whereIn('key', IrrigationCashStatementService::STREAMS[$fund])->pluck('id')->flip();
        $heads = StatementHead::with('accounts:id')->where('fund', $fund)->where('is_active', true)->orderBy('sort_order')->orderBy('id')->get();
        $map = ['receipt' => [], 'payment' => []];
        foreach ($heads as $h) {
            foreach ($h->accounts as $a) {
                $map[$h->side][$a->id] = $h;
            }
        }
        $names = Account::pluck('name_bn', 'id');
        $banks = BankAccount::get(['account_id', 'account_no', 'bank_name'])->keyBy('account_id');
        $field = Account::where('key', 'cash_field')->value('id');
        // water bills are all collected through one receivable; the paper shows connection and commitment fees on their own lines
        $waterReceivable = $fund === 'water' ? Account::where('key', 'water_receivable')->value('id') : null;
        $byKey = Account::whereIn('key', ['water_connection_fee_income', 'water_commitment_fee_income'])->pluck('id', 'key');
        $kindHead = [
            'connection' => $map['receipt'][$byKey['water_connection_fee_income'] ?? 0] ?? null,
            'reconnection' => $map['receipt'][$byKey['water_connection_fee_income'] ?? 0] ?? null,
            'commitment' => $map['receipt'][$byKey['water_commitment_fee_income'] ?? 0] ?? null,
        ];

        // totals per row key: [label, month paisa, year paisa]; head rows keep the head's order
        $rows = ['receipt' => [], 'payment' => []];
        $opening = ['month' => 0, 'year' => 0];

        $journals = DB::table('journal_lines')->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
            ->whereIn('journals.status', LedgerService::EFFECTIVE)->where('journals.date', '<=', $end->toDateString())
            ->whereIn('journals.id', DB::table('journal_lines')->whereIn('account_id', $cash->keys())->select('journal_id'))
            ->orderBy('journals.date')->orderBy('journals.id')
            ->get(['journals.id as jid', 'journals.date', 'journals.voucher_type', 'journals.source_type', 'journals.source_id', 'journals.reversal_of_id',
                'journal_lines.account_id', 'journal_lines.debit', 'journal_lines.credit'])
            ->groupBy('jid');

        $net = fn ($r) => (int) round(((float) $r->debit - (float) $r->credit) * 100);
        foreach ($journals as $lines) {
            $first = $lines->first();
            $date = substr((string) $first->date, 0, 10);
            $cashNet = $lines->filter(fn ($r) => isset($cash[$r->account_id]))->sum($net);
            $counters = $lines->reject(fn ($r) => isset($cash[$r->account_id]));
            $inYear = $date >= $yearStart->toDateString();
            $inMonth = $date >= $monthStart->toDateString();

            // before the period, or an opening-balance voucher: part of the opening cash
            if (! $inYear || $first->voucher_type === 'opening') {
                $opening['year'] += $cashNet;
            }
            if (! $inMonth || $first->voucher_type === 'opening') {
                $opening['month'] += $cashNet;
            }
            if (! $inYear || $first->voucher_type === 'opening' || $counters->isEmpty()) {
                continue;
            }

            $reversal = $first->reversal_of_id !== null;
            $seasons = null;
            foreach ($counters as $c) {
                $amount = -$net($c); // money into the fund when positive
                if ($amount === 0) {
                    continue;
                }
                // a cancellation goes back off the side the original went to
                $side = ($amount > 0) !== $reversal ? 'receipt' : 'payment';
                $signed = $reversal ? -abs($amount) : abs($amount);
                $head = $map[$side][$c->account_id] ?? null;

                if ($waterReceivable && $c->account_id === $waterReceivable) {
                    foreach ($this->split($signed, $this->waterKindsOf($first->reversal_of_id ?? $first->jid)) as $kind => $part) {
                        $h = $kindHead[$kind] ?? $head;
                        $this->add($rows[$side], $h ? 'head:'.$h->id : 'acct:'.$c->account_id, $h?->name_bn ?? ($names[$c->account_id] ?? '—'), $h?->sort_order ?? 100001, $part, $inMonth);
                    }

                    continue;
                }
                if ($head && $head->kind === 'season') {
                    $seasons ??= $this->seasonsOf($first->reversal_of_id ?? $first->jid, $first);
                    foreach ($this->split($signed, $seasons) as $label => $part) {
                        $this->add($rows[$side], 'season:'.$label, $label, $head->sort_order, $part, $inMonth);
                    }

                    continue;
                }
                [$key, $label, $order] = match (true) {
                    $head !== null => ['head:'.$head->id, $head->name_bn, $head->sort_order],
                    $banks->has($c->account_id) => ['bank:'.$c->account_id, ($side === 'receipt' ? 'ব্যাংক উত্তোলন/' : 'ব্যাংক জমা/').$banks[$c->account_id]->account_no, 100000],
                    $c->account_id === $field => ['field', __('মাঠ-আদায় জমা'), 100000],
                    default => ['acct:'.$c->account_id, $names[$c->account_id] ?? '—', 100001],
                };
                $this->add($rows[$side], $key, $label, $order, $signed, $inMonth);
            }
        }

        // every head prints, money or not; lines with no head follow at the end
        $out = [];
        foreach (['receipt', 'payment'] as $side) {
            $list = $rows[$side];
            foreach ($heads->where('side', $side) as $h) {
                if ($h->kind !== 'season') {
                    $list['head:'.$h->id] ??= ['label' => $h->name_bn, 'order' => $h->sort_order, 'month' => 0, 'year' => 0];
                } elseif (! collect($list)->keys()->contains(fn ($k) => str_starts_with($k, 'season:'))) {
                    $list['head:'.$h->id] = ['label' => $h->name_bn, 'order' => $h->sort_order, 'month' => 0, 'year' => 0];
                }
            }
            uasort($list, fn ($a, $b) => [$a['order'], $a['label']] <=> [$b['order'], $b['label']]);
            $out[$side] = array_values(array_map(fn ($r) => [
                'label' => $r['label'], 'month' => $r['month'] / 100, 'year' => $r['year'] / 100,
            ], $list));
        }

        $sum = fn ($side, $col) => round(array_sum(array_column($out[$side], $col)), 2);
        $tot = [];
        foreach (['month', 'year'] as $col) {
            $receipts = $sum('receipt', $col);
            $payments = $sum('payment', $col);
            $open = round($opening[$col] / 100, 2);
            $grand = round($open + $receipts, 2);
            $tot[$col] = ['receipts' => $receipts, 'payments' => $payments, 'opening' => $open, 'closing' => round($grand - $payments, 2), 'grand' => $grand];
        }

        return [
            'fund' => $fund,
            'fund_label' => __(self::FUNDS[$fund]),
            'month' => $monthStart->format('Y-m'),
            'from' => $monthStart->toDateString(),
            'to' => $end->toDateString(),
            'year_from' => $yearStart->toDateString(),
            'fiscal_year' => $yearStart->format('Y').'-'.$yearStart->addYear()->format('Y'),
            'receipts' => $out['receipt'],
            'payments' => $out['payment'],
            'totals' => $tot,
        ];
    }

    /** The first day of the financial year the date falls in (July by default). */
    private function yearStart(CarbonImmutable $date): CarbonImmutable
    {
        $m = (int) (SettingService::get('fiscal_year_start_month', 7) ?: 7);
        $start = $date->setDate($date->year, $m, 1)->startOfDay();

        return $start->greaterThan($date) ? $start->subYear() : $start;
    }

    /** @param array<string, array{label:string, order:int, month:int, year:int}> $list */
    private function add(array &$list, string $key, string $label, int $order, int $paisa, bool $inMonth): void
    {
        $list[$key] ??= ['label' => $label, 'order' => $order, 'month' => 0, 'year' => 0];
        $list[$key]['year'] += $paisa;
        if ($inMonth) {
            $list[$key]['month'] += $paisa;
        }
    }

    /**
     * The seasons of the bills a receipt voucher paid, each with its share.
     *
     * @return array<string, float> season name => weight
     */
    private function seasonsOf(int $journalId, object $first): array
    {
        $j = DB::table('journals')->where('id', $journalId)->first(['source_type', 'source_id']);
        if ($j && $j->source_type === (new Receipt)->getMorphClass()) {
            $rows = DB::table('receipt_items')->join('invoices', 'invoices.id', '=', 'receipt_items.payable_id')
                ->join('seasons', 'seasons.id', '=', 'invoices.season_id')
                ->where('receipt_items.receipt_id', $j->source_id)->where('receipt_items.payable_type', (new Invoice)->getMorphClass())
                ->groupBy('seasons.name_bn')->selectRaw('seasons.name_bn as name, SUM(receipt_items.amount) as amount')->pluck('amount', 'name');
            if ($rows->sum() > 0) {
                return $rows->map(fn ($a) => (float) $a)->all();
            }
        }
        if ($j && $j->source_type === (new Invoice)->getMorphClass()) {
            $name = DB::table('invoices')->join('seasons', 'seasons.id', '=', 'invoices.season_id')->where('invoices.id', $j->source_id)->value('seasons.name_bn');
            if ($name) {
                return [$name => 1.0];
            }
        }

        return [__('সেচ চার্জ আদায়') => 1.0];
    }

    /**
     * The kinds of water bills a receipt voucher paid (monthly, connection,
     * commitment …), each with its share.
     *
     * @return array<string, float>
     */
    private function waterKindsOf(int $journalId): array
    {
        $j = DB::table('journals')->where('id', $journalId)->first(['source_type', 'source_id']);
        if ($j && $j->source_type === (new Receipt)->getMorphClass()) {
            $rows = DB::table('receipt_items')->join('water_bills', 'water_bills.id', '=', 'receipt_items.payable_id')
                ->where('receipt_items.receipt_id', $j->source_id)->where('receipt_items.payable_type', (new \App\Models\WaterBill)->getMorphClass())
                ->groupBy('water_bills.kind')->selectRaw('water_bills.kind, SUM(receipt_items.amount) as amount')->pluck('amount', 'kind');
            if ($rows->sum() > 0) {
                return $rows->map(fn ($a) => (float) $a)->all();
            }
        }

        return ['monthly' => 1.0];
    }

    /**
     * Split an amount by weights, the rounding remainder on the last part.
     *
     * @param  array<string, float>  $weights
     * @return array<string, int>
     */
    private function split(int $paisa, array $weights): array
    {
        $total = array_sum($weights);
        $out = [];
        $left = $paisa;
        $keys = array_keys($weights);
        foreach ($keys as $i => $k) {
            $part = $i === count($keys) - 1 ? $left : (int) round($paisa * $weights[$k] / $total);
            $out[$k] = $part;
            $left -= $part;
        }

        return $out;
    }
}
