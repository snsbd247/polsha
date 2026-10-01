<?php

namespace App\Services;

use App\Models\Account;
use App\Models\CombinedPayment;
use App\Models\Farmer;
use App\Models\FieldDeposit;
use App\Models\Receipt;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Collection at the farmer's door. The field collector takes cash on a phone;
 * it is split like a counter payment (loan → irrigation → share → savings)
 * but booked to "cash with field collectors". When the collector hands the
 * money in, someone at the office receives it and it moves to the society's
 * cash streams (irrigation cash / society cash) in one voucher.
 */
class FieldCollectionService
{
    public const CASH = 'cash_field';

    public function __construct(private CombinedPaymentService $payments, private LedgerService $ledger) {}

    /** @param  array{farmer_id:int, amount:float, remarks?:?string}  $data */
    public function collect(array $data, User $collector): CombinedPayment
    {
        $date = now()->toDateString();

        return DB::transaction(function () use ($data, $date, $collector) {
            $payment = ReceiptService::cashInto(self::CASH, fn () => $this->payments->create([
                'farmer_id' => $data['farmer_id'], 'date' => $date, 'amount' => $data['amount'], 'method' => 'cash',
                'remarks' => trim(__('মাঠে আদায়').' — '.$collector->name_bn.(! empty($data['remarks']) ? ' · '.$data['remarks'] : '')),
            ]));
            $payment->update(['field_collector_id' => $collector->id]);

            return $payment->fresh(['parts', 'farmer']);
        });
    }

    /** Posted collections a collector still holds (not yet handed in). */
    public function holding(int $collectorId): Collection
    {
        return CombinedPayment::with(['parts', 'farmer:id,farmer_code,name_bn,name_en'])
            ->where('field_collector_id', $collectorId)->whereNull('field_deposit_id')->where('status', 'posted')
            ->orderBy('date')->orderBy('id')->get();
    }

    /** Collector → what they hold: count, amount, oldest date; for the office screen. */
    public function collectors(): Collection
    {
        $rows = CombinedPayment::whereNotNull('field_collector_id')->whereNull('field_deposit_id')->whereIn('status', ['posted', 'cancel_pending'])
            ->groupBy('field_collector_id')
            ->selectRaw('field_collector_id, COUNT(*) n, SUM(CASE WHEN status = ? THEN amount ELSE 0 END) amount, MIN(date) oldest, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) pending_cancel', ['posted', 'cancel_pending'])
            ->get()->keyBy('field_collector_id');
        $users = User::permission('field.create')->orWhereIn('id', $rows->keys())->get(['id', 'name_bn', 'name_en', 'username', 'mobile', 'is_active']);

        return $users->map(fn (User $u) => [
            'id' => $u->id, 'name_bn' => $u->name_bn, 'name_en' => $u->name_en, 'mobile' => $u->mobile, 'is_active' => (bool) $u->is_active,
            'count' => (int) ($rows[$u->id]->n ?? 0), 'amount' => round((float) ($rows[$u->id]->amount ?? 0), 2),
            'oldest' => isset($rows[$u->id]) ? Carbon::parse($rows[$u->id]->oldest)->toDateString() : null,
            'pending_cancel' => (int) ($rows[$u->id]->pending_cancel ?? 0),
        ])->sortByDesc('amount')->values();
    }

    /** The office receives everything a collector holds; the money moves to the society's cash. */
    public function deposit(User $collector, User $receiver, string $date, ?string $note): FieldDeposit
    {
        if ($collector->id === $receiver->id) {
            throw ValidationException::withMessages(['collector_id' => __('নিজের আদায়ের টাকা নিজে জমা নেওয়া যায় না; অফিসের অন্য কেউ জমা নেবেন।')]);
        }

        return DB::transaction(function () use ($collector, $receiver, $date, $note) {
            $payments = CombinedPayment::with('parts')->where('field_collector_id', $collector->id)->whereNull('field_deposit_id')
                ->where('status', 'posted')->lockForUpdate()->get();
            if ($payments->isEmpty()) {
                throw ValidationException::withMessages(['collector_id' => __('এই মাঠকর্মীর কাছে জমা দেওয়ার মতো কোনো আদায় নেই।')]);
            }
            $last = $payments->max(fn ($p) => $p->date->toDateString());
            if ($date < $last) {
                throw ValidationException::withMessages(['date' => __('জমার তারিখ শেষ আদায়ের তারিখের (:date) আগে হতে পারে না।', ['date' => Carbon::parse($last)->format('d/m/Y')])]);
            }
            // each part goes to the cash stream it would have reached at the counter
            $streams = [];
            foreach ($payments as $p) {
                foreach ($p->parts as $part) {
                    $key = Receipt::CASH_ACCOUNT[$part->module] ?? 'cash_misc';
                    $streams[$key] = ($streams[$key] ?? 0) + (int) round((float) $part->amount * 100);
                }
            }
            $streams = array_map(fn ($paisa) => $paisa / 100, $streams);
            $total = round(array_sum($streams), 2);

            $deposit = FieldDeposit::create([
                'deposit_no' => SequenceService::next('field_deposit'), 'collector_id' => $collector->id, 'date' => $date, 'amount' => $total,
                'payments_count' => $payments->count(), 'parts' => $streams, 'note' => $note, 'received_by' => $receiver->id,
            ]);
            $lines = [];
            foreach ($streams as $key => $amount) {
                $lines[] = ['account_id' => Account::byKey($key)->id, 'debit' => $amount];
            }
            $lines[] = ['account_id' => Account::byKey(self::CASH)->id, 'credit' => $total, 'remarks' => $collector->name_bn];
            $journal = $this->ledger->postNow('contra', $date,
                __('মাঠ-আদায় জমা :no — :name (:n টি রশিদ)', ['no' => $deposit->deposit_no, 'name' => $collector->name_bn, 'n' => $payments->count()]),
                $lines, 'payment', $deposit);
            $deposit->update(['journal_id' => $journal->id]);
            CombinedPayment::whereIn('id', $payments->pluck('id'))->update(['field_deposit_id' => $deposit->id]);

            return $deposit->fresh(['collector:id,name_bn,name_en', 'receiver:id,name_bn,name_en']);
        });
    }
}
