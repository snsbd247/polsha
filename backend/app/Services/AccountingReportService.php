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
}
