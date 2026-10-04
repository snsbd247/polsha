<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Receipt;
use App\Models\User;
use App\Models\WaterBill;
use App\Models\WaterConnection;
use App\Models\WaterConnectionType;
use App\Services\LedgerService;

class WaterSupplyTest extends Phase2TestCase
{
    private User $waterUser;

    private WaterConnectionType $home;

    protected function setUp(): void
    {
        parent::setUp();
        $this->waterUser = $this->userWithRole('water_officer');
        $this->home = WaterConnectionType::where('code', 'RES')->firstOrFail();
        // the society sets its tariff first
        $this->actingAs($this->manager)->putJson("/api/water/types/{$this->home->id}", [
            'code' => 'RES', 'name_bn' => 'আবাসিক', 'name_en' => 'Residential', 'monthly_fee' => 200, 'connection_fee' => 1000, 'is_active' => true,
        ])->assertOk();
    }

    private function balance(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    private function approve(int $requestId): void
    {
        $this->actingAs($this->manager)->postJson("/api/approvals/{$requestId}/decide", ['decision' => 'approve'])->assertOk();
    }

    private function connect(array $overrides = []): WaterConnection
    {
        $r = $this->actingAs($this->waterUser)->postJson('/api/water/connections', $overrides + [
            'type_id' => $this->home->id, 'name_bn' => 'রহিম উদ্দিন', 'father_name' => 'করিম উদ্দিন', 'mobile' => '০১৭১১০০০০০১',
            'village_id' => $this->village->id, 'address' => 'উত্তর পাড়া', 'connected_on' => now()->subMonths(2)->toDateString(),
        ])->assertCreated();

        return WaterConnection::findOrFail($r->json('id'));
    }

    public function test_tariff_is_changed_only_by_water_admins(): void
    {
        $this->actingAs($this->waterUser)->putJson("/api/water/types/{$this->home->id}", [
            'code' => 'RES', 'name_bn' => 'আবাসিক', 'monthly_fee' => 1, 'connection_fee' => 0,
        ])->assertForbidden();
        $this->actingAs($this->userWithRole('loan_officer'))->getJson('/api/water/connections')->assertForbidden();
    }

    public function test_connection_with_fee_then_monthly_bills_for_everyone_billable(): void
    {
        $c = $this->connect(['connection_fee' => 1000]);
        $this->assertSame('01711000001', $c->mobile);
        $this->assertMatchesRegularExpression('/^WC-\d{6}$/', $c->connection_no);
        // the connection fee is a bill of its own, income straight away
        $this->assertSame(1000.0, $this->balance('water_receivable'));
        $this->assertSame(-1000.0, $this->balance('water_connection_fee_income'));

        // a special fee for one connection; another type without a fee yet is listed apart
        $shop = WaterConnectionType::where('code', 'COM')->firstOrFail();
        $this->connect(['name_bn' => 'দোকান', 'mobile' => null, 'monthly_fee' => 350]);
        $this->connect(['name_bn' => 'মাদ্রাসা', 'mobile' => null, 'type_id' => $shop->id]);
        // connected after the month → not billed for it
        $this->connect(['name_bn' => 'নতুন', 'mobile' => null, 'connected_on' => now()->toDateString()]);

        $period = now()->subMonth()->format('Y-m');
        $this->actingAs($this->waterUser)->getJson("/api/water/billing/preview?period=$period")->assertOk()
            ->assertJsonPath('count', 2)->assertJsonPath('total', 550)->assertJsonCount(1, 'no_fee');
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => $period, 'bill_date' => now()->toDateString()])
            ->assertCreated()->assertJsonPath('count', 2);
        // twice for the same month is not possible
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => $period, 'bill_date' => now()->toDateString()])->assertStatus(422);

        $this->assertSame(1550.0, $this->balance('water_receivable'));
        $this->assertSame(-550.0, $this->balance('water_income'));
        $this->actingAs($this->waterUser)->getJson("/api/water/bills?period=$period")->assertOk()
            ->assertJsonPath('totals.count', 2)->assertJsonPath('totals.due', 550);
    }

    public function test_collection_with_penalty_lands_in_water_cash_and_cancel_undoes_it(): void
    {
        $c = $this->connect();
        $period = now()->subMonth()->format('Y-m');
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => $period, 'bill_date' => now()->toDateString()])->assertCreated();
        $bill = WaterBill::where('connection_id', $c->id)->firstOrFail();

        $dues = $this->actingAs($this->waterUser)->getJson("/api/water/connections/{$c->id}/dues")->assertOk()->assertJsonPath('total_due', 200);
        $r = $this->actingAs($this->waterUser)->postJson('/api/water/collect', [
            'connection_id' => $c->id, 'date' => now()->toDateString(), 'method' => 'cash', 'penalty' => 20,
            'items' => [['bill_id' => $dues->json('bills.0.id'), 'amount' => 200]],
        ])->assertCreated()->assertJsonPath('amount', 220);

        $this->assertSame('paid', $bill->fresh()->status);
        $this->assertEquals(20, $bill->fresh()->penalty);
        $this->assertSame(220.0, $this->balance('cash_water'));
        $this->assertSame(0.0, $this->balance('water_receivable'));
        $this->assertSame(-20.0, $this->balance('water_penalty_income'));
        // not mixed into the irrigation receipt screens
        $this->actingAs($this->manager)->getJson('/api/receipts')->assertOk()->assertJsonPath('total', 0);
        $this->actingAs($this->waterUser)->getJson("/api/water/receipts/{$r->json('id')}")->assertOk()
            ->assertJsonPath('penalty', 20)->assertJsonPath('connection.connection_no', $c->connection_no);

        // more than is due is refused
        $this->actingAs($this->waterUser)->postJson('/api/water/collect', [
            'connection_id' => $c->id, 'date' => now()->toDateString(), 'method' => 'cash', 'items' => [['bill_id' => $bill->id, 'amount' => 1]],
        ])->assertStatus(422);

        // cancelling the receipt gives back the bill and takes the penalty off again
        $req = $this->actingAs($this->waterUser)->postJson("/api/water/receipts/{$r->json('id')}/cancel", ['reason' => 'ভুল গ্রাহক'])->assertCreated();
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', Receipt::find($r->json('id'))->status);
        $bill->refresh();
        $this->assertSame('unpaid', $bill->status);
        $this->assertEquals(0, $bill->penalty);
        $this->assertSame(0.0, $this->balance('cash_water'));
        $this->assertSame(0.0, $this->balance('water_penalty_income'));
        $this->assertSame(200.0, $this->balance('water_receivable'));
    }

    public function test_unpaid_bill_is_cancelled_after_approval_and_close_needs_no_dues(): void
    {
        $c = $this->connect();
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => now()->subMonth()->format('Y-m'), 'bill_date' => now()->toDateString()])->assertCreated();
        $bill = WaterBill::where('connection_id', $c->id)->firstOrFail();

        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'close', 'date' => now()->toDateString(), 'reason' => 'বাড়ি বিক্রি'])
            ->assertStatus(422);

        $req = $this->actingAs($this->waterUser)->postJson("/api/water/bills/{$bill->id}/cancel", ['reason' => 'ভুল বিল'])->assertCreated();
        $this->assertSame('unpaid', $bill->fresh()->status);
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', $bill->fresh()->status);
        $this->assertSame(0.0, $this->balance('water_receivable'));
        $this->assertSame(0.0, $this->balance('water_income'));

        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'close', 'date' => now()->toDateString(), 'reason' => 'বাড়ি বিক্রি'])
            ->assertOk()->assertJsonPath('status', 'closed');
    }

    public function test_disconnected_connections_are_not_billed_and_reconnection_fee_is_a_bill(): void
    {
        $c = $this->connect();
        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'disconnect', 'date' => now()->toDateString(), 'reason' => 'বকেয়া'])
            ->assertOk()->assertJsonPath('status', 'disconnected');
        $this->actingAs($this->waterUser)->getJson('/api/water/billing/preview?period='.now()->subMonth()->format('Y-m'))->assertJsonPath('count', 0);

        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'reconnect', 'date' => now()->toDateString(), 'fee' => 300])
            ->assertOk()->assertJsonPath('status', 'active');
        $this->assertSame(1, WaterBill::where('connection_id', $c->id)->where('kind', 'reconnection')->where('amount', 300)->count());

        $this->actingAs($this->waterUser)->getJson('/api/water/dues')->assertOk()
            ->assertJsonPath('totals.connections', 1)->assertJsonPath('totals.due', 300);
    }
}
