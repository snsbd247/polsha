<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CombinedPayment;
use App\Models\Farmer;
use App\Models\FieldDeposit;
use App\Models\Invoice;
use App\Models\IrrigationType;
use App\Models\LandType;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\Season;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\SettingService;
use Illuminate\Support\Carbon;

/** A field collector takes cash at the farmer's door; the office receives it later. */
class FieldCollectionTest extends Phase2TestCase
{
    private User $collector;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-06-30 10:00:00');
        $this->collector = $this->userWithRole('field_collector');
        $this->cashier = $this->userWithRole('cashier');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function ledger(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    /** A member with an irrigation bill of 330 and the share minimum (1,000) still unpaid. */
    private function payer(): Farmer
    {
        $farmer = $this->makeFarmer(['name_bn' => 'করিম', 'mobile' => '01711000111']);
        $member = Member::create(['farmer_id' => $farmer->id, 'member_no' => 7, 'admitted_on' => '2020-01-01', 'status' => Member::ACTIVE]);
        MemberAccount::create(['kind' => 'savings', 'member_id' => $member->id, 'account_no' => 'SAV-F1', 'opened_on' => '2020-01-01', 'balance' => 0]);
        SettingService::setMany(['share_min_amount' => 1000]);

        $irr = $this->userWithRole('irrigation_officer');
        $deep = IrrigationType::where('name_bn', 'গভীর নলকূপ')->firstOrFail();
        $season = Season::findOrFail($this->actingAs($irr)->postJson('/api/seasons', [
            'name_bn' => 'বোরো ২০২৬', 'code' => 'BORO26', 'type' => 'rabi', 'crop' => 'ধান', 'start_date' => '2026-05-01', 'end_date' => '2026-09-30', 'status' => 'open',
        ])->assertCreated()->json('id'));
        $rate = $this->actingAs($irr)->postJson('/api/irrigation-rates', [
            'season_id' => $season->id, 'irrigation_type_id' => $deep->id, 'rate' => 10, 'effective_from' => '2026-05-01',
        ])->assertCreated();
        $this->actingAs($this->manager)->postJson("/api/approvals/{$rate->json('approval_request_id')}/decide", ['decision' => 'approve'])->assertOk();
        $land = $this->actingAs($irr)->postJson('/api/lands', [
            'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '১৪৫', 'dag_no' => '101',
            'area' => 1, 'area_unit' => 'bigha', 'land_type_id' => LandType::first()->id, 'status' => 'cultivated', 'irrigation_type_id' => $deep->id,
            'owners' => [['farmer_id' => $farmer->id, 'share_percent' => 100]], 'owned_since' => '2015-01-01',
            'cultivation' => ['farmer_id' => $farmer->id, 'type' => 'own', 'start_date' => '2024-01-01'],
        ])->assertCreated();
        $this->actingAs($irr)->postJson('/api/invoices', ['season_id' => $season->id, 'land_id' => $land->json('id'), 'invoice_date' => '2026-06-01'])->assertCreated();

        return $farmer;
    }

    public function test_collector_takes_cash_in_the_field_and_the_office_receives_it(): void
    {
        $farmer = $this->payer();

        // the collector sees only their own screen
        $this->actingAs($this->collector)->getJson('/api/combined-payments')->assertForbidden();
        $this->actingAs($this->collector)->getJson('/api/farmers')->assertForbidden();
        $this->actingAs($this->collector)->getJson('/api/field/farmers?search=01711000111')->assertOk()->assertJsonPath('0.id', $farmer->id);
        $this->actingAs($this->collector)->getJson("/api/field/dues?farmer_id={$farmer->id}&amount=2000")->assertOk()
            ->assertJsonPath('irrigation.due', 330)->assertJsonPath('allocation.parts.share', 1000)->assertJsonPath('allocation.parts.savings', 670);

        $irrigation = $this->ledger('cash_irrigation');
        $society = $this->ledger('cash_society');
        $r = $this->actingAs($this->collector)->postJson('/api/field/collect', ['farmer_id' => $farmer->id, 'amount' => 2000])->assertCreated();
        $this->assertNotEmpty($r->json('verify_token'));
        $payment = CombinedPayment::findOrFail($r->json('id'));
        $this->assertSame($this->collector->id, $payment->field_collector_id);
        $this->assertSame('2026-06-30', $payment->date->toDateString());
        // the money is with the collector, not yet in the society's cash
        $this->assertEquals(2000, $this->ledger('cash_field'));
        $this->assertEquals($irrigation, $this->ledger('cash_irrigation'));
        $this->assertEquals($society, $this->ledger('cash_society'));
        $this->assertEquals(0, (float) Invoice::where('farmer_id', $farmer->id)->first()->dueAmount());

        $mine = $this->actingAs($this->collector)->getJson('/api/field/mine')->assertOk();
        $this->assertEquals(2000, $mine->json('today_total'));
        $this->assertEquals(2000, $mine->json('holding.amount'));

        // the office sees who holds what; the collector cannot receive their own cash
        $office = $this->actingAs($this->cashier)->getJson('/api/field/collectors')->assertOk();
        $this->assertEquals(2000, $office->json('holding'));
        $this->assertEquals(2000, collect($office->json('collectors'))->firstWhere('id', $this->collector->id)['amount']);
        $this->actingAs($this->collector)->postJson('/api/field/deposits', ['collector_id' => $this->collector->id, 'date' => '2026-06-30'])->assertForbidden();
        $this->actingAs($this->cashier)->postJson('/api/field/deposits', ['collector_id' => $this->collector->id, 'date' => '2026-06-29'])
            ->assertStatus(422)->assertJsonValidationErrors('date');

        $d = $this->actingAs($this->cashier)->postJson('/api/field/deposits', ['collector_id' => $this->collector->id, 'date' => '2026-06-30', 'note' => 'সন্ধ্যায় জমা'])->assertCreated();
        $deposit = FieldDeposit::findOrFail($d->json('id'));
        $this->assertStringStartsWith('FD-2026-', $deposit->deposit_no);
        $this->assertEquals(2000, $deposit->amount);
        $this->assertSame(1, $deposit->payments_count);
        $this->assertEquals(0, $this->ledger('cash_field'));
        $this->assertEquals($irrigation + 330, $this->ledger('cash_irrigation'));
        $this->assertEquals($society + 1670, $this->ledger('cash_society'));
        $this->assertSame($deposit->id, $payment->fresh()->field_deposit_id);
        $this->actingAs($this->collector)->getJson('/api/field/mine')->assertJsonPath('holding.count', 0);

        // nothing left to hand in, and a handed-in receipt can no longer be cancelled
        $this->actingAs($this->cashier)->postJson('/api/field/deposits', ['collector_id' => $this->collector->id, 'date' => '2026-06-30'])->assertStatus(422);
        $this->actingAs($this->cashier)->postJson("/api/combined-payments/{$payment->id}/cancel", ['reason' => 'ভুল'])->assertStatus(422)->assertJsonValidationErrors('payment');
    }

    public function test_a_wrong_field_receipt_cancelled_before_hand_in_leaves_nothing_to_deposit(): void
    {
        $farmer = $this->payer();
        $r = $this->actingAs($this->collector)->postJson('/api/field/collect', ['farmer_id' => $farmer->id, 'amount' => 330])->assertCreated();
        $req = $this->actingAs($this->cashier)->postJson("/api/combined-payments/{$r->json('id')}/cancel", ['reason' => 'ভুল কৃষক'])->assertCreated();
        $this->actingAs($this->manager)->postJson("/api/approvals/{$req->json('id')}/decide", ['decision' => 'approve'])->assertOk();
        $this->assertEquals(0, $this->ledger('cash_field'));
        $this->actingAs($this->cashier)->postJson('/api/field/deposits', ['collector_id' => $this->collector->id, 'date' => '2026-06-30'])->assertStatus(422);
    }
}
