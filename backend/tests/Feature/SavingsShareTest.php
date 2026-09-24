<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\DistributionRun;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\User;
use App\Services\LedgerService;
use Illuminate\Testing\TestResponse;

class SavingsShareTest extends Phase2TestCase
{
    private User $cashier;

    private int $memberNo = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cashier = $this->userWithRole('cashier');
    }

    private function member(string $name = 'সদস্য', string $status = Member::ACTIVE): Member
    {
        return Member::create([
            'farmer_id' => $this->makeFarmer(['name_bn' => $name])->id, 'member_no' => ++$this->memberNo,
            'admitted_on' => '2020-01-01', 'status' => $status,
        ]);
    }

    private function open(string $kind, Member $m): MemberAccount
    {
        $r = $this->actingAs($this->cashier)->postJson("/api/funds/$kind/accounts", ['member_id' => $m->id, 'opened_on' => now()->toDateString()])->assertCreated();

        return MemberAccount::findOrFail($r->json('id'));
    }

    private function txn(MemberAccount $a, array $data, int $status = 201): MemberTransaction|TestResponse
    {
        $r = $this->actingAs($this->cashier)->postJson("/api/funds/{$a->kind}/accounts/{$a->id}/transactions",
            // the SPA always sends these keys, null when unused
            $data + ['date' => now()->toDateString(), 'fund_account_id' => null, 'counter_account_id' => null])->assertStatus($status);

        return $status === 201 ? MemberTransaction::findOrFail($r->json('id')) : $r;
    }

    private function approve(?int $requestId): void
    {
        $this->assertNotNull($requestId);
        $this->actingAs($this->manager)->postJson("/api/approvals/{$requestId}/decide", ['decision' => 'approve'])->assertOk();
    }

    /** Members' side of a liability / equity account (credit − debit). */
    private function ledger(string $key): float
    {
        return -app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    private function assertAuditClean(string $kind): void
    {
        $r = $this->actingAs($this->manager)->getJson("/api/funds/$kind/audit")->assertOk();
        $this->assertSame([], $r->json('issues'));
        $this->assertEquals(0, $r->json('difference'));
    }

    public function test_deposit_posts_to_ledger_and_statement_matches(): void
    {
        $m = $this->member('করিম');
        $a = $this->open('savings', $m);
        $this->assertStringStartsWith('SAV-', $a->account_no);
        $this->actingAs($this->cashier)->postJson('/api/funds/savings/accounts', ['member_id' => $m->id, 'opened_on' => now()->toDateString()])->assertStatus(422);
        $this->actingAs($this->cashier)->postJson('/api/funds/savings/accounts', ['member_id' => $this->member('নিষ্ক্রিয়', Member::INACTIVE)->id, 'opened_on' => now()->toDateString()])->assertStatus(422);

        $t = $this->txn($a, ['type' => 'deposit', 'amount' => 1000, 'method' => 'cash']);
        $this->assertSame('posted', $t->status);
        $this->assertEquals(1000, $t->balance_after);
        $this->txn($a, ['type' => 'deposit', 'amount' => 250.5, 'method' => 'cash']);
        // Share account never receives a "deposit".
        $this->txn($a, ['type' => 'purchase', 'amount' => 10, 'method' => 'cash'], 422);

        $this->assertEquals(1250.5, $a->fresh()->balance);
        $this->assertEquals(1250.5, $this->ledger('savings_deposits'));
        $this->assertEquals(1250.5, app(LedgerService::class)->balance(Account::byKey('cash_society')->id));

        $s = $this->actingAs($this->cashier)->getJson("/api/funds/savings/accounts/{$a->id}/statement")->assertOk();
        $this->assertEquals(1250.5, $s->json('closing'));
        $this->assertCount(2, $s->json('rows'));
        $g = $this->actingAs($this->cashier)->getJson("/api/funds/savings/accounts/{$a->id}/statement?group=month")->assertOk();
        $this->assertCount(1, $g->json('rows'));
        $this->assertEquals(1250.5, $g->json('rows.0.in'));
        $this->assertAuditClean('savings');

        $slip = $this->actingAs($this->cashier)->getJson("/api/funds/savings/transactions/{$t->id}")->assertOk();
        $this->assertSame('করিম', $slip->json('account.member.farmer.name_bn'));
        $this->assertTrue($slip->json('can_cancel'));
    }

    public function test_withdrawal_waits_for_approval_and_holds_the_money(): void
    {
        $a = $this->open('savings', $this->member());
        $this->txn($a, ['type' => 'deposit', 'amount' => 1000, 'method' => 'cash']);

        $this->txn($a, ['type' => 'withdrawal', 'amount' => 1500, 'method' => 'cash'], 422);
        $w = $this->txn($a, ['type' => 'withdrawal', 'amount' => 600, 'method' => 'cash']);
        $this->assertSame('pending', $w->status);
        $this->assertEquals(1000, $a->fresh()->balance);
        // 600 is held, only 400 can still be asked for.
        $this->txn($a, ['type' => 'withdrawal', 'amount' => 500, 'method' => 'cash'], 422);

        // The cashier cannot approve their own request.
        $this->actingAs($this->cashier)->postJson("/api/approvals/{$w->approval_request_id}/decide", ['decision' => 'approve'])->assertStatus(422);
        $this->approve($w->approval_request_id);
        $w->refresh();
        $this->assertSame('posted', $w->status);
        $this->assertEquals(400, $w->balance_after);
        $this->assertEquals(400, $this->ledger('savings_deposits'));
        $this->assertEquals(400, app(LedgerService::class)->balance(Account::byKey('cash_society')->id));

        $r = $this->txn($a, ['type' => 'withdrawal', 'amount' => 100, 'method' => 'cash']);
        $this->actingAs($this->manager)->postJson("/api/approvals/{$r->approval_request_id}/decide", ['decision' => 'reject', 'remarks' => 'না'])->assertOk();
        $this->assertSame('rejected', $r->fresh()->status);
        $this->assertEquals(400, $a->fresh()->available());
        $this->assertAuditClean('savings');
    }

    public function test_opening_adjustment_and_cancel_go_through_approval(): void
    {
        $a = $this->open('savings', $this->member());
        $o = $this->txn($a, ['type' => 'opening', 'amount' => 5000]);
        $this->assertSame('pending', $o->status);
        $this->txn($a, ['type' => 'opening', 'amount' => 1], 422);
        $this->approve($o->approval_request_id);
        $this->assertEquals(5000, $a->fresh()->balance);
        $this->assertEquals(5000, app(LedgerService::class)->balance(Account::byKey('opening_balance_equity')->id));

        $adj = $this->txn($a, ['type' => 'adjustment', 'direction' => 'out', 'amount' => 200, 'remarks' => 'ভুল এন্ট্রি সংশোধন']);
        $this->approve($adj->approval_request_id);
        $this->assertEquals(4800, $a->fresh()->balance);

        $d = $this->txn($a, ['type' => 'deposit', 'amount' => 300, 'method' => 'cash']);
        $req = $this->actingAs($this->cashier)->postJson("/api/funds/savings/transactions/{$d->id}/cancel", ['reason' => 'ভুল সদস্য'])->assertCreated();
        $this->assertSame('cancel_pending', $d->fresh()->status);
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', $d->fresh()->status);
        $this->assertSame('reversed', $d->fresh()->journal->status);
        $this->assertEquals(4800, $a->fresh()->balance);
        $this->assertEquals(4800, $this->ledger('savings_deposits'));
        $this->assertAuditClean('savings');
    }

    public function test_share_purchase_transfer_and_reconciliation(): void
    {
        $x = $this->member('ক');
        $y = $this->member('খ');
        $sx = $this->open('share', $x);
        $this->assertStringStartsWith('SHR-', $sx->account_no);
        $this->txn($sx, ['type' => 'purchase', 'amount' => 1000, 'method' => 'cash']);
        $this->txn($sx, ['type' => 'withdrawal', 'amount' => 10, 'method' => 'cash'], 422);
        $this->assertEquals(1000, $this->ledger('share_capital'));
        $this->assertEquals(0, $this->ledger('savings_deposits'));

        $t = $this->txn($sx, ['type' => 'transfer', 'amount' => 400, 'to_member_id' => $y->id, 'remarks' => 'বিক্রয়']);
        $this->assertSame('pending', $t->status);
        $sy = MemberAccount::where('kind', 'share')->where('member_id', $y->id)->firstOrFail();
        $this->approve($t->approval_request_id);
        $this->assertEquals(600, $sx->fresh()->balance);
        $this->assertEquals(400, $sy->fresh()->balance);
        $this->assertNull($t->fresh()->journal_id);
        $this->assertEquals(1000, $this->ledger('share_capital'));
        $this->assertAuditClean('share');

        $list = $this->actingAs($this->cashier)->getJson('/api/funds/share/accounts')->assertOk();
        $this->assertEquals(1000, $list->json('totals.balance'));
        $this->assertEquals(1000, $list->json('ledger_balance'));
    }

    public function test_profit_is_manual_and_dividend_is_pro_rata_into_savings(): void
    {
        $x = $this->member('ক');
        $y = $this->member('খ');
        $z = $this->member('গ');
        $proposer = $this->userWithRole('manager'); // a second manager proposes, the first approves
        $vx = $this->open('savings', $x);
        $this->txn($vx, ['type' => 'deposit', 'amount' => 1000, 'method' => 'cash']);

        $p = $this->actingAs($proposer)->getJson('/api/distributions/profit/preview')->assertOk();
        $this->assertCount(1, $p->json('rows'));
        $this->actingAs($proposer)->postJson('/api/distributions/profit', [
            'title' => 'মুনাফা ২০২৬', 'date' => now()->toDateString(), 'items' => [['member_id' => $y->id, 'amount' => 10]],
        ])->assertStatus(422);
        $r = $this->actingAs($proposer)->postJson('/api/distributions/profit', [
            'title' => 'মুনাফা ২০২৬', 'date' => now()->toDateString(), 'items' => [['member_id' => $x->id, 'amount' => 55.25]],
        ])->assertCreated();
        $run = DistributionRun::findOrFail($r->json('id'));
        $this->assertSame('pending', $run->status);
        $this->approve($run->approval_request_id);
        $this->assertSame('posted', $run->fresh()->status);
        $this->assertEquals(1055.25, $vx->fresh()->balance);
        $this->assertEquals(55.25, app(LedgerService::class)->balance(Account::byKey('savings_profit_expense')->id));

        // Share capital 1 : 2 : 0 → dividend 100.01 split 33.34 / 66.67.
        $this->txn($this->open('share', $x), ['type' => 'purchase', 'amount' => 100, 'method' => 'cash']);
        $this->txn($this->open('share', $y), ['type' => 'purchase', 'amount' => 200, 'method' => 'cash']);
        $this->open('share', $z);
        $prev = $this->actingAs($proposer)->getJson('/api/distributions/dividend/preview?basis_date='.now()->toDateString().'&pool_amount=100.01')->assertOk();
        $this->assertEquals(100.01, $prev->json('total'));
        $this->assertCount(2, $prev->json('rows'));
        $r = $this->actingAs($proposer)->postJson('/api/distributions/dividend', [
            'title' => 'লভ্যাংশ ২০২৬', 'date' => now()->toDateString(), 'basis_date' => now()->toDateString(), 'pool_amount' => 100.01,
        ])->assertCreated();
        $run = DistributionRun::findOrFail($r->json('id'));
        $this->approve($run->approval_request_id);
        $this->assertEquals(1055.25 + 33.34, $vx->fresh()->balance);
        // খ had no savings account: one is opened for the dividend.
        $this->assertEquals(66.67, MemberAccount::where('kind', 'savings')->where('member_id', $y->id)->value('balance'));
        $this->assertEquals(1000 + 55.25 + 100.01, $this->ledger('savings_deposits'));
        $this->assertEquals(300, $this->ledger('share_capital'));
        $this->assertAuditClean('savings');
        $this->assertAuditClean('share');
    }

    public function test_permissions_follow_the_kind(): void
    {
        $a = $this->open('savings', $this->member());
        $officer = $this->userWithRole('member_officer');
        $this->actingAs($officer)->getJson('/api/funds/savings/accounts')->assertForbidden();
        $this->actingAs($officer)->postJson("/api/funds/savings/accounts/{$a->id}/transactions", ['type' => 'deposit', 'amount' => 1, 'method' => 'cash', 'date' => now()->toDateString()])->assertForbidden();
        // A savings account id under the share URL is not found.
        $this->actingAs($this->cashier)->getJson("/api/funds/share/accounts/{$a->id}")->assertNotFound();
        $this->actingAs($this->cashier)->postJson('/api/distributions/profit', ['title' => 'x', 'date' => now()->toDateString(), 'items' => []])->assertForbidden();
    }
}
