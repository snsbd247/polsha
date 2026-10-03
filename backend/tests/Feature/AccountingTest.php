<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountingPeriod;
use App\Models\ApprovalRequest;
use App\Models\Farmer;
use App\Models\Journal;
use App\Models\MemberAccount;
use App\Models\User;
use App\Services\SettingService;

class AccountingTest extends Phase2TestCase
{
    private User $accountant;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->accountant = $this->userWithRole('accountant');
        $this->cashier = $this->userWithRole('cashier');
    }

    private function id(string $key): int
    {
        return Account::byKey($key)->id;
    }

    private function approve(User $user, int $requestId): void
    {
        $this->actingAs($user)->postJson("/api/approvals/{$requestId}/decide", ['decision' => 'approve'])->assertOk();
    }

    private function openingCash(float $amount, string $stream = 'cash_society'): Journal
    {
        $r = $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'opening', 'date' => now()->toDateString(), 'narration' => 'প্রারম্ভিক',
            'lines' => [['account_id' => $this->id($stream), 'debit' => $amount]],
        ])->assertCreated();
        $journal = Journal::find($r->json('id'));
        $this->approve($this->manager, $journal->approval_request_id);

        return $journal->fresh();
    }

    public function test_simple_expense_entry_goes_for_approval_as_a_payment_voucher(): void
    {
        $this->openingCash(5000);
        $r = $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'payment', 'date' => now()->toDateString(), 'narration' => 'খরচ — অফিস খরচ',
            'lines' => [['account_id' => $this->id('office_expense'), 'debit' => 700], ['account_id' => $this->id('cash_society'), 'credit' => 700]],
        ])->assertCreated()->assertJsonPath('status', 'pending');
        $journal = Journal::find($r->json('id'));
        $this->assertSame('payment', $journal->voucher_type);
        $this->approve($this->manager, $journal->approval_request_id);
        $this->assertSame('posted', $journal->fresh()->status);
        $this->assertEquals(4300, app(\App\Services\LedgerService::class)->balance($this->id('cash_society')));
        // anything else is still refused
        $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'salary', 'date' => now()->toDateString(), 'lines' => [['account_id' => $this->id('office_expense'), 'debit' => 1]],
        ])->assertStatus(422);
    }

    public function test_seeded_chart_and_cash_streams_exist(): void
    {
        foreach (['cash_irrigation', 'cash_society', 'cash_misc', 'admission_fee_income', 'opening_balance_equity', 'bank_group'] as $key) {
            $this->assertNotNull(Account::where('key', $key)->first(), $key);
        }
        $this->actingAs($this->accountant)->getJson('/api/accounts')->assertOk()->assertJsonPath('types.asset', 'সম্পদ');
    }

    public function test_voucher_list_counts_pending_and_posted(): void
    {
        $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'opening', 'date' => now()->toDateString(), 'narration' => 'প্রারম্ভিক',
            'lines' => [['account_id' => $this->id('cash_society'), 'debit' => 500]],
        ])->assertCreated();
        $this->actingAs($this->accountant)->getJson('/api/journals')->assertOk()
            ->assertJsonPath('counts.pending', 1)->assertJsonPath('counts.month', 0);
        $this->openingCash(700);
        $this->actingAs($this->accountant)->getJson('/api/journals')
            ->assertJsonPath('counts.total', 2)->assertJsonPath('counts.month', 1)->assertJsonPath('counts.month_amount', 700);
    }

    public function test_opening_balance_is_pending_until_manager_approves_and_auto_balances(): void
    {
        $r = $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'opening', 'date' => now()->toDateString(),
            'lines' => [['account_id' => $this->id('cash_society'), 'debit' => 5000]],
        ])->assertCreated()->assertJsonPath('status', 'pending');
        $journal = Journal::with('lines')->find($r->json('id'));
        $this->assertCount(2, $journal->lines); // balancing line to Opening Balance Equity
        $this->assertStringStartsWith('JV-', $journal->voucher_no);

        $this->actingAs($this->accountant)->getJson('/api/funds')->assertOk()->assertJsonPath('1.closing', 0);

        $this->approve($this->manager, $journal->approval_request_id);
        $this->assertSame('posted', $journal->fresh()->status);
        $bal = collect($this->actingAs($this->accountant)->getJson('/api/funds')->json())->firstWhere('key', 'cash_society');
        $this->assertEquals(5000, $bal['closing']);
    }

    public function test_unbalanced_journal_is_rejected(): void
    {
        $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'journal', 'date' => now()->toDateString(),
            'lines' => [
                ['account_id' => $this->id('office_expense'), 'debit' => 100],
                ['account_id' => $this->id('accounts_payable'), 'credit' => 90],
            ],
        ])->assertStatus(422)->assertJsonValidationErrors('lines');

        // Group headers can't be posted to.
        $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'journal', 'date' => now()->toDateString(),
            'lines' => [
                ['account_id' => $this->id('cash_in_hand'), 'debit' => 100],
                ['account_id' => $this->id('accounts_payable'), 'credit' => 100],
            ],
        ])->assertStatus(422);
    }

    public function test_cash_receipt_payment_and_overdraft_guard(): void
    {
        $this->actingAs($this->cashier)->postJson('/api/funds/receipt', [
            'fund_account_id' => $this->id('cash_irrigation'), 'counter_account_id' => $this->id('other_income'),
            'amount' => 1000, 'date' => now()->toDateString(),
        ])->assertCreated()->assertJsonPath('status', 'posted');

        $this->actingAs($this->cashier)->postJson('/api/funds/payment', [
            'fund_account_id' => $this->id('cash_irrigation'), 'counter_account_id' => $this->id('office_expense'),
            'amount' => 1500, 'date' => now()->toDateString(),
        ])->assertStatus(422)->assertJsonValidationErrors('amount');

        $this->actingAs($this->cashier)->postJson('/api/funds/payment', [
            'fund_account_id' => $this->id('cash_irrigation'), 'counter_account_id' => $this->id('office_expense'),
            'amount' => 400, 'date' => now()->toDateString(),
        ])->assertCreated();

        // Streams stay separate: society cash untouched.
        $funds = collect($this->actingAs($this->cashier)->getJson('/api/funds')->json())->keyBy('key');
        $this->assertEquals(600, $funds['cash_irrigation']['closing']);
        $this->assertEquals(0, $funds['cash_society']['closing']);

        // Chart of accounts rolls posted balances in once vouchers exist.
        $chart = collect($this->actingAs($this->accountant)->getJson('/api/accounts')->assertOk()->json('data'))->keyBy('key');
        $this->assertEquals(600, $chart['cash_irrigation']['balance']);
        $this->assertEquals(1000, $chart['other_income']['balance']);

        // A fund can't be the counter account of a receipt — that's a transfer.
        $this->actingAs($this->cashier)->postJson('/api/funds/receipt', [
            'fund_account_id' => $this->id('cash_irrigation'), 'counter_account_id' => $this->id('cash_misc'),
            'amount' => 10, 'date' => now()->toDateString(),
        ])->assertStatus(422);
    }

    public function test_bank_account_deposit_withdraw_and_cashier_cannot_touch_bank(): void
    {
        $this->openingCash(10000);
        $bank = $this->actingAs($this->manager)->postJson('/api/bank-accounts', [
            'bank_name' => 'সোনালী ব্যাংক', 'branch_name' => 'সাভার', 'account_no' => '0012345', 'account_type' => 'current',
        ])->assertCreated()->json();
        $this->assertSame('1201', $bank['account']['code']);

        $this->actingAs($this->cashier)->postJson('/api/funds/transfer', [
            'fund_account_id' => $this->id('cash_society'), 'to_account_id' => $bank['account_id'], 'amount' => 3000, 'date' => now()->toDateString(),
        ])->assertForbidden();

        $this->actingAs($this->manager)->postJson('/api/funds/transfer', [
            'fund_account_id' => $this->id('cash_society'), 'to_account_id' => $bank['account_id'], 'amount' => 3000, 'date' => now()->toDateString(),
        ])->assertCreated()->assertJsonPath('voucher_type', 'contra');

        $st = $this->actingAs($this->manager)->getJson("/api/bank-accounts/{$bank['id']}/statement")->assertOk();
        $this->assertEquals(3000, $st->json('closing'));
        $lineId = $st->json('rows.0.line_id');
        $this->actingAs($this->manager)->postJson("/api/bank-accounts/{$bank['id']}/lines/{$lineId}/reconcile", ['reconciled' => true])->assertOk();
        $this->assertEquals(0, $this->actingAs($this->manager)->getJson("/api/bank-accounts/{$bank['id']}/statement")->json('unreconciled.n'));
    }

    public function test_trial_balance_balances_and_ledger_runs(): void
    {
        $this->openingCash(8000);
        $this->actingAs($this->cashier)->postJson('/api/funds/payment', [
            'fund_account_id' => $this->id('cash_society'), 'counter_account_id' => $this->id('office_expense'),
            'amount' => 500, 'date' => now()->toDateString(),
        ])->assertCreated();

        $tb = $this->actingAs($this->accountant)->getJson('/api/accounting/trial-balance')->assertOk();
        $this->assertTrue($tb->json('balanced'));
        $this->assertEquals(8000, $tb->json('total_debit')); // cash 7500 + expense 500 = OBE 8000

        $ledger = $this->actingAs($this->accountant)->getJson('/api/accounting/ledger?'.http_build_query([
            'account_id' => $this->id('cash_society'), 'from' => now()->startOfMonth()->toDateString(), 'to' => now()->toDateString(),
        ]))->assertOk();
        $this->assertEquals(7500, $ledger->json('closing'));
        $this->assertCount(2, $ledger->json('rows'));
    }

    public function test_reversal_needs_approval_and_cancels_the_voucher(): void
    {
        $opening = $this->openingCash(2000);
        $r = $this->actingAs($this->accountant)->postJson("/api/journals/{$opening->id}/reverse", ['reason' => 'ভুল এন্ট্রি'])->assertCreated();
        $this->assertSame('posted', $opening->fresh()->status);

        $this->actingAs($this->accountant)->postJson("/api/journals/{$opening->id}/reverse", ['reason' => 'আবার'])->assertStatus(422);

        $this->approve($this->manager, $r->json('id'));
        $opening->refresh();
        $this->assertSame('reversed', $opening->status);
        $this->assertNotNull($opening->reversed_by_id);
        $bal = collect($this->actingAs($this->accountant)->getJson('/api/funds')->json())->firstWhere('key', 'cash_society');
        $this->assertEquals(0, $bal['closing']);
    }

    public function test_returned_journal_can_be_corrected_and_resubmitted(): void
    {
        $r = $this->actingAs($this->accountant)->postJson('/api/journals', [
            'voucher_type' => 'journal', 'date' => now()->toDateString(),
            'lines' => [
                ['account_id' => $this->id('office_expense'), 'debit' => 100],
                ['account_id' => $this->id('accounts_payable'), 'credit' => 100],
            ],
        ])->assertCreated();
        $journal = Journal::find($r->json('id'));
        $this->actingAs($this->manager)->postJson("/api/approvals/{$journal->approval_request_id}/decide", ['decision' => 'return', 'remarks' => 'টাকা ঠিক করুন'])->assertOk();
        $this->assertSame('returned', $journal->fresh()->status);

        $this->actingAs($this->accountant)->putJson("/api/journals/{$journal->id}", [
            'voucher_type' => 'journal', 'date' => now()->toDateString(),
            'lines' => [
                ['account_id' => $this->id('office_expense'), 'debit' => 150],
                ['account_id' => $this->id('accounts_payable'), 'credit' => 150],
            ],
        ])->assertOk()->assertJsonPath('status', 'pending');
        $journal->refresh();
        $this->approve($this->manager, $journal->approval_request_id);
        $this->assertSame('posted', $journal->fresh()->status);
        $this->assertEquals(150, $journal->fresh()->amount);
    }

    public function test_closed_period_blocks_entries(): void
    {
        $this->actingAs($this->cashier)->postJson('/api/funds/receipt', [
            'fund_account_id' => $this->id('cash_misc'), 'counter_account_id' => $this->id('other_income'),
            'amount' => 100, 'date' => now()->subMonthNoOverflow()->toDateString(),
        ])->assertCreated();
        $period = AccountingPeriod::where('period_key', now()->subMonthNoOverflow()->format('Y-m'))->first();

        $this->actingAs($this->accountant)->postJson("/api/accounting/periods/{$period->id}/close")->assertForbidden();
        $this->actingAs($this->manager)->postJson("/api/accounting/periods/{$period->id}/close")->assertOk();

        $this->actingAs($this->cashier)->postJson('/api/funds/receipt', [
            'fund_account_id' => $this->id('cash_misc'), 'counter_account_id' => $this->id('other_income'),
            'amount' => 100, 'date' => now()->subMonthNoOverflow()->toDateString(),
        ])->assertStatus(422)->assertJsonValidationErrors('date');

        $this->actingAs($this->manager)->postJson("/api/accounting/periods/{$period->id}/reopen", ['reason' => 'সংশোধন'])->assertOk();
        $this->assertSame('open', $period->fresh()->status);
    }

    public function test_admission_fee_is_posted_when_member_is_admitted(): void
    {
        SettingService::setMany(['admission_fee' => 500]);
        $res = $this->actingAs($this->officer)->postJson('/api/membership-applications',
            $this->applicationPayload($this->makeFarmer(), ['admission_fee' => 500, 'submit' => true]))->assertCreated();
        $this->approveBothSteps(ApprovalRequest::findOrFail($res->json('approval_request_id'))->id);

        $journal = Journal::where('module', 'membership')->first();
        $this->assertNotNull($journal);
        $this->assertEquals(500, $journal->amount);
        $this->artisan('accounting:post-admission-fees')->expectsOutput('Posted 0, skipped 1.')->assertSuccessful();
    }

    public function test_paid_application_brings_its_first_shares_in_on_approval(): void
    {
        SettingService::setMany(['share_unit_price' => 10]);
        $shareOf = fn (Farmer $f) => MemberAccount::where('kind', 'share')->whereHas('member', fn ($m) => $m->where('farmer_id', $f->id))->firstOrFail();

        $farmer = $this->makeFarmer();
        $res = $this->actingAs($this->officer)->postJson('/api/membership-applications',
            $this->applicationPayload($farmer, ['initial_shares' => 12, 'submit' => true]))->assertCreated();
        $this->approveBothSteps(ApprovalRequest::findOrFail($res->json('approval_request_id'))->id);
        $this->assertEquals(120, (float) $shareOf($farmer)->balance);
        // the application shows both payments for its receipt
        $this->actingAs($this->officer)->getJson('/api/membership-applications/'.$res->json('id'))->assertOk()
            ->assertJsonPath('paid.share_txn.amount', '120.00');

        // a fee still due brings no shares in
        $other = $this->makeFarmer();
        $res = $this->actingAs($this->officer)->postJson('/api/membership-applications',
            $this->applicationPayload($other, ['initial_shares' => 5, 'fee_status' => 'due', 'submit' => true]))->assertCreated();
        $this->approveBothSteps(ApprovalRequest::findOrFail($res->json('approval_request_id'))->id);
        $this->assertEquals(0, (float) $shareOf($other)->balance);
    }
}
