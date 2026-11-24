<?php

namespace Tests\Feature;

use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\IrrigationLift;
use App\Models\IrrigationRate;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Season;
use App\Models\User;

/** Irrigation rates by lift: a plot's lift (1st/2nd/3rd …) sets its rate. */
class IrrigationLiftTest extends Phase2TestCase
{
    private User $irrigation;

    private User $admin;

    private IrrigationType $deep;

    private Season $season;

    private Farmer $owner;

    /** @var array<int, IrrigationLift> keyed 1, 2, 3 */
    private array $lift = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->irrigation = $this->userWithRole('irrigation_officer');
        $this->admin = $this->userWithRole('admin');
        $this->deep = IrrigationType::where('name_bn', 'গভীর নলকূপ')->firstOrFail();
        $this->owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        foreach ([1 => 'L1', 2 => 'L2', 3 => 'L3'] as $n => $code) {
            $this->lift[$n] = IrrigationLift::where('code', $code)->firstOrFail();
        }

        $r = $this->actingAs($this->irrigation)->postJson('/api/seasons', [
            'name_bn' => 'বোরো ২০২৬', 'code' => 'BORO26', 'type' => 'rabi', 'crop' => 'ধান', 'start_date' => now()->subMonth()->toDateString(),
            'end_date' => now()->addMonths(3)->toDateString(), 'status' => 'open',
        ])->assertCreated();
        $this->season = Season::findOrFail($r->json('id'));
    }

    private function rate(float $rate, ?int $liftNo, ?int $landTypeId = null, ?Season $season = null): IrrigationRate
    {
        $r = $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', [
            'season_id' => ($season ?? $this->season)->id, 'irrigation_type_id' => $this->deep->id,
            'lift_id' => $liftNo ? $this->lift[$liftNo]->id : null, 'land_type_id' => $landTypeId,
            'rate' => $rate, 'effective_from' => now()->subMonth()->toDateString(),
        ])->assertCreated();
        $rate = IrrigationRate::findOrFail($r->json('id'));
        $this->actingAs($this->manager)->postJson("/api/approvals/{$rate->approval_request_id}/decide", ['decision' => 'approve'])->assertOk();

        return $rate->fresh();
    }

    /** One bigha (33 decimals) of own cultivation on a lift (or none). */
    private function land(string $dag, ?int $liftNo, ?int $landTypeId = null): Land
    {
        $r = $this->actingAs($this->irrigation)->postJson('/api/lands', [
            'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '১৪৫', 'dag_no' => $dag,
            'area' => 1, 'area_unit' => 'bigha', 'land_type_id' => $landTypeId ?? LandType::first()->id, 'status' => 'cultivated',
            'irrigation_type_id' => $this->deep->id, 'lift_id' => $liftNo ? $this->lift[$liftNo]->id : null,
            'owners' => [['farmer_id' => $this->owner->id, 'share_percent' => 100]], 'owned_since' => '2015-01-01',
            'cultivation' => ['farmer_id' => $this->owner->id, 'type' => 'own', 'start_date' => '2024-01-01'],
        ])->assertCreated();

        return Land::findOrFail($r->json('id'));
    }

    private function bulk(string $path, array $extra = [])
    {
        return $this->actingAs($this->irrigation)->postJson($path, ['season_id' => $this->season->id, 'invoice_date' => now()->toDateString()] + $extra);
    }

    public function test_three_lifts_are_seeded_and_managed_from_settings(): void
    {
        $list = $this->actingAs($this->irrigation)->getJson('/api/irrigation-lifts')->assertOk();
        $this->assertSame(['L1', 'L2', 'L3'], collect($list->json('data'))->pluck('code')->all());

        $this->actingAs($this->irrigation)->postJson('/api/irrigation-lifts', ['code' => 'L4', 'name_bn' => '৪র্থ লিফট'])->assertForbidden();
        $id = $this->actingAs($this->admin)->postJson('/api/irrigation-lifts', ['code' => 'l4', 'name_bn' => '৪র্থ লিফট', 'name_en' => '4th Lift', 'sort_order' => 4])
            ->assertCreated()->json('id');
        $this->assertSame('L4', IrrigationLift::findOrFail($id)->code);
        $this->actingAs($this->admin)->postJson('/api/irrigation-lifts', ['code' => 'L4', 'name_bn' => 'আরেকটি'])->assertUnprocessable();

        // a lift in use can't be deleted, only made inactive; an unused one goes
        $this->land('১০১', 2);
        $this->actingAs($this->admin)->deleteJson('/api/irrigation-lifts/'.$this->lift[2]->id)->assertUnprocessable();
        $this->actingAs($this->admin)->putJson('/api/irrigation-lifts/'.$this->lift[2]->id, ['code' => 'L2', 'name_bn' => '২য় লিফট', 'is_active' => false])->assertOk();
        $this->actingAs($this->admin)->deleteJson("/api/irrigation-lifts/{$id}")->assertOk();
        $this->assertNull(IrrigationLift::find($id));
    }

    public function test_each_lift_bills_at_its_own_rate_and_plots_without_a_lift_are_held_back(): void
    {
        $this->rate(30, 1);
        $this->rate(35, 2);
        $a = $this->land('২০১', 1);
        $b = $this->land('২০২', 2);
        $c = $this->land('২০৩', 3);   // 3rd lift has no rate yet
        $d = $this->land('২০৪', null); // no lift at all

        $p = $this->bulk('/api/invoices/bulk/preview')->assertOk();
        $lines = collect($p->json('lines'))->keyBy('land_id');
        $this->assertEquals(990, $lines[$a->id]['amount']);   // 33 × 30
        $this->assertEquals(1155, $lines[$b->id]['amount']);  // 33 × 35
        $this->assertSame('no_rate', $lines[$c->id]['reason']);
        $this->assertSame('no_lift', $lines[$d->id]['reason']);
        $this->assertSame('২য় লিফট', $lines[$b->id]['lift']);
        $byLift = collect($p->json('summary.by_lift'))->keyBy('lift_id');
        $this->assertCount(2, $byLift);
        $this->assertEquals(35, $byLift[$this->lift[2]->id]['rate']);
        $this->assertEquals(1, $p->json('summary.skipped.no_lift'));

        // narrowing to plots without a lift shows only the held-back one
        $none = $this->bulk('/api/invoices/bulk/preview', ['lift_id' => 'none'])->assertOk();
        $this->assertSame([$d->id], collect($none->json('lines'))->pluck('land_id')->all());
        $two = $this->bulk('/api/invoices/bulk/preview', ['lift_id' => $this->lift[2]->id])->assertOk();
        $this->assertSame([$b->id], collect($two->json('lines'))->pluck('land_id')->all());

        $this->bulk('/api/invoices/bulk')->assertCreated();
        $inv = Invoice::where('land_id', $b->id)->firstOrFail();
        $this->assertSame($this->lift[2]->id, $inv->lift_id);
        $this->assertSame('২য় লিফট', $inv->snapshot['lift']);
        $this->assertEquals(35, (float) $inv->rate);
        $this->assertSame(2, Invoice::count());

        // a single invoice for the plot without a lift is refused with the reason
        $this->actingAs($this->irrigation)->postJson('/api/invoices', ['season_id' => $this->season->id, 'land_id' => $d->id, 'invoice_date' => now()->toDateString()])
            ->assertUnprocessable()->assertJsonPath('errors.land_id.0', 'জমিতে লিফট বসানো নেই');

        // the bill keeps the lift it was raised at even after the plot moves
        $this->actingAs($this->irrigation)->postJson('/api/irrigation-lifts/assign', ['land_ids' => [$b->id, $d->id], 'lift_id' => $this->lift[1]->id])
            ->assertOk()->assertJsonPath('count', 2);
        $this->assertSame($this->lift[1]->id, $b->fresh()->lift_id);
        $this->assertSame('২য় লিফট', $inv->fresh()->snapshot['lift']);
        $this->assertSame($this->lift[2]->id, $inv->fresh()->lift_id);

        // the lift summary report splits the season by lift
        $rows = collect($this->actingAs($this->admin)->getJson('/api/reports/lift_summary?season_id='.$this->season->id)->assertOk()->json('rows'))->keyBy('lift');
        $this->assertEquals(990, $rows['১ম লিফট']['billed']);
        $this->assertEquals(1155, $rows['২য় লিফট']['billed']);
    }

    public function test_seasons_without_lift_rates_bill_as_before(): void
    {
        $this->rate(10, null);
        $a = $this->land('৩০১', 2);
        $b = $this->land('৩০২', null);

        $lines = collect($this->bulk('/api/invoices/bulk/preview')->assertOk()->json('lines'))->keyBy('land_id');
        $this->assertTrue($lines[$a->id]['ok']);
        $this->assertTrue($lines[$b->id]['ok']);
        $this->assertEquals(330, $lines[$a->id]['amount']);
        $this->assertNull($lines[$a->id]['lift_id']); // priced without the lift, so the bill carries none

        // once a lift rate is in force the general rate no longer prices that source
        $this->rate(40, 1);
        $lines = collect($this->bulk('/api/invoices/bulk/preview')->assertOk()->json('lines'))->keyBy('land_id');
        $this->assertSame('no_rate', $lines[$a->id]['reason']);
        $this->assertSame('no_lift', $lines[$b->id]['reason']);
    }

    public function test_a_land_type_rate_within_a_lift_wins_over_the_lift_rate(): void
    {
        $high = LandType::orderBy('id')->firstOrFail();
        $low = LandType::orderBy('id')->skip(1)->firstOrFail();
        $this->rate(30, 1);
        $this->rate(45, 1, $high->id);
        $onHigh = $this->land('৪০১', 1, $high->id);
        $onLow = $this->land('৪০২', 1, $low->id);

        $lines = collect($this->bulk('/api/invoices/bulk/preview')->assertOk()->json('lines'))->keyBy('land_id');
        $this->assertEquals(33 * 45, $lines[$onHigh->id]['amount']);
        $this->assertEquals(33 * 30, $lines[$onLow->id]['amount']);
    }

    public function test_rate_list_pending_guard_and_copy_carry_the_lift(): void
    {
        $this->rate(30, 1);
        $this->rate(35, 2);
        $current = collect($this->actingAs($this->irrigation)->getJson('/api/irrigation-rates?season_id='.$this->season->id)->assertOk()->json('current'));
        $this->assertSame(['১ম লিফট', '২য় লিফট'], $current->pluck('lift')->all());

        // one pending change per lift: a second for L1 is refused, one for L3 is fine
        $base = ['season_id' => $this->season->id, 'irrigation_type_id' => $this->deep->id, 'rate' => 50, 'effective_from' => now()->toDateString()];
        $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', $base + ['lift_id' => $this->lift[1]->id])->assertCreated();
        $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', $base + ['lift_id' => $this->lift[1]->id])->assertUnprocessable();
        $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', $base + ['lift_id' => $this->lift[3]->id])->assertCreated();

        $all = collect($this->actingAs($this->irrigation)->getJson('/api/irrigation-rates/all?lift_id='.$this->lift[2]->id)->assertOk()->json('data'));
        $this->assertSame([35.0], $all->pluck('rate')->map(fn ($r) => (float) $r)->all());

        $next = Season::create(['name_bn' => 'আমন ২০২৬', 'code' => 'AMAN26', 'type' => 'kharif', 'crop' => 'ধান', 'start_date' => now()->addMonths(4)->toDateString(),
            'end_date' => now()->addMonths(7)->toDateString(), 'status' => 'planned']);
        $preview = collect($this->actingAs($this->irrigation)->getJson("/api/irrigation-rates/copy-preview?to={$next->id}&from={$this->season->id}")->assertOk()->json('rows'));
        $this->assertSame(['১ম লিফট', '২য় লিফট'], $preview->pluck('lift')->all());
        $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates/copy', [
            'from_season_id' => $this->season->id, 'to_season_id' => $next->id, 'effective_from' => $next->start_date->toDateString(),
            'rows' => $preview->map(fn ($r) => ['irrigation_type_id' => $r['irrigation_type_id'], 'lift_id' => $r['lift_id'], 'land_type_id' => $r['land_type_id'], 'rate' => $r['rate']])->all(),
        ])->assertCreated();
        $this->assertEqualsCanonicalizing([$this->lift[1]->id, $this->lift[2]->id], IrrigationRate::where('season_id', $next->id)->pluck('lift_id')->all());
    }

    public function test_land_list_filters_by_lift_and_shows_it(): void
    {
        $a = $this->land('৫০১', 1);
        $this->land('৫০২', null);
        $rows = $this->actingAs($this->irrigation)->getJson('/api/lands?lift_id='.$this->lift[1]->id)->assertOk()->json('data');
        $this->assertSame([$a->id], array_column($rows, 'id'));
        $this->assertSame('১ম লিফট', $rows[0]['lift']);
        $this->assertCount(1, $this->actingAs($this->irrigation)->getJson('/api/lands?lift_id=none')->assertOk()->json('data'));
        $this->assertNotEmpty($this->actingAs($this->irrigation)->getJson('/api/lands/meta')->assertOk()->json('lifts'));
    }
}
