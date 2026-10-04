<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Asset;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Checks that every module's own records agree with the general ledger:
 * each source record has its voucher, every voucher balances, and module
 * totals (dues, deposits, loans, assets) equal their control accounts.
 */
class LedgerIntegrityService
{
    public function __construct(private LedgerService $ledger, private AccountingReportService $reports) {}

    /**
     * @return array<string, array{label:string, severity:string, rows:callable}>
     *                                                                            rows() → Collection of ['no', 'detail', 'link']
     */
    public function checks(): array
    {
        return [
            'journal_unbalanced' => [
                'label' => __('ডেবিট-ক্রেডিট না মেলা ভাউচার'), 'severity' => 'error',
                'rows' => fn () => DB::table('journals')->join('journal_lines', 'journal_lines.journal_id', '=', 'journals.id')
                    ->whereIn('journals.status', LedgerService::EFFECTIVE)->groupBy('journals.id', 'journals.voucher_no', 'journals.date')
                    ->havingRaw('abs(sum(journal_lines.debit) - sum(journal_lines.credit)) > 0.009')
                    ->selectRaw('journals.id, journals.voucher_no, journals.date, sum(journal_lines.debit) as d, sum(journal_lines.credit) as c')->get()
                    ->map(fn ($r) => ['no' => $r->voucher_no, 'detail' => __('ডেবিট :d, ক্রেডিট :c', ['d' => number_format((float) $r->d, 2), 'c' => number_format((float) $r->c, 2)]),
                        'link' => '/accounting/journals/'.$r->id]),
            ],
            'receipt_no_journal' => [
                'label' => __('খতিয়ানে পোস্ট হয়নি এমন বৈধ রশিদ'), 'severity' => 'error',
                'rows' => fn () => DB::table('receipts')->leftJoin('journals', 'journals.id', '=', 'receipts.journal_id')
                    ->where('receipts.status', '!=', 'cancelled')->where(fn ($w) => $w->whereNull('journals.id')->orWhere('journals.status', '!=', 'posted'))
                    ->get(['receipts.id', 'receipts.receipt_no', 'receipts.amount', 'receipts.date', 'receipts.module'])
                    ->map(fn ($r) => ['no' => $r->receipt_no, 'detail' => $r->date.' · '.number_format((float) $r->amount, 2), 'link' => self::receiptLink($r)]),
            ],
            'receipt_cancel_not_reversed' => [
                'label' => __('বাতিল রশিদ কিন্তু ভাউচার রিভার্স হয়নি'), 'severity' => 'error',
                'rows' => fn () => DB::table('receipts')->join('journals', 'journals.id', '=', 'receipts.journal_id')
                    ->where('receipts.status', 'cancelled')->where('journals.status', 'posted')
                    ->get(['receipts.id', 'receipts.receipt_no', 'journals.voucher_no', 'receipts.module'])
                    ->map(fn ($r) => ['no' => $r->receipt_no, 'detail' => __('ভাউচার :no', ['no' => $r->voucher_no]), 'link' => self::receiptLink($r)]),
            ],
            'invoice_no_journal' => [
                'label' => __('খতিয়ানে পোস্ট হয়নি এমন ইনভয়েস'), 'severity' => 'error',
                'rows' => fn () => DB::table('invoices')->where('status', '!=', 'cancelled')->whereNull('journal_id')
                    ->get(['id', 'invoice_no', 'amount'])->map(fn ($r) => ['no' => $r->invoice_no, 'detail' => number_format((float) $r->amount, 2), 'link' => '/irrigation/invoices/'.$r->id]),
            ],
            'water_bill_no_journal' => [
                'label' => __('খতিয়ানে পোস্ট হয়নি এমন পানির বিল'), 'severity' => 'error',
                'rows' => fn () => DB::table('water_bills')->where('status', '!=', 'cancelled')->whereNull('journal_id')
                    ->get(['id', 'bill_no', 'amount', 'connection_id'])->map(fn ($r) => ['no' => $r->bill_no, 'detail' => number_format((float) $r->amount, 2), 'link' => '/water/connections/'.$r->connection_id]),
            ],
            'loan_no_journal' => [
                'label' => __('বিতরণ ভাউচার নেই এমন চলমান ঋণ'), 'severity' => 'error',
                'rows' => fn () => DB::table('loans')->whereIn('status', ['active', 'closed'])->whereNull('journal_id')
                    ->get(['id', 'loan_no', 'amount'])->map(fn ($r) => ['no' => $r->loan_no, 'detail' => number_format((float) $r->amount, 2), 'link' => '/loans/'.$r->id]),
            ],
            'loan_payment_no_journal' => [
                'label' => __('ভাউচার নেই এমন ঋণ পরিশোধ'), 'severity' => 'error',
                'rows' => fn () => DB::table('loan_payments')->where('status', '!=', 'cancelled')->whereNull('journal_id')
                    ->get(['loan_id', 'payment_no', 'amount'])->map(fn ($r) => ['no' => $r->payment_no, 'detail' => number_format((float) $r->amount, 2), 'link' => '/loans/'.$r->loan_id]),
            ],
            'member_txn_no_journal' => [
                'label' => __('ভাউচার নেই এমন সঞ্চয়/শেয়ার লেনদেন'), 'severity' => 'error',
                'rows' => fn () => DB::table('member_transactions')->where('status', 'posted')->whereNull('journal_id')->whereNull('run_id')
                    // a share transfer between two members stays inside share capital, so it has no voucher
                    ->whereNotIn('type', ['transfer_in', 'transfer_out'])
                    ->get(['id', 'txn_no', 'amount', 'kind'])->map(fn ($r) => ['no' => $r->txn_no, 'detail' => number_format((float) $r->amount, 2), 'link' => '/funds/'.$r->kind.'/transactions/'.$r->id]),
            ],
            'combined_parts_mismatch' => [
                'label' => __('সমন্বিত রশিদের অংশের যোগফল মোট টাকার সমান নয়'), 'severity' => 'error',
                'rows' => fn () => DB::table('combined_payments')->where('status', '!=', 'cancelled')
                    ->whereRaw('abs(amount - (select coalesce(sum(p.amount),0) from combined_payment_parts p where p.combined_payment_id = combined_payments.id)) > 0.009')
                    ->get(['id', 'payment_no', 'amount'])->map(fn ($r) => ['no' => $r->payment_no, 'detail' => number_format((float) $r->amount, 2), 'link' => '/payments/combined/'.$r->id]),
            ],
            'trial_balance' => [
                'label' => __('রেওয়ামিল মিলছে না'), 'severity' => 'error',
                'rows' => function () {
                    $tb = $this->reports->trialBalance(now()->toDateString());

                    return $tb['balanced'] ? collect() : collect([['no' => __('রেওয়ামিল'), 'detail' => __('ডেবিট :d, ক্রেডিট :c', [
                        'd' => number_format($tb['total_debit'], 2), 'c' => number_format($tb['total_credit'], 2)]), 'link' => '/accounting/trial-balance']]);
                },
            ],
            'source_vs_ledger' => [
                'label' => __('মডিউলের হিসাব ও খতিয়ানে অমিল'), 'severity' => 'error',
                'rows' => fn () => collect($this->sourceVsLedger())->filter(fn ($r) => abs($r['difference']) >= 0.01)
                    ->map(fn ($r) => ['no' => $r['item'], 'detail' => __('মডিউল :s, খতিয়ান :l, পার্থক্য :d', [
                        's' => number_format($r['source'], 2), 'l' => number_format($r['ledger'], 2), 'd' => number_format($r['difference'], 2)]), 'link' => '/accounting/source-vs-ledger'])->values(),
            ],
        ];
    }

    /** Water receipts open on their own page; the rest on the irrigation receipt page. */
    private static function receiptLink(object $r): string
    {
        return ($r->module === 'water' ? '/water/receipts/' : '/payments/receipts/').$r->id;
    }

    /** Module totals against their control accounts, as of today. */
    public function sourceVsLedger(): array
    {
        $items = [
            ['item' => __('সেচ বকেয়া (অপরিশোধিত ইনভয়েস)'), 'key' => 'irrigation_receivable', 'sign' => 1,
                'source' => fn () => DB::table('invoices')->where('status', '!=', 'cancelled')->sum(DB::raw('amount - paid_amount'))],
            ['item' => __('পানির বিল বকেয়া (অপরিশোধিত বিল, জরিমানাসহ)'), 'key' => 'water_receivable', 'sign' => 1,
                'source' => fn () => DB::table('water_bills')->where('status', '!=', 'cancelled')->sum(DB::raw('amount + penalty - paid_amount'))],
            ['item' => __('সদস্যদের সঞ্চয় স্থিতি'), 'key' => 'savings_deposits', 'sign' => -1,
                'source' => fn () => DB::table('member_accounts')->where('kind', 'savings')->sum('balance')],
            ['item' => __('সদস্যদের শেয়ার স্থিতি'), 'key' => 'share_capital', 'sign' => -1,
                'source' => fn () => DB::table('member_accounts')->where('kind', 'share')->sum('balance')],
            ['item' => __('অপরিশোধিত ঋণ (আসল)'), 'key' => 'loans_receivable', 'sign' => 1,
                'source' => fn () => (float) DB::table('loans')->whereIn('status', ['active', 'closed'])->whereNotNull('journal_id')->sum('amount')
                    - (float) DB::table('loan_installments')->join('loans', 'loans.id', '=', 'loan_installments.loan_id')
                        ->whereIn('loans.status', ['active', 'closed'])->whereNotNull('loans.journal_id')->sum('loan_installments.principal_paid')],
            ['item' => __('স্থায়ী সম্পদ (ক্রয়মূল্য)'), 'key' => 'fixed_assets', 'sign' => 1,
                'source' => fn () => DB::table('assets')->whereNotIn('status', Asset::GONE)->sum('cost')],
            ['item' => __('পুঞ্জীভূত অবচয়'), 'key' => 'accumulated_depreciation', 'sign' => -1,
                'source' => fn () => DB::table('assets')->whereNotIn('status', Asset::GONE)->sum('accumulated_depreciation')],
        ];

        $out = [];
        foreach ($items as $i) {
            $account = Account::where('key', $i['key'])->first();
            if (! $account) {
                continue;
            }
            $source = round((float) ($i['source'])(), 2);
            $ledger = round($this->ledger->balance($account->id) * $i['sign'], 2);
            $out[] = [
                'item' => $i['item'], 'account' => $account->code.' — '.(app()->getLocale() === 'en' && $account->name_en ? $account->name_en : $account->name_bn),
                'source' => $source, 'ledger' => $ledger, 'difference' => round($source - $ledger, 2),
            ];
        }

        return $out;
    }

    /** Money collected per module (module records) against cash/bank receipt vouchers for the same period. */
    public function paymentReconciliation(string $from, string $to): array
    {
        $ledger = $this->reports->collectionQuery($from, $to)->groupBy('j.module')->selectRaw('j.module as m, SUM(l.debit) as amount')->pluck('amount', 'm');
        $funds = $this->reports->fundAccountIds();
        $src = [
            'irrigation' => DB::table('receipts')->where('module', 'irrigation')->where('status', '!=', 'cancelled')->whereBetween('date', [$from, $to])
                ->selectRaw('count(*) as n, coalesce(sum(amount),0) as amount')->first(),
            'water' => DB::table('receipts')->where('module', 'water')->where('status', '!=', 'cancelled')->whereBetween('date', [$from, $to])
                ->selectRaw('count(*) as n, coalesce(sum(amount),0) as amount')->first(),
            'loan' => DB::table('loan_payments')->where('status', '!=', 'cancelled')->whereBetween('date', [$from, $to])
                ->selectRaw('count(*) as n, coalesce(sum(amount),0) as amount')->first(),
        ];
        foreach (['savings', 'share'] as $kind) {
            $src[$kind] = DB::table('member_transactions')->where('kind', $kind)->where('status', 'posted')->where('direction', 'in')
                ->whereIn('fund_account_id', $funds ?: [0])->whereBetween('date', [$from, $to])
                ->selectRaw('count(*) as n, coalesce(sum(amount),0) as amount')->first();
        }
        $labels = config('erp.modules');
        $rows = [];
        foreach ($src as $module => $s) {
            $l = round((float) ($ledger[$module] ?? 0), 2);
            $rows[] = ['module' => __($labels[$module]), 'count' => (int) $s->n, 'source' => round((float) $s->amount, 2), 'ledger' => $l,
                'difference' => round((float) $s->amount - $l, 2)];
        }

        return $rows;
    }

    /** Run all ledger checks: [key, label, severity, count, samples]. */
    public function run(int $samples = 20): Collection
    {
        return collect($this->checks())->map(function ($c, $key) use ($samples) {
            $rows = collect(($c['rows'])());

            return ['key' => $key, 'group' => 'ledger', 'label' => $c['label'], 'severity' => $c['severity'], 'count' => $rows->count(), 'samples' => $rows->take($samples)->values()->all()];
        })->values();
    }
}
