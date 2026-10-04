<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\Receipt;
use App\Models\WaterBill;
use App\Models\WaterBillPenalty;
use App\Models\WaterConnection;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Household water supply. A connection is billed a fixed amount every month
 * (its own fee, or its type's). Bills are posted when made — Dr water
 * receivable / Cr water income — and paid through ReceiptService, so cash
 * lands in "পানির নগদ". The collector may add a penalty at the counter; it is
 * booked on the bill (Dr receivable / Cr penalty income) and undone if that
 * receipt is cancelled.
 */
class WaterService
{
    public function __construct(private LedgerService $ledger, private ReceiptService $receipts, private ApprovalService $approvals) {}

    /** A new connection, with its connection-fee bill when a fee is charged. */
    public function open(array $data, float $connectionFee): WaterConnection
    {
        return DB::transaction(function () use ($data, $connectionFee) {
            $connection = WaterConnection::create($data + [
                'connection_no' => SequenceService::next('water_connection'),
                'status' => 'active',
                'created_by' => auth()->id(),
            ]);
            if ($connectionFee > 0) {
                $this->book($connection, 'connection', null, $connection->connected_on->toDateString(), null, $connectionFee);
            }

            return $connection;
        });
    }

    /** Disconnect, reconnect (with an optional reconnection fee) or close for good. */
    public function changeStatus(WaterConnection $connection, string $action, string $date, ?string $reason, float $fee = 0): WaterConnection
    {
        return DB::transaction(function () use ($connection, $action, $date, $reason, $fee) {
            $connection = WaterConnection::whereKey($connection->id)->lockForUpdate()->firstOrFail();
            $allowed = ['disconnect' => ['active'], 'reconnect' => ['disconnected'], 'close' => ['active', 'disconnected']][$action];
            if (! in_array($connection->status, $allowed, true)) {
                throw ValidationException::withMessages(['action' => __('এই অবস্থায় সংযোগটিতে এই কাজ করা যায় না।')]);
            }
            if ($action === 'close' && ($due = $this->due($connection)) > 0) {
                throw ValidationException::withMessages(['action' => __('সংযোগে :due টাকা বকেয়া আছে — আগে আদায় করুন বা বিল বাতিল করুন।', ['due' => number_format($due, 2)])]);
            }
            $connection->update([
                'status' => ['disconnect' => 'disconnected', 'reconnect' => 'active', 'close' => 'closed'][$action],
                'status_date' => $date, 'status_reason' => $reason,
            ]);
            if ($action === 'reconnect' && $fee > 0) {
                $this->book($connection, 'reconnection', null, $date, null, $fee);
            }

            return $connection->fresh();
        });
    }

    public function due(WaterConnection $connection): float
    {
        return round((float) WaterBill::where('connection_id', $connection->id)->where('status', '!=', 'cancelled')
            ->selectRaw('COALESCE(SUM(amount + penalty - paid_amount), 0) as due')->value('due'), 2);
    }

    /**
     * Who gets a bill for the month: connections active now that were connected
     * by the month's end and have no bill for it yet. Those with no fee are listed apart.
     */
    public function billable(string $period): array
    {
        $end = Carbon::createFromFormat('Y-m-d', $period.'-01')->endOfMonth()->toDateString();
        $billed = WaterBill::where('kind', 'monthly')->where('period', $period)->where('status', '!=', 'cancelled')->pluck('connection_id');
        $all = WaterConnection::with('type')->where('status', 'active')->whereDate('connected_on', '<=', $end)
            ->whereNotIn('id', $billed)->orderBy('connection_no')->get();
        [$ready, $noFee] = $all->partition(fn (WaterConnection $c) => $c->fee() > 0);

        return ['ready' => $ready->values(), 'no_fee' => $noFee->values(), 'already_billed' => $billed->count()];
    }

    /** Every billable connection's monthly bill for the period. */
    public function generate(string $period, string $billDate, ?string $dueDate): Collection
    {
        return DB::transaction(function () use ($period, $billDate, $dueDate) {
            $ready = $this->billable($period)['ready'];
            if ($ready->isEmpty()) {
                throw ValidationException::withMessages(['period' => __('এই মাসে বিল করার মতো কোনো সংযোগ নেই।')]);
            }

            return $ready->map(fn (WaterConnection $c) => $this->book($c, 'monthly', $period, $billDate, $dueDate, $c->fee()));
        });
    }

    /**
     * Takes money for some of a connection's bills on one receipt. A penalty,
     * when given, is added to the oldest bill in the payment first.
     *
     * @param  array<int, array{bill_id:int, amount:float}>  $items
     */
    public function collect(WaterConnection $connection, array $money, array $items, float $penalty): Receipt
    {
        return DB::transaction(function () use ($connection, $money, $items, $penalty) {
            $bills = WaterBill::whereIn('id', array_column($items, 'bill_id'))->where('connection_id', $connection->id)
                ->orderBy('bill_date')->orderBy('id')->get()->keyBy('id');
            if ($bills->count() !== count($items)) {
                throw ValidationException::withMessages(['items' => __('বিলগুলো এই সংযোগের নয়।')]);
            }
            $amounts = collect($items)->mapWithKeys(fn ($i) => [(int) $i['bill_id'] => round((float) $i['amount'], 2)]);

            $penaltyRows = [];
            if ($penalty > 0) {
                $first = $bills->first();
                if ($first->status === 'cancelled') {
                    throw ValidationException::withMessages(['penalty' => __('বাতিল বিলে জরিমানা যোগ করা যায় না।')]);
                }
                $penaltyRows[] = $this->addPenalty($first, $penalty, $money['date']);
                // the penalty is paid with this money
                $amounts[$first->id] = round($amounts[$first->id] + $penalty, 2);
            }

            $receipt = $this->receipts->create([
                'module' => 'water', 'farmer_id' => null, 'payer_name' => $connection->name_bn,
            ] + $money, $bills->map(fn (WaterBill $b) => ['payable' => $b->fresh(), 'amount' => $amounts[$b->id]])->values()->all());

            foreach ($penaltyRows as $row) {
                $row->update(['receipt_id' => $receipt->id]);
            }

            return $receipt;
        });
    }

    /** Receipt cancelled (approval handler): its penalties come off the bill and the ledger. */
    public function undoPenalties(Receipt $receipt): void
    {
        foreach (WaterBillPenalty::where('receipt_id', $receipt->id)->where('amount', '>', 0)->whereNull('reversed_at')->with(['journal', 'bill'])->get() as $p) {
            $this->reversePenalty($p, __('রশিদ বাতিলে জরিমানা ফেরত'));
        }
    }

    /**
     * A penalty still unpaid on a bill is let off (manager's decision, with a reason):
     * Dr penalty income / Cr receivable for what is waived; what was paid stays.
     */
    public function waivePenalty(WaterBill $bill, string $reason, string $date): WaterBill
    {
        return DB::transaction(function () use ($bill, $reason, $date) {
            $bill = WaterBill::whereKey($bill->id)->lockForUpdate()->firstOrFail();
            $waive = round(min((float) $bill->penalty, $bill->dueAmount()), 2);
            if ($bill->status === 'cancelled' || $waive <= 0) {
                throw ValidationException::withMessages(['bill' => __('এই বিলে মওকুফ করার মতো বকেয়া জরিমানা নেই।')]);
            }
            $journal = $this->ledger->postNow('journal', $date,
                __('পানির বিলের জরিমানা মওকুফ — বিল :no: :reason', ['no' => $bill->bill_no, 'reason' => $reason]),
                [
                    ['account_id' => Account::byKey('water_penalty_income')->id, 'debit' => $waive],
                    ['account_id' => Account::byKey('water_receivable')->id, 'credit' => $waive],
                ], 'water', $bill);
            WaterBillPenalty::create(['bill_id' => $bill->id, 'date' => $date, 'amount' => -$waive, 'journal_id' => $journal->id, 'created_by' => auth()->id()]);
            $bill->update(['penalty' => round((float) $bill->penalty - $waive, 2)]);
            $bill->setPaid((float) $bill->paid_amount);
            AuditLogger::log('water', 'penalty_waived', $bill, null, ['amount' => $waive, 'reason' => $reason]);

            return $bill->fresh();
        });
    }

    public function requestCancel(WaterBill $bill, string $reason): ApprovalRequest
    {
        if ($bill->status === 'cancelled') {
            throw ValidationException::withMessages(['bill' => __('বিলটি আগেই বাতিল হয়েছে।')]);
        }
        if ((float) $bill->paid_amount > 0) {
            throw ValidationException::withMessages(['bill' => __('আদায় হওয়া বিল বাতিল করা যাবে না; আগে রশিদ বাতিল করুন।')]);
        }
        if (ApprovalRequest::where('action_key', 'water.bill_cancel')->where('status', ApprovalRequest::PENDING)
            ->where('approvable_type', WaterBill::class)->where('approvable_id', $bill->id)->exists()) {
            throw ValidationException::withMessages(['bill' => __('এই বিল বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় আছে।')]);
        }

        return $this->approvals->submit(
            'water.bill_cancel',
            __('পানির বিল বাতিল: :no', ['no' => $bill->bill_no]),
            $bill,
            ['বিল' => $bill->bill_no, 'গ্রাহক' => $bill->snapshot['name_bn'] ?? '', 'সংযোগ' => $bill->snapshot['connection_no'] ?? '', 'পরিমাণ' => $bill->total(), 'কারণ' => $reason],
            null,
            $bill->total(),
        );
    }

    /** Approval handler: reverse the bill's voucher (and any penalty) and void it. */
    public function cancel(WaterBill $bill, ?string $reason): void
    {
        DB::transaction(function () use ($bill, $reason) {
            $bill = WaterBill::whereKey($bill->id)->lockForUpdate()->firstOrFail();
            if ($bill->status === 'cancelled') {
                return;
            }
            if ((float) $bill->paid_amount > 0) {
                throw ValidationException::withMessages(['bill' => __('আদায় হওয়া বিল বাতিল করা যাবে না; আগে রশিদ বাতিল করুন।')]);
            }
            foreach ($bill->penalties()->whereNull('reversed_at')->with('journal')->get() as $p) {
                $this->reversePenalty($p, __('বিল বাতিল'));
            }
            if ($bill->journal && $bill->journal->status === 'posted') {
                $this->ledger->reverse($bill->journal, __('পানির বিল বাতিল'));
            }
            $bill->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancelled_by' => auth()->id(), 'cancel_reason' => $reason]);
        });
    }

    private function book(WaterConnection $c, string $kind, ?string $period, string $billDate, ?string $dueDate, float $amount): WaterBill
    {
        $bill = WaterBill::create([
            'bill_no' => SequenceService::next('water_bill'),
            'connection_id' => $c->id, 'kind' => $kind, 'period' => $period,
            'bill_date' => $billDate, 'due_date' => $dueDate,
            'amount' => round($amount, 2), 'penalty' => 0, 'paid_amount' => 0, 'status' => 'unpaid',
            'snapshot' => $c->snapshot(), 'created_by' => auth()->id(),
        ]);
        $income = $kind === 'monthly' ? 'water_income' : 'water_connection_fee_income';
        $journal = $this->ledger->postNow('journal', $billDate,
            __(':what :no — :name, সংযোগ :conn', [
                'what' => $kind === 'monthly' ? __('পানির বিল') : __(WaterBill::KINDS[$kind]),
                'no' => $bill->bill_no, 'name' => $c->name_bn, 'conn' => $c->connection_no,
            ]),
            [
                ['account_id' => Account::byKey('water_receivable')->id, 'debit' => $bill->amount],
                ['account_id' => Account::byKey($income)->id, 'credit' => $bill->amount],
            ], 'water', $bill);
        $bill->update(['journal_id' => $journal->id]);

        return $bill;
    }

    private function addPenalty(WaterBill $bill, float $amount, string $date): WaterBillPenalty
    {
        $bill = WaterBill::whereKey($bill->id)->lockForUpdate()->firstOrFail();
        $journal = $this->ledger->postNow('journal', $date,
            __('পানির বিলের জরিমানা — বিল :no', ['no' => $bill->bill_no]),
            [
                ['account_id' => Account::byKey('water_receivable')->id, 'debit' => round($amount, 2)],
                ['account_id' => Account::byKey('water_penalty_income')->id, 'credit' => round($amount, 2)],
            ], 'water', $bill);
        $bill->update(['penalty' => round((float) $bill->penalty + $amount, 2)]);
        $bill->setPaid((float) $bill->paid_amount);

        return WaterBillPenalty::create([
            'bill_id' => $bill->id, 'date' => $date, 'amount' => round($amount, 2), 'journal_id' => $journal->id, 'created_by' => auth()->id(),
        ]);
    }

    private function reversePenalty(WaterBillPenalty $p, string $why): void
    {
        if ($p->journal && $p->journal->status === 'posted') {
            $this->ledger->reverse($p->journal, $why);
        }
        $bill = WaterBill::whereKey($p->bill_id)->lockForUpdate()->firstOrFail();
        $bill->update(['penalty' => max(0, round((float) $bill->penalty - (float) $p->amount, 2))]);
        $bill->setPaid((float) $bill->paid_amount);
        $p->update(['reversed_at' => now()]);
    }
}
