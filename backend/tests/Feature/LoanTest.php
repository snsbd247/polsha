<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Loan;
use App\Models\LoanPayment;
use App\Models\LoanProduct;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\LoanService;
use App\Services\SettingService;
use Illuminate\Support\Carbon;

class LoanTest extends Phase2TestCase
{
    private User $loanOfficer;

    private User $cashier;

    private int $memberNo = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-06-30 10:00:00');
        $this->loanOfficer = $this->userWithRole('loan_officer');
        $this->cashier = $this->userWithRole('cashier');
        app(LedgerService::class)->postNow('opening', '2025-12-01', 'প্রারম্ভিক নগদ', [
            ['account_id' => Account::byKey('cash_society')->id, 'debit' => 50000],
            ['account_id' => Account::byKey('opening_balance_equity')->id, 'credit' => 50000],
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function member(string $name, float $savings = 0): Member
    {
        $m = Member::create([
            'farmer_id' => $this->makeFarmer(['name_bn' => $name])->id, 'member_no' => ++$this->memberNo,
            'admitted_on' => '2020-01-01', 'status' => Member::ACTIVE,
        ]);
        if ($savings > 0) {
            MemberAccount::create(['kind' => 'savings', 'member_id' => $m->id, 'account_no' => 'SAV-T'.$m->id, 'opened_on' => '2020-01-01', 'balance' => $savings]);
        }

        return $m;
    }

    private function product(array $overrides = []): LoanProduct
    {
        $r = $this->actingAs($this->manager)->postJson('/api/loan-products', $overrides + [
            'code' => 'AG-1', 'name_bn' => 'কৃষি ঋণ', 'category' => 'agriculture', 'max_amount' => 50000, 'savings_multiplier' => 3,
            'interest_rate' => 12, 'interest_method' => 'flat', 'frequency' => 'monthly', 'installments' => 12,
            'penalty_type' => 'percent', 'penalty_rate' => 3, 'grace_days' => 5, 'guarantors_required' => 1, 'is_active' => true,
        ])->assertCreated();

        return LoanProduct::findOrFail($r->json('id'));
    }

    private function ledger(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    private function approve(?int $requestId): void
    {
        $this->assertNotNull($requestId);
        $this->actingAs($this->manager)->postJson("/api/approvals/{$requestId}/decide", ['decision' => 'approve'])->assertOk();
    }

    private function pay(Loan $loan, string $date, float $amount, ?User $as = null): LoanPayment
    {
        $r = $this->actingAs($as ?? $this->cashier)->postJson("/api/loans/{$loan->id}/payments", [
            'date' => $date, 'amount' => $amount, 'method' => 'cash', 'fund_account_id' => null,
        ])->assertCreated();

        return LoanPayment::findOrFail($r->json('id'));
    }

    public function test_flat_and_declining_schedules_split_principal_and_interest(): void
    {
        $svc = app(LoanService::class);
        $flat = $svc->buildSchedule(['interest_rate' => 12, 'interest_method' => 'flat', 'frequency' => 'monthly', 'installments' => 12], 12000, '2026-02-01');
        $this->assertCount(12, $flat);
        $this->assertEquals(1000, $flat[0]['principal']);
        $this->assertEquals(120, $flat[0]['interest']);
        $this->assertSame('2026-12-01', $flat[10]['due_date']);
        $this->assertEquals(1440, array_sum(array_column($flat, 'interest')));

        $dec = $svc->buildSchedule(['interest_rate' => 12, 'interest_method' => 'declining', 'frequency' => 'monthly', 'installments' => 12], 12000, '2026-02-01');
        $this->assertEquals(120, $dec[0]['interest']); // 1% of the full balance
        $this->assertLessThan($dec[0]['interest'], $dec[11]['interest']);
        $this->assertEquals(12000, round(array_sum(array_column($dec, 'principal')), 2));
        $this->assertEqualsWithDelta($dec[0]['principal'] + $dec[0]['interest'], $dec[5]['principal'] + $dec[5]['interest'], 0.02); // equal instalments

        $weekly = $svc->buildSchedule(['interest_rate' => 10, 'interest_method' => 'flat', 'frequency' => 'weekly', 'installments' => 4], 1000, '2026-01-08');
        $this->assertSame('2026-01-29', $weekly[3]['due_date']);
        $quarterly = $svc->buildSchedule(['interest_rate' => 10, 'interest_method' => 'flat', 'frequency' => 'quarterly', 'installments' => 4], 4000, '2026-03-31');
        $this->assertSame('2026-06-30', $quarterly[1]['due_date']);
        $this->assertEquals(400, array_sum(array_column($quarterly, 'interest'))); // one year
        $once = $svc->buildSchedule(['interest_rate' => 12, 'interest_method' => 'flat', 'frequency' => 'one_time', 'installments' => 1, 'term_months' => 6], 10000, '2026-07-01');
        $this->assertCount(1, $once);
        $this->assertEquals(600, $once[0]['interest']);
    }

    public function test_application_checks_limit_one_loan_and_guarantors(): void
    {
        $p = $this->product();
        $borrower = $this->member('করিম', 5000);
        $g1 = $this->member('রহিম');
        $g2 = $this->member('সেলিম');
        $apply = fn (Member $m, float $amount, array $gs, int $status = 201) => $this->actingAs($this->loanOfficer)->postJson('/api/loans', [
            'member_id' => $m->id, 'product_id' => $p->id, 'applied_on' => '2026-06-01', 'amount' => $amount,
            'guarantors' => array_map(fn ($g) => ['member_id' => $g->id], $gs),
        ])->assertStatus($status);

        // limit = min(50000, 3 × 5000)
        $this->actingAs($this->loanOfficer)->getJson("/api/loans/eligibility?member_id={$borrower->id}&product_id={$p->id}")->assertOk()->assertJsonPath('limit', 15000);
        $apply($borrower, 15001, [$g1], 422)->assertJsonValidationErrors('amount');
        $apply($borrower, 10000, [], 422)->assertJsonValidationErrors('guarantors');
        $apply($borrower, 10000, [$borrower], 422)->assertJsonValidationErrors('guarantors.0.member_id');
        $this->actingAs($this->cashier)->postJson('/api/loans', [])->assertForbidden();

        $loan = Loan::findOrFail($apply($borrower, 10000, [$g1])->json('id'));
        $this->assertSame('pending', $loan->status);
        $apply($borrower, 1000, [$g2], 422)->assertJsonValidationErrors('member_id'); // one running loan

        SettingService::setMany(['loan_max_guarantees' => 1]);
        $other = $this->member('জলিল', 5000);
        $apply($other, 1000, [$g1], 422)->assertJsonValidationErrors('guarantors.0.member_id');
        $apply($other, 1000, [$g2]);

        // the requester cannot approve; the manager can
        $this->actingAs($this->loanOfficer)->postJson("/api/approvals/{$loan->approval_request_id}/decide", ['decision' => 'approve'])->assertStatus(422);
        $this->approve($loan->approval_request_id);
        $this->assertSame('approved', $loan->fresh()->status);

        // membership cannot be cancelled while the loan is open
        $this->actingAs($this->officer)->postJson("/api/members/{$borrower->id}/status", [
            'action' => 'cancel', 'effective_date' => '2026-06-30', 'reason_type' => 'death', 'reason' => 'মৃত্যু', 'resolution_no' => 'সভা-১',
        ])->assertStatus(422)->assertJsonValidationErrors('action');
    }

    public function test_disbursement_to_last_instalment_with_penalty_and_cancellation(): void
    {
        $p = $this->product();
        $m = $this->member('করিম', 5000);
        $r = $this->actingAs($this->loanOfficer)->postJson('/api/loans', [
            'member_id' => $m->id, 'product_id' => $p->id, 'applied_on' => '2025-12-20', 'amount' => 12000,
            'guarantors' => [['member_id' => $this->member('রহিম')->id]],
        ])->assertCreated();
        $loan = Loan::findOrFail($r->json('id'));
        $this->assertStringStartsWith('LN-', $loan->loan_no);
        $this->approve($loan->approval_request_id);

        $cash = $this->ledger('cash_society');
        $this->actingAs($this->loanOfficer)->postJson("/api/loans/{$loan->id}/disburse", ['date' => '2026-01-01', 'method' => 'cash', 'fund_account_id' => null])->assertOk();
        $loan->refresh();
        $this->assertSame('active', $loan->status);
        $this->assertSame('2026-02-01', $loan->first_due_on->toDateString());
        $this->assertCount(12, $loan->schedule);
        $this->assertEquals(1440, $loan->total_interest);
        $this->assertEquals(12000, $this->ledger('loans_receivable'));
        $this->assertEquals($cash - 12000, $this->ledger('cash_society'));

        // the list cards: one running loan, all of it still owed, instalments already past due (dates are in the past)
        $s = $this->actingAs($this->loanOfficer)->getJson('/api/loans/summary')->assertOk();
        $this->assertSame(1, $s->json('counts.active'));
        $this->assertEquals(12000, $s->json('disbursed'));
        $this->assertEquals(12000, $s->json('outstanding'));
        $this->assertSame(1, $s->json('overdue_loans'));
        $this->assertGreaterThan(0, $s->json('overdue_amount'));

        // on time: interest then principal, no penalty
        $p1 = $this->pay($loan, '2026-02-01', 1120);
        $this->assertEquals([0, 120, 1000], [(float) $p1->penalty, (float) $p1->interest, (float) $p1->principal]);

        // late: #2 due 03-01 and #3 due 04-01, grace 5 days, 3% of the late instalment, once each
        // #2: 1120 × 3% = 33.60, #3: 1120 × 3% = 33.60
        $pos = app(LoanService::class)->position($loan->fresh(), '2026-04-11');
        $this->assertEquals(67.20, $pos['penalty_due']);
        $this->assertSame('31_90', $pos['bucket']); // 41 days since 03-01
        // the same penalty however long it stays late
        $this->assertEquals(67.20, app(LoanService::class)->position($loan->fresh(), '2026-04-30')['penalty_due']);
        $p2 = $this->pay($loan, '2026-04-11', 1000);
        $this->assertEquals([67.20, 240, 692.80], [(float) $p2->penalty, (float) $p2->interest, (float) $p2->principal]);
        $this->assertEquals(-67.20, $this->ledger('loan_penalty_income'));
        $this->assertEquals(-360, $this->ledger('loan_interest_income'));
        $this->assertEquals(12000 - 1000 - 692.80, $this->ledger('loans_receivable'));
        // #2 and #3 are still part unpaid but were already charged: no second penalty
        $this->assertEquals(0, app(LoanService::class)->position($loan->fresh(), '2026-04-20')['penalty_due']);

        // an older payment cannot be cancelled while a later one stands
        $this->actingAs($this->cashier)->postJson("/api/loans/payments/{$p1->id}/cancel", ['reason' => 'ভুল'])->assertStatus(422);
        $req = $this->actingAs($this->cashier)->postJson("/api/loans/payments/{$p2->id}/cancel", ['reason' => 'ভুল এন্ট্রি'])->assertCreated();
        $this->actingAs($this->cashier)->postJson("/api/loans/{$loan->id}/payments", ['date' => '2026-04-12', 'amount' => 10, 'method' => 'cash'])->assertStatus(422);
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', $p2->fresh()->status);
        $this->assertEquals(11000, $this->ledger('loans_receivable'));
        $this->assertEquals(0, $this->ledger('loan_penalty_income'));
        $this->assertEquals(0, (float) $loan->schedule()->where('seq', 2)->value('penalty_accrued'));

        // dues list on a date: overdue since 03-01
        $dues = $this->actingAs($this->loanOfficer)->getJson('/api/loans/dues?as_of=2026-06-30')->assertOk();
        $this->assertSame($loan->id, $dues->json('rows.0.id'));
        $this->assertSame('90_plus', $dues->json('rows.0.bucket'));
        $this->assertSame(121, $dues->json('rows.0.days_overdue'));

        // pay everything off today → closed
        $payoff = app(LoanService::class)->position($loan->fresh(), '2026-06-30')['payoff'];
        $this->actingAs($this->cashier)->postJson("/api/loans/{$loan->id}/payments", ['date' => '2026-06-30', 'amount' => $payoff + 1, 'method' => 'cash'])
            ->assertStatus(422)->assertJsonValidationErrors('amount');
        $last = $this->pay($loan, '2026-06-30', $payoff, $this->loanOfficer);
        $this->assertEquals(0, (float) $last->principal_after);
        $loan->refresh();
        $this->assertSame('closed', $loan->status);
        $this->assertSame('2026-06-30', $loan->closed_on->toDateString());
        $this->assertEquals(0, $this->ledger('loans_receivable'));
        $this->assertEquals(-1440, $this->ledger('loan_interest_income'));
        $this->assertGreaterThan(0, -$this->ledger('loan_penalty_income'));

        $st = $this->actingAs($this->loanOfficer)->getJson("/api/loans/{$loan->id}/statement")->assertOk();
        $this->assertEquals(0, $st->json('closing'));
        $this->assertEquals(12000, $st->json('totals.principal'));

        $audit = $this->actingAs($this->manager)->getJson('/api/loans/audit')->assertOk();
        $this->assertSame([], $audit->json('issues'));
        $this->assertEquals(0, $audit->json('difference'));

        // a closed loan frees the member for a new one
        $this->actingAs($this->loanOfficer)->getJson("/api/loans/eligibility?member_id={$m->id}&product_id={$p->id}")->assertJsonPath('open_loan', null);
    }

    public function test_approved_loan_can_be_cancelled_and_one_time_loan_uses_term(): void
    {
        $p = $this->product(['code' => 'HV-1', 'frequency' => 'one_time', 'installments' => null, 'term_months' => 6, 'guarantors_required' => 0, 'savings_multiplier' => null]);
        $this->assertSame(1, $p->installments);
        $m = $this->member('করিম');
        $loan = Loan::findOrFail($this->actingAs($this->loanOfficer)->postJson('/api/loans', [
            'member_id' => $m->id, 'product_id' => $p->id, 'applied_on' => '2026-06-01', 'amount' => 10000, 'guarantors' => [],
        ])->assertCreated()->json('id'));
        $this->approve($loan->approval_request_id);

        $this->actingAs($this->loanOfficer)->postJson("/api/loans/{$loan->id}/disburse", ['date' => '2026-06-05', 'method' => 'cash', 'first_due_on' => '2026-06-05'])
            ->assertStatus(422)->assertJsonValidationErrors('first_due_on');
        $this->actingAs($this->loanOfficer)->postJson("/api/loans/{$loan->id}/cancel", ['reason' => 'সদস্য নেবেন না'])->assertOk();
        $this->assertSame('cancelled', $loan->fresh()->status);
        $this->actingAs($this->loanOfficer)->postJson("/api/loans/{$loan->id}/disburse", ['date' => '2026-06-05', 'method' => 'cash'])->assertStatus(422);

        $loan2 = Loan::findOrFail($this->actingAs($this->loanOfficer)->postJson('/api/loans', [
            'member_id' => $m->id, 'product_id' => $p->id, 'applied_on' => '2026-06-01', 'amount' => 10000, 'guarantors' => [],
        ])->assertCreated()->json('id'));
        $this->approve($loan2->approval_request_id);
        $this->actingAs($this->loanOfficer)->postJson("/api/loans/{$loan2->id}/disburse", ['date' => '2026-06-05', 'method' => 'cash'])->assertOk();
        $loan2->refresh();
        $this->assertSame('2026-12-05', $loan2->first_due_on->toDateString());
        $this->assertCount(1, $loan2->schedule);
        $this->assertEquals(600, $loan2->total_interest);
    }

    public function test_simple_plan_form_and_fixed_penalty_once_per_late_instalment(): void
    {
        // only the essentials: the code is made up, interest is flat, the rest has defaults
        $r = $this->actingAs($this->manager)->postJson('/api/loan-products', [
            'name_bn' => 'সহজ ঋণ', 'max_amount' => 20000, 'interest_rate' => 12, 'interest_method' => 'declining',
            'frequency' => 'monthly', 'installments' => 12, 'penalty_type' => 'fixed', 'penalty_rate' => 50,
        ])->assertCreated();
        $p = LoanProduct::findOrFail($r->json('id'));
        $this->assertMatchesRegularExpression('/^LP-\d+$/', $p->code);
        $this->assertSame('flat', $p->interest_method);
        $this->assertSame(1, $p->guarantors_required);
        $this->assertSame(0, $p->grace_days);
        $this->actingAs($this->manager)->postJson('/api/loan-products', ['name_bn' => 'ভুল', 'max_amount' => 1, 'interest_rate' => 1, 'frequency' => 'monthly',
            'installments' => 1, 'penalty_type' => 'percent', 'penalty_rate' => 150])->assertStatus(422)->assertJsonValidationErrors('penalty_rate');

        $m = $this->member('করিম', 5000);
        $loan = Loan::findOrFail($this->actingAs($this->loanOfficer)->postJson('/api/loans', [
            'member_id' => $m->id, 'product_id' => $p->id, 'applied_on' => '2025-12-20', 'amount' => 12000,
            'guarantors' => [['member_id' => $this->member('রহিম')->id]],
        ])->assertCreated()->json('id'));
        $this->assertSame('fixed', $loan->penalty_type);
        $this->approve($loan->approval_request_id);
        $this->actingAs($this->loanOfficer)->postJson("/api/loans/{$loan->id}/disburse", ['date' => '2026-01-01', 'method' => 'cash'])->assertOk();

        // #1 due 02-01 paid on 02-01 (no grace days): no penalty; #2 and #3 late: ৳50 each, however late
        $this->assertEquals(0, $this->pay($loan, '2026-02-01', 1120)->penalty);
        $svc = app(LoanService::class);
        $this->assertEquals(0, $svc->position($loan->fresh(), '2026-03-01')['penalty_due']);
        $this->assertEquals(50, $svc->position($loan->fresh(), '2026-03-02')['penalty_due']);
        $this->assertEquals(150, $svc->position($loan->fresh(), '2026-06-01')['penalty_due']); // #2, #3 and #4 are late by then
        $this->assertEquals(100, $this->pay($loan, '2026-04-02', 500)->penalty);

        // a loan given under the old rule keeps its day-by-day % per month
        $loan->update(['penalty_type' => 'daily', 'penalty_rate' => 3, 'grace_days' => 5]);
        $inst = $loan->schedule()->where('seq', 4)->first();
        $this->assertEquals(round(1120 * 0.03 / 30 * 10, 2), $svc->newPenalty($loan->fresh(), $inst, '2026-05-16'));
    }
}
