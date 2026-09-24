<?php

namespace App\Services;

use App\Models\Account;
use App\Models\BankAccount;
use App\Models\BankReconciliation;
use App\Models\BankStatementLine;
use App\Models\JournalLine;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Monthly bank reconciliation: the bank's own statement lines are keyed in
 * and matched against the bank account's ledger lines. Matching ticks the
 * ledger line (journal_lines.reconciled_at). What is left unmatched on
 * either side explains the gap between the book and the bank balance:
 *
 *   bank closing = book closing − unmatched book lines + unmatched bank lines
 */
class BankReconciliationService
{
    /** How many days apart a statement line and a ledger line may be and still auto-match. */
    public const MATCH_DAYS = 5;

    public function __construct(private LedgerService $ledger) {}

    public function start(BankAccount $bank, array $data): BankReconciliation
    {
        if (BankReconciliation::where('bank_account_id', $bank->id)->where('period', $data['period'])->exists()) {
            throw ValidationException::withMessages(['period' => __('এই মাসের মিলকরণ আগেই শুরু করা হয়েছে।')]);
        }
        if (BankReconciliation::where('bank_account_id', $bank->id)->where('status', 'draft')->exists()) {
            throw ValidationException::withMessages(['period' => __('এই ব্যাংক হিসাবের একটি মিলকরণ চলমান আছে; আগে সেটি চূড়ান্ত করুন।')]);
        }
        $last = BankReconciliation::where('bank_account_id', $bank->id)->where('status', 'finalized')->orderByDesc('period')->first();
        if ($last && $data['period'] <= $last->period) {
            throw ValidationException::withMessages(['period' => __(':period পর্যন্ত মিলকরণ চূড়ান্ত হয়ে গেছে।', ['period' => $last->period])]);
        }

        return BankReconciliation::create([
            'bank_account_id' => $bank->id, 'period' => $data['period'],
            // Continue from the last finalized statement when the user leaves opening blank.
            'statement_opening' => $data['statement_opening'] ?? ($last?->statement_closing ?? 0),
            'statement_closing' => $data['statement_closing'], 'status' => 'draft', 'note' => $data['note'] ?? null,
            'created_by' => auth()->id(),
        ]);
    }

    public function update(BankReconciliation $rec, array $data): BankReconciliation
    {
        $this->draft($rec);
        $rec->update(array_intersect_key($data, array_flip(['statement_opening', 'statement_closing', 'note'])));

        return $rec;
    }

    /** @param  array<int, array{date:string, description?:?string, reference?:?string, amount:float}>  $lines */
    public function addLines(BankReconciliation $rec, array $lines): int
    {
        $this->draft($rec);
        foreach ($lines as $i => $l) {
            if ($l['date'] < $rec->startDate() || $l['date'] > $rec->endDate()) {
                throw ValidationException::withMessages(["lines.$i.date" => __('তারিখ মিলকরণের মাসের মধ্যে হতে হবে।')]);
            }
            if ((float) $l['amount'] == 0.0) {
                throw ValidationException::withMessages(["lines.$i.amount" => __('টাকার পরিমাণ শূন্য হতে পারে না।')]);
            }
        }
        DB::transaction(function () use ($rec, $lines) {
            foreach ($lines as $l) {
                $rec->lines()->create([
                    'date' => $l['date'], 'description' => $l['description'] ?? null, 'reference' => $l['reference'] ?? null,
                    'amount' => round((float) $l['amount'], 2),
                ]);
            }
        });

        return count($lines);
    }

    public function deleteLine(BankReconciliation $rec, BankStatementLine $line): void
    {
        $this->draft($rec);
        DB::transaction(function () use ($line) {
            $this->release($line);
            $line->delete();
        });
    }

    /** Everything the reconciliation screen needs. */
    public function view(BankReconciliation $rec): array
    {
        $rec->load(['bankAccount.account:id,code,name_bn,name_en', 'creator:id,name_bn,name_en', 'finalizer:id,name_bn,name_en']);
        $accountId = $rec->bankAccount->account_id;
        $lines = $rec->lines()->with('journalLine.journal:id,voucher_no,date,narration')->orderBy('date')->orderBy('id')->get();
        $matchedIds = $lines->pluck('journal_line_id')->filter()->all();

        // Ledger side: this month's lines, plus anything older still outstanding.
        $book = JournalLine::with('journal:id,voucher_no,voucher_type,date,narration,status')
            ->where('account_id', $accountId)
            ->whereHas('journal', fn ($q) => $q->whereIn('status', LedgerService::EFFECTIVE)->where('date', '<=', $rec->endDate()))
            ->where(fn ($q) => $q->whereNull('reconciled_at')->orWhereIn('id', $matchedIds ?: [0])
                ->orWhereHas('journal', fn ($j) => $j->where('date', '>=', $rec->startDate())))
            ->get()
            ->sortBy(fn ($l) => $l->journal->date->toDateString().sprintf('%010d', $l->id))->values()
            ->map(fn ($l) => [
                'id' => $l->id, 'date' => $l->journal->date->toDateString(), 'voucher_no' => $l->journal->voucher_no,
                'narration' => $l->journal->narration, 'remarks' => $l->remarks, 'amount' => round((float) $l->debit - (float) $l->credit, 2),
                'reconciled' => $l->reconciled_at !== null, 'matched_here' => in_array($l->id, $matchedIds, true),
                'earlier' => $l->journal->date->toDateString() < $rec->startDate(),
            ]);

        $bookClosing = $rec->status === 'finalized' && $rec->book_closing !== null
            ? (float) $rec->book_closing : $this->ledger->balance($accountId, $rec->endDate());
        $unmatchedBook = round($book->where('reconciled', false)->sum('amount'), 2);
        $unmatchedBank = round((float) $lines->whereNull('journal_line_id')->sum('amount'), 2);
        $linesTotal = round((float) $lines->sum('amount'), 2);
        $adjusted = round($bookClosing - $unmatchedBook + $unmatchedBank, 2);

        return [
            'reconciliation' => $rec, 'lines' => $lines, 'book' => $book,
            'totals' => [
                'statement_opening' => (float) $rec->statement_opening, 'statement_lines' => $linesTotal,
                'statement_closing' => (float) $rec->statement_closing,
                'statement_gap' => round((float) $rec->statement_opening + $linesTotal - (float) $rec->statement_closing, 2),
                'book_closing' => $bookClosing, 'unmatched_book' => $unmatchedBook, 'unmatched_bank' => $unmatchedBank,
                'adjusted_book' => $adjusted, 'difference' => round((float) $rec->statement_closing - $adjusted, 2),
            ],
        ];
    }

    /** Pair each unmatched statement line with an unticked ledger line of the same amount, closest date first. */
    public function autoMatch(BankReconciliation $rec): int
    {
        $this->draft($rec);
        $accountId = $rec->bankAccount->account_id;
        $n = 0;
        DB::transaction(function () use ($rec, $accountId, &$n) {
            foreach ($rec->lines()->whereNull('journal_line_id')->orderBy('date')->get() as $line) {
                $amount = (float) $line->amount;
                $from = $line->date->copy()->subDays(self::MATCH_DAYS)->toDateString();
                $to = $line->date->copy()->addDays(self::MATCH_DAYS)->toDateString();
                // closest date first (sorted here so it works on any database)
                $candidate = JournalLine::query()->select('journal_lines.*', 'journals.date as journal_date')
                    ->join('journals', 'journals.id', '=', 'journal_lines.journal_id')
                    ->where('journal_lines.account_id', $accountId)->whereNull('journal_lines.reconciled_at')
                    ->whereIn('journals.status', LedgerService::EFFECTIVE)->whereBetween('journals.date', [$from, $to])
                    ->where($amount > 0 ? 'journal_lines.debit' : 'journal_lines.credit', abs($amount))
                    ->orderBy('journal_lines.id')->get()
                    ->sortBy(fn ($l) => abs(Carbon::parse($l->journal_date)->diffInDays($line->date)), SORT_NUMERIC, false)
                    ->first();
                if ($candidate) {
                    $this->pair($line, $candidate);
                    $n++;
                }
            }
        });

        return $n;
    }

    public function match(BankReconciliation $rec, BankStatementLine $line, int $journalLineId): BankStatementLine
    {
        $this->draft($rec);
        $book = JournalLine::with('journal')->findOrFail($journalLineId);
        if ($book->account_id !== $rec->bankAccount->account_id || ! in_array($book->journal->status, LedgerService::EFFECTIVE, true)) {
            throw ValidationException::withMessages(['journal_line_id' => __('এই লাইন এই ব্যাংক হিসাবের নয়।')]);
        }
        if ($book->reconciled_at !== null) {
            throw ValidationException::withMessages(['journal_line_id' => __('এই খতিয়ান লাইন আগেই মেলানো হয়েছে।')]);
        }
        if (round((float) $book->debit - (float) $book->credit, 2) !== round((float) $line->amount, 2)) {
            throw ValidationException::withMessages(['journal_line_id' => __('টাকার পরিমাণ মিলছে না।')]);
        }
        if ($book->journal->date->toDateString() > $rec->endDate()) {
            throw ValidationException::withMessages(['journal_line_id' => __('পরের মাসের লাইন এই মাসে মেলানো যাবে না।')]);
        }
        DB::transaction(function () use ($line, $book) {
            $this->release($line);
            $this->pair($line, $book);
        });

        return $line->fresh('journalLine.journal');
    }

    public function unmatch(BankReconciliation $rec, BankStatementLine $line): void
    {
        $this->draft($rec);
        DB::transaction(fn () => $this->release($line));
    }

    /**
     * A statement line the books do not have yet (bank charge, interest,
     * direct deposit): post it against the chosen account and match it.
     */
    public function book(BankReconciliation $rec, BankStatementLine $line, int $counterAccountId): BankStatementLine
    {
        $this->draft($rec);
        if ($line->journal_line_id) {
            throw ValidationException::withMessages(['line' => __('এই লাইন আগেই মেলানো হয়েছে।')]);
        }
        $counter = Account::findOrFail($counterAccountId);
        if (! $counter->is_postable || in_array($counter->key, Account::CASH_STREAMS, true) || $counter->id === $rec->bankAccount->account_id) {
            throw ValidationException::withMessages(['account_id' => __('এই হিসাবে পোস্ট করা যাবে না।')]);
        }
        $amount = abs((float) $line->amount);
        $bankId = $rec->bankAccount->account_id;
        $in = (float) $line->amount > 0;

        return DB::transaction(function () use ($rec, $line, $counter, $amount, $bankId, $in) {
            $journal = $this->ledger->postNow($in ? 'receipt' : 'payment', $line->date->toDateString(),
                __('ব্যাংক বিবরণী অনুযায়ী (:period): :desc', ['period' => $rec->period, 'desc' => $line->description ?: $line->reference ?: '—']),
                $in
                    ? [['account_id' => $bankId, 'debit' => $amount, 'remarks' => $line->reference], ['account_id' => $counter->id, 'credit' => $amount]]
                    : [['account_id' => $counter->id, 'debit' => $amount], ['account_id' => $bankId, 'credit' => $amount, 'remarks' => $line->reference]],
                'bank', $rec);
            $bookLine = $journal->lines()->where('account_id', $bankId)->firstOrFail();
            $this->pair($line, $bookLine);

            return $line->fresh('journalLine.journal');
        });
    }

    public function finalize(BankReconciliation $rec): BankReconciliation
    {
        $this->draft($rec);
        $t = $this->view($rec)['totals'];
        if ($t['statement_gap'] != 0) {
            throw ValidationException::withMessages(['statement_closing' => __('বিবরণীর প্রারম্ভিক জের + লাইনগুলোর যোগফল সমাপনী জেরের সাথে মিলছে না (পার্থক্য :d)।', ['d' => number_format($t['statement_gap'], 2)])]);
        }
        if ($t['difference'] != 0) {
            throw ValidationException::withMessages(['difference' => __('খাতা ও ব্যাংকের জেরে এখনো :d টাকা পার্থক্য আছে।', ['d' => number_format($t['difference'], 2)])]);
        }
        $rec->update(['status' => 'finalized', 'book_closing' => $t['book_closing'], 'finalized_by' => auth()->id(), 'finalized_at' => now()]);

        return $rec;
    }

    public function destroy(BankReconciliation $rec): void
    {
        $this->draft($rec);
        DB::transaction(function () use ($rec) {
            foreach ($rec->lines as $line) {
                $this->release($line);
            }
            $rec->lines()->delete();
            $rec->delete();
        });
    }

    private function pair(BankStatementLine $line, JournalLine $book): void
    {
        $book->update(['reconciled_at' => $line->date->copy()->setTimeFrom(Carbon::now()), 'reconciled_by' => auth()->id()]);
        $line->update(['journal_line_id' => $book->id]);
    }

    private function release(BankStatementLine $line): void
    {
        if ($line->journal_line_id) {
            JournalLine::whereKey($line->journal_line_id)->update(['reconciled_at' => null, 'reconciled_by' => null]);
            $line->update(['journal_line_id' => null]);
        }
    }

    private function draft(BankReconciliation $rec): void
    {
        if ($rec->status !== 'draft') {
            throw ValidationException::withMessages(['status' => __('চূড়ান্ত মিলকরণ আর পরিবর্তন করা যায় না।')]);
        }
    }
}
