<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\DistributionRun;
use App\Models\Journal;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Savings and share accounts. The transaction table is the member-side
 * book; every posted money movement also books a voucher so the member
 * balances always add up to the ledger (savings_deposits / share_capital).
 *
 * Money in (deposit / share purchase) posts at once. Everything that takes
 * money out or rewrites history — withdrawal, opening balance, adjustment,
 * share transfer, cancellation, profit and dividend runs — waits for approval.
 */
class MemberFundService
{
    public function __construct(
        private LedgerService $ledger,
        private ApprovalService $approvals,
        private ReceiptService $receipts,
    ) {}

    public function openAccount(Member $member, string $kind, string $openedOn, ?string $remarks = null): MemberAccount
    {
        if ($member->status !== Member::ACTIVE) {
            throw ValidationException::withMessages(['member_id' => __('শুধু সক্রিয় সদস্যের হিসাব খোলা যায়।')]);
        }
        if (MemberAccount::where('kind', $kind)->where('member_id', $member->id)->exists()) {
            throw ValidationException::withMessages(['member_id' => $kind === 'share'
                ? __('এই সদস্যের শেয়ার হিসাব আগেই খোলা হয়েছে।') : __('এই সদস্যের সঞ্চয় হিসাব আগেই খোলা হয়েছে।')]);
        }

        return DB::transaction(fn () => MemberAccount::create([
            'kind' => $kind, 'member_id' => $member->id, 'account_no' => SequenceService::next(MemberAccount::CONFIG[$kind]['seq']),
            'opened_on' => $openedOn, 'status' => 'active', 'balance' => 0, 'remarks' => $remarks, 'created_by' => auth()->id(),
        ]));
    }

    /**
     * Every active member has one savings and one share account: opened when
     * the membership begins (approval, old register, import). Only the
     * missing ones are opened, so this is safe to call again.
     */
    public function ensureAccounts(Member $member, string $openedOn): void
    {
        if ($member->status !== Member::ACTIVE) {
            return;
        }
        foreach (array_keys(MemberAccount::CONFIG) as $kind) {
            if (! MemberAccount::where('kind', $kind)->where('member_id', $member->id)->exists()) {
                $this->openAccount($member, $kind, $openedOn, __('সদস্যপদের সাথে স্বয়ংক্রিয়ভাবে খোলা'));
            }
        }
    }

    /**
     * Deposit (savings) or share purchase — posted immediately.
     *
     * @param  array{date:string, amount:float, method:string, fund_account_id?:?int, reference?:?string, remarks?:?string}  $data
     */
    public function moneyIn(MemberAccount $account, array $data): MemberTransaction
    {
        $this->assertUsable($account, true);
        $fund = $this->fund($account->kind, $data);

        return DB::transaction(function () use ($account, $data, $fund) {
            $txn = $this->make($account, MemberAccount::CONFIG[$account->kind]['in'], 'in', ['fund_account_id' => $fund->id] + $data);
            $this->post($txn);

            return $txn->fresh();
        });
    }

    /** Savings withdrawal — always approved first; the money stays held meanwhile. */
    public function requestWithdrawal(MemberAccount $account, array $data): MemberTransaction
    {
        if ($account->kind !== 'savings') {
            throw ValidationException::withMessages(['type' => __('শেয়ার হিসাব থেকে উত্তোলন করা যায় না।')]);
        }
        $this->assertUsable($account, false);
        $fund = $this->fund('savings', $data);
        $this->assertAvailable($account, (float) $data['amount']);

        return DB::transaction(function () use ($account, $data, $fund) {
            $txn = $this->make($account, 'withdrawal', 'out', ['fund_account_id' => $fund->id] + $data, 'pending');

            return $this->submit($txn, __('সঞ্চয় উত্তোলন'));
        });
    }

    /** Opening balance carried over from the paper register. One per account. */
    public function requestOpening(MemberAccount $account, array $data): MemberTransaction
    {
        $this->assertUsable($account, false);
        if ($account->transactions()->where('type', 'opening')->whereIn('status', ['pending', 'posted', 'cancel_pending'])->exists()) {
            throw ValidationException::withMessages(['type' => __('এই হিসাবের প্রারম্ভিক জের আগেই দেওয়া হয়েছে।')]);
        }

        return DB::transaction(function () use ($account, $data) {
            $txn = $this->make($account, 'opening', 'in', $data, 'pending');

            return $this->submit($txn, __('প্রারম্ভিক জের'));
        });
    }

    /** Correction against another ledger account (default: opening balance equity). */
    public function requestAdjustment(MemberAccount $account, string $direction, array $data): MemberTransaction
    {
        $this->assertUsable($account, false);
        $counter = ! empty($data['counter_account_id'])
            ? Account::where('is_postable', true)->where('is_active', true)->find($data['counter_account_id']) : Account::byKey('opening_balance_equity');
        if (! $counter || $counter->id === $account->ledgerAccount()->id) {
            throw ValidationException::withMessages(['counter_account_id' => __('বিপরীত হিসাব সঠিক নয়।')]);
        }
        if ($direction === 'out') {
            $this->assertAvailable($account, (float) $data['amount']);
        }

        return DB::transaction(function () use ($account, $direction, $data, $counter) {
            $txn = $this->make($account, 'adjustment', $direction, ['counter_account_id' => $counter->id] + $data, 'pending');

            return $this->submit($txn, __('সমন্বয়'));
        });
    }

    /** Share transfer between members: two linked legs, no voucher (capital stays the same). */
    public function requestTransfer(MemberAccount $from, Member $to, array $data): MemberTransaction
    {
        if ($from->kind !== 'share') {
            throw ValidationException::withMessages(['type' => __('শুধু শেয়ার হস্তান্তর করা যায়।')]);
        }
        if ($to->id === $from->member_id) {
            throw ValidationException::withMessages(['to_member_id' => __('একই সদস্যের কাছে হস্তান্তর করা যায় না।')]);
        }
        $this->assertUsable($from, false);
        $this->assertAvailable($from, (float) $data['amount']);
        $target = MemberAccount::where('kind', 'share')->where('member_id', $to->id)->first();
        if ($target) {
            $this->assertUsable($target, true);
        }

        return DB::transaction(function () use ($from, $to, $data, $target) {
            $target ??= $this->openAccount($to, 'share', $data['date'], __('হস্তান্তরের মাধ্যমে খোলা'));
            $out = $this->make($from, 'transfer_out', 'out', $data, 'pending');
            $in = $this->make($target, 'transfer_in', 'in', $data + ['pair_id' => $out->id], 'pending');
            $out->update(['pair_id' => $in->id]);

            return $this->submit($out, __('শেয়ার হস্তান্তর'), ['প্রাপক' => $to->farmer?->name_bn.' ('.$target->account_no.')']);
        });
    }

    /** Approval handler (and money-in): pending → posted, voucher booked, balance moved. */
    public function post(MemberTransaction $txn): void
    {
        DB::transaction(function () use ($txn) {
            $txn = MemberTransaction::whereKey($txn->id)->lockForUpdate()->firstOrFail();
            if (! in_array($txn->status, ['pending', 'posted'], true) || $txn->posted_at) {
                return;
            }
            $account = MemberAccount::whereKey($txn->member_account_id)->lockForUpdate()->firstOrFail();
            $amount = (float) $txn->amount;
            if ($txn->direction === 'out' && round((float) $account->balance - $amount, 2) < 0) {
                throw ValidationException::withMessages(['amount' => __('হিসাবে পর্যাপ্ত জমা নেই (বর্তমান জের :amount)।', ['amount' => number_format((float) $account->balance, 2)])]);
            }

            $journal = $this->book($txn, $account);
            $balance = round((float) $account->balance + $txn->signed(), 2);
            $account->update(['balance' => $balance]);
            $txn->update(['status' => 'posted', 'balance_after' => $balance, 'posted_at' => now(), 'journal_id' => $journal?->id]);

            if ($txn->type === 'transfer_out' && $txn->pair_id) {
                $this->post($txn->pair);
            }
        });
    }

    public function reject(MemberTransaction $txn): void
    {
        DB::transaction(function () use ($txn) {
            // a guarded update skips the model events, so the history is logged here
            if (MemberTransaction::whereKey($txn->id)->where('status', 'pending')->update(['status' => 'rejected'])) {
                AuditLogger::log($txn->auditModule(), 'update', $txn, ['status' => 'pending'], ['status' => 'rejected']);
            }
            if ($txn->pair_id && MemberTransaction::whereKey($txn->pair_id)->where('status', 'pending')->update(['status' => 'rejected'])) {
                AuditLogger::log($txn->auditModule(), 'update', MemberTransaction::find($txn->pair_id), ['status' => 'pending'], ['status' => 'rejected']);
            }
        });
    }

    public function requestCancel(MemberTransaction $txn, string $reason): ApprovalRequest
    {
        if ($txn->status !== 'posted' || ! in_array($txn->type, MemberTransaction::CANCELLABLE, true)) {
            throw ValidationException::withMessages(['transaction' => $txn->status === 'cancel_pending'
                ? __('এই লেনদেন বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় আছে।') : __('এই লেনদেন বাতিল করা যায় না।')]);
        }
        CombinedPaymentService::guardPart($txn);
        if ($txn->direction === 'in') {
            $this->assertAvailable($txn->account, (float) $txn->amount, __('এই জমা বাতিল করলে হিসাবের জের ঋণাত্মক হবে।'));
        }

        return DB::transaction(function () use ($txn, $reason) {
            $txn->update(['status' => 'cancel_pending', 'cancel_reason' => $reason]);
            $account = $txn->account;

            return $this->approvals->submit(
                $txn->kind.'.txn_cancel',
                __('লেনদেন বাতিল: :no', ['no' => $txn->txn_no]),
                $txn,
                ['লেনদেন' => $txn->txn_no, 'হিসাব নং' => $account->account_no, 'সদস্য' => $account->member?->farmer?->name_bn,
                    'ধরন' => $txn->typeLabel(), 'পরিমাণ' => (float) $txn->amount, 'কারণ' => $reason],
                null,
                (float) $txn->amount,
            );
        });
    }

    /** Approval handler: reverse the voucher and take the amount back out of the balance. */
    public function cancel(MemberTransaction $txn): void
    {
        DB::transaction(function () use ($txn) {
            $txn = MemberTransaction::whereKey($txn->id)->lockForUpdate()->firstOrFail();
            if ($txn->status === 'cancelled') {
                return;
            }
            $account = MemberAccount::whereKey($txn->member_account_id)->lockForUpdate()->firstOrFail();
            $balance = round((float) $account->balance - $txn->signed(), 2);
            if ($balance < 0) {
                throw ValidationException::withMessages(['amount' => __('এই জমা বাতিল করলে হিসাবের জের ঋণাত্মক হবে।')]);
            }
            if ($txn->journal && $txn->journal->status === 'posted') {
                $this->ledger->reverse($txn->journal, __('লেনদেন বাতিল').($txn->cancel_reason ? ': '.$txn->cancel_reason : ''));
            }
            $account->update(['balance' => $balance]);
            $txn->update(['status' => 'cancelled', 'cancelled_at' => now()]);
        });
    }

    public function keep(MemberTransaction $txn): void
    {
        if (MemberTransaction::whereKey($txn->id)->where('status', 'cancel_pending')->update(['status' => 'posted', 'cancel_reason' => null])) {
            AuditLogger::log($txn->auditModule(), 'update', $txn, ['status' => 'cancel_pending', 'cancel_reason' => $txn->cancel_reason], ['status' => 'posted', 'cancel_reason' => null]);
        }
    }

    // ---- closing an account ----

    /**
     * Close on request: the balance must already be zero (withdrawn, or share
     * transferred) with nothing pending. The account stops taking
     * transactions at once and closes when the manager approves.
     */
    public function requestClose(MemberAccount $account, string $date, string $reason): MemberAccount
    {
        return DB::transaction(function () use ($account, $date, $reason) {
            $account = MemberAccount::whereKey($account->id)->lockForUpdate()->firstOrFail();
            if ($account->status !== 'active') {
                throw ValidationException::withMessages(['account' => $account->status === 'closing'
                    ? __('এই হিসাব বন্ধের আবেদন অনুমোদনের অপেক্ষায় আছে।') : __('হিসাবটি আগেই বন্ধ।')]);
            }
            $this->assertClosable($account);
            $account->update(['status' => 'closing', 'closed_on' => $date, 'close_reason' => $reason, 'close_kind' => 'request']);

            $req = $this->approvals->submit(
                $account->kind.'.account_close',
                __(':kind হিসাব বন্ধ: :name (:no)', ['kind' => __(MemberAccount::KINDS[$account->kind]), 'name' => $account->member?->farmer?->name_bn, 'no' => $account->account_no]),
                $account,
                ['হিসাব নং' => $account->account_no, 'সদস্য' => $account->member?->farmer?->name_bn, 'সদস্য নং' => $account->member?->member_no,
                    'বন্ধের তারিখ' => date('d/m/Y', strtotime($date)), 'জের' => (float) $account->balance, 'কারণ' => $reason],
            );
            $account->refresh();
            // without an approval rule the handler has already closed it
            if ($account->status === 'closing') {
                $account->update(['close_request_id' => $req->id]);
            }

            return $account->fresh();
        });
    }

    /** Approval handler: close it, checking again that nothing has moved meanwhile. */
    public function close(MemberAccount $account): void
    {
        DB::transaction(function () use ($account) {
            $account = MemberAccount::whereKey($account->id)->lockForUpdate()->firstOrFail();
            if ($account->status === 'closed') {
                return;
            }
            $this->assertClosable($account);
            $account->update(['status' => 'closed', 'closed_on' => $account->closed_on ?? now()->toDateString()]);
        });
    }

    /** Approval refused: the account is open again as before. */
    public function keepOpen(MemberAccount $account): void
    {
        MemberAccount::whereKey($account->id)->where('status', 'closing')->first()
            ?->update(['status' => 'active', 'closed_on' => null, 'close_reason' => null, 'close_kind' => null, 'close_request_id' => null]);
    }

    /** A cancelled membership closes the member's accounts (their balances are already zero). */
    public function closeForMembership(Member $member, string $date): void
    {
        foreach (MemberAccount::where('member_id', $member->id)->whereIn('status', ['active', 'closing'])->get() as $account) {
            $this->assertClosable($account);
            $account->update(['status' => 'closed', 'closed_on' => $date, 'close_reason' => __('সদস্যপদ বাতিল'), 'close_kind' => 'membership']);
        }
    }

    /** Reactivating the membership reopens the accounts its cancellation closed. */
    public function reopenForMembership(Member $member): void
    {
        foreach (MemberAccount::where('member_id', $member->id)->where('status', 'closed')->where('close_kind', 'membership')->get() as $account) {
            $account->update(['status' => 'active', 'closed_on' => null, 'close_reason' => null, 'close_kind' => null]);
        }
    }

    private function assertClosable(MemberAccount $account): void
    {
        if (round((float) $account->balance, 2) !== 0.0) {
            throw ValidationException::withMessages(['account' => __('হিসাবের জের :amount টাকা — আগে জের শূন্য করুন (সঞ্চয় উত্তোলন / শেয়ার হস্তান্তর)।', ['amount' => number_format((float) $account->balance, 2)])]);
        }
        if ($account->transactions()->whereIn('status', ['pending', 'cancel_pending'])->exists()) {
            throw ValidationException::withMessages(['account' => __('এই হিসাবে অনুমোদনের অপেক্ষায় লেনদেন আছে — আগে সেগুলোর নিষ্পত্তি করুন।')]);
        }
    }

    // ---- profit & dividend ----

    /**
     * Dividend split in proportion to each member's share balance on the
     * basis date. Paisa left over by rounding go to the largest remainders
     * so the rows always add up to the pool exactly.
     *
     * @return array<int, array{member_id:int, basis:float, amount:float}>
     */
    public function dividendShares(string $basisDate, float $pool): array
    {
        $rows = DB::table('member_transactions')->join('member_accounts', 'member_accounts.id', '=', 'member_transactions.member_account_id')
            ->where('member_transactions.kind', 'share')->whereIn('member_transactions.status', ['posted', 'cancel_pending'])
            ->where('member_transactions.date', '<=', $basisDate)
            ->groupBy('member_accounts.member_id')
            ->selectRaw("member_accounts.member_id, SUM(CASE WHEN member_transactions.direction = 'in' THEN member_transactions.amount ELSE -member_transactions.amount END) AS basis")
            ->havingRaw("SUM(CASE WHEN member_transactions.direction = 'in' THEN member_transactions.amount ELSE -member_transactions.amount END) > 0")
            ->orderBy('member_accounts.member_id')->get();
        $total = round((float) $rows->sum('basis'), 2);
        if ($total <= 0 || $pool <= 0) {
            return [];
        }
        $poolPaisa = (int) round($pool * 100);
        $out = [];
        $given = 0;
        foreach ($rows as $r) {
            $exact = $poolPaisa * (float) $r->basis / $total;
            $paisa = (int) floor($exact + 1e-9);
            $given += $paisa;
            $out[] = ['member_id' => (int) $r->member_id, 'basis' => round((float) $r->basis, 2), 'paisa' => $paisa, 'rem' => $exact - $paisa];
        }
        $order = array_keys($out);
        usort($order, fn ($a, $b) => $out[$b]['rem'] <=> $out[$a]['rem'] ?: $a <=> $b);
        for ($i = 0, $left = $poolPaisa - $given; $left > 0; $i++, $left--) {
            $out[$order[$i % count($order)]]['paisa']++;
        }

        return array_map(fn ($r) => ['member_id' => $r['member_id'], 'basis' => $r['basis'], 'amount' => $r['paisa'] / 100], $out);
    }

    /**
     * @param  array<int, array{member_id:int, basis?:float, amount:float}>  $items
     */
    public function createRun(string $kind, array $data, array $items): DistributionRun
    {
        $items = array_values(array_filter($items, fn ($i) => round((float) $i['amount'], 2) > 0));
        if (! $items) {
            throw ValidationException::withMessages(['items' => __('কমপক্ষে একজন সদস্যের জন্য টাকার পরিমাণ দিন।')]);
        }
        if (count(array_unique(array_column($items, 'member_id'))) !== count($items)) {
            throw ValidationException::withMessages(['items' => __('একই সদস্য একাধিকবার দেওয়া হয়েছে।')]);
        }
        if ($kind === 'profit') {
            $known = MemberAccount::where('kind', 'savings')->whereIn('member_id', array_column($items, 'member_id'))->count();
            if ($known !== count($items)) {
                throw ValidationException::withMessages(['items' => __('মুনাফা শুধু সঞ্চয় হিসাবধারী সদস্যদের দেওয়া যায়।')]);
            }
        }
        $this->ledger->openPeriodFor($data['date']);

        return DB::transaction(function () use ($kind, $data, $items) {
            $total = round(array_sum(array_map(fn ($i) => round((float) $i['amount'], 2), $items)), 2);
            $run = DistributionRun::create([
                'run_no' => SequenceService::next('distribution_run'), 'kind' => $kind, 'title' => $data['title'], 'date' => $data['date'],
                'basis_date' => $data['basis_date'] ?? null, 'pool_amount' => $data['pool_amount'] ?? null, 'total_amount' => $total,
                'status' => 'pending', 'remarks' => $data['remarks'] ?? null, 'created_by' => auth()->id(),
            ]);
            foreach ($items as $i) {
                $run->items()->create(['member_id' => $i['member_id'], 'basis' => $i['basis'] ?? 0, 'amount' => round((float) $i['amount'], 2)]);
            }
            $req = $this->approvals->submit(
                $kind === 'profit' ? 'savings.profit' : 'share.dividend',
                __(DistributionRun::KINDS[$kind]).': '.$run->title,
                $run,
                ['বণ্টন নং' => $run->run_no, 'শিরোনাম' => $run->title, 'তারিখ' => $run->date->format('d/m/Y'),
                    'সদস্য সংখ্যা' => count($items), 'মোট' => $total],
                null,
                $total,
            );
            if ($run->fresh()->status === 'pending') {
                $run->update(['approval_request_id' => $req->id]);
            }

            return $run->fresh();
        });
    }

    /** Approval handler: credit every member's savings and book one voucher. */
    public function postRun(DistributionRun $run): void
    {
        DB::transaction(function () use ($run) {
            $run = DistributionRun::whereKey($run->id)->lockForUpdate()->firstOrFail();
            if ($run->status !== 'pending') {
                return;
            }
            $debitKey = $run->kind === 'profit' ? 'savings_profit_expense' : 'dividend_distribution';
            $journal = $this->ledger->postNow('journal', $run->date->toDateString(),
                __(DistributionRun::KINDS[$run->kind]).': '.$run->title.' ('.$run->run_no.')',
                [['account_id' => Account::byKey($debitKey)->id, 'debit' => (float) $run->total_amount],
                    ['account_id' => Account::byKey('savings_deposits')->id, 'credit' => (float) $run->total_amount]],
                'savings', $run);

            foreach ($run->items()->with('member')->get() as $item) {
                $account = MemberAccount::where('kind', 'savings')->where('member_id', $item->member_id)->lockForUpdate()->first()
                    ?? MemberAccount::create([
                        'kind' => 'savings', 'member_id' => $item->member_id, 'account_no' => SequenceService::next('savings_account'),
                        'opened_on' => $run->date, 'status' => 'active', 'balance' => 0, 'remarks' => __('লভ্যাংশ জমার জন্য খোলা'), 'created_by' => auth()->id(),
                    ]);
                $balance = round((float) $account->balance + (float) $item->amount, 2);
                $txn = MemberTransaction::create([
                    'txn_no' => SequenceService::next('savings_txn'), 'member_account_id' => $account->id, 'kind' => 'savings',
                    'date' => $run->date, 'type' => $run->kind, 'direction' => 'in', 'amount' => $item->amount, 'balance_after' => $balance,
                    'status' => 'posted', 'remarks' => $run->title, 'run_id' => $run->id, 'journal_id' => $journal->id,
                    'created_by' => $run->created_by, 'posted_at' => now(),
                ]);
                $account->update(['balance' => $balance]);
                $item->update(['transaction_id' => $txn->id]);
            }
            $run->update(['status' => 'posted', 'journal_id' => $journal->id, 'posted_at' => now()]);
        });
    }

    public function rejectRun(DistributionRun $run): void
    {
        DistributionRun::whereKey($run->id)->where('status', 'pending')->update(['status' => 'rejected']);
    }

    // ---- internals ----

    private function make(MemberAccount $account, string $type, string $direction, array $data, string $status = 'posted'): MemberTransaction
    {
        $amount = round((float) $data['amount'], 2);
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => __('টাকার পরিমাণ শূন্যের বেশি হতে হবে।')]);
        }
        $this->ledger->openPeriodFor($data['date']);

        return MemberTransaction::create([
            'txn_no' => SequenceService::next(MemberAccount::CONFIG[$account->kind]['txn_seq']),
            'member_account_id' => $account->id, 'kind' => $account->kind, 'date' => $data['date'], 'type' => $type,
            'direction' => $direction, 'amount' => $amount, 'status' => $status,
            'method' => in_array($type, ['deposit', 'purchase', 'withdrawal'], true) ? $data['method'] : null,
            'fund_account_id' => $data['fund_account_id'] ?? null, 'counter_account_id' => $data['counter_account_id'] ?? null,
            'reference' => $data['reference'] ?? null, 'remarks' => $data['remarks'] ?? null, 'pair_id' => $data['pair_id'] ?? null,
            'created_by' => auth()->id(),
        ]);
    }

    private function submit(MemberTransaction $txn, string $label, array $extra = []): MemberTransaction
    {
        $account = $txn->account;
        $req = $this->approvals->submit(
            $txn->kind.'.'.($txn->type === 'transfer_out' ? 'transfer' : $txn->type),
            $label.': '.$account->member?->farmer?->name_bn.' ('.$account->account_no.')',
            $txn,
            ['লেনদেন' => $txn->txn_no, 'হিসাব নং' => $account->account_no, 'সদস্য' => $account->member?->farmer?->name_bn,
                'তারিখ' => $txn->date->format('d/m/Y'), 'ধরন' => $txn->typeLabel(),
                'দিক' => __(MemberTransaction::DIRECTIONS[$txn->direction]), 'পরিমাণ' => (float) $txn->amount] + $extra
                + ($txn->remarks ? ['মন্তব্য' => $txn->remarks] : []),
            null,
            (float) $txn->amount,
        );
        $txn->refresh();
        if ($txn->status === 'pending') {
            $txn->update(['approval_request_id' => $req->id]);
        }

        return $txn->fresh();
    }

    private function book(MemberTransaction $txn, MemberAccount $account): ?Journal
    {
        if (in_array($txn->type, ['transfer_in', 'transfer_out'], true)) {
            return null;
        }
        $ledger = $account->ledgerAccount()->id;
        $other = match ($txn->type) {
            'deposit', 'purchase', 'withdrawal' => $txn->fund_account_id,
            'opening' => Account::byKey('opening_balance_equity')->id,
            default => $txn->counter_account_id,
        };
        $amount = (float) $txn->amount;
        $lines = $txn->direction === 'in'
            ? [['account_id' => $other, 'debit' => $amount, 'remarks' => $txn->reference], ['account_id' => $ledger, 'credit' => $amount]]
            : [['account_id' => $ledger, 'debit' => $amount], ['account_id' => $other, 'credit' => $amount, 'remarks' => $txn->reference]];
        $type = match ($txn->type) {
            'deposit', 'purchase' => 'receipt',
            'withdrawal' => 'payment',
            default => 'journal',
        };
        $name = $account->member?->farmer?->name_bn;

        return $this->ledger->postNow($type, $txn->date->toDateString(),
            $txn->typeLabel().' '.$txn->txn_no.' — '.$name.' ('.$account->account_no.')', $lines, $account->kind, $txn);
    }

    private function fund(string $kind, array $data): Account
    {
        if (($data['method'] ?? 'cash') !== 'cash' && empty($data['reference'])) {
            throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
        }

        return $this->receipts->fund($kind, $data['method'] ?? 'cash', $data['fund_account_id'] ?? null);
    }

    private function assertUsable(MemberAccount $account, bool $needsActiveMember): void
    {
        if ($account->status !== 'active') {
            throw ValidationException::withMessages(['account' => $account->status === 'closing'
                ? __('হিসাব বন্ধের আবেদন অনুমোদনের অপেক্ষায় — এখন লেনদেন করা যাবে না।') : __('হিসাবটি বন্ধ।')]);
        }
        if ($needsActiveMember && $account->member?->status !== Member::ACTIVE) {
            throw ValidationException::withMessages(['account' => __('শুধু সক্রিয় সদস্যের হিসাবে জমা নেওয়া যায়।')]);
        }
    }

    private function assertAvailable(MemberAccount $account, float $amount, ?string $message = null): void
    {
        $available = $account->available();
        if (round($amount, 2) > $available) {
            throw ValidationException::withMessages(['amount' => $message
                ?? __('উত্তোলনযোগ্য জের :amount টাকা (অনুমোদনের অপেক্ষায় থাকা উত্তোলন বাদে)।', ['amount' => number_format($available, 2)])]);
        }
    }
}
