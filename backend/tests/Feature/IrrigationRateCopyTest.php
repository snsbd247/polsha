<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\IrrigationRate;
use App\Models\IrrigationType;
use App\Models\Season;
use App\Models\User;

/** A new season takes the last season's rates in one go, approved together. */
class IrrigationRateCopyTest extends Phase2TestCase
{
    private User $irr;

    protected function setUp(): void
    {
        parent::setUp();
        $this->irr = $this->userWithRole('irrigation_officer');
    }

    private function season(string $name, string $code, string $start, string $end): Season
    {
        return Season::findOrFail($this->actingAs($this->irr)->postJson('/api/seasons', [
            'name_bn' => $name, 'code' => $code, 'type' => 'rabi', 'crop' => 'ধান', 'start_date' => $start, 'end_date' => $end, 'status' => 'open',
        ])->assertCreated()->json('id'));
    }

    public function test_rates_copy_from_the_last_season_with_one_approval(): void
    {
        [$deep, $shallow] = IrrigationType::where('is_active', true)->orderBy('id')->limit(2)->get()->all();
        $old = $this->season('বোরো ২০২৫', 'BORO25', '2025-01-01', '2025-04-30');
        foreach ([[$deep, 10], [$shallow, 8]] as [$type, $rate]) {
            $r = $this->actingAs($this->irr)->postJson('/api/irrigation-rates', ['season_id' => $old->id, 'irrigation_type_id' => $type->id, 'rate' => $rate, 'effective_from' => '2025-01-01'])->assertCreated();
            $this->actingAs($this->manager)->postJson("/api/approvals/{$r->json('approval_request_id')}/decide", ['decision' => 'approve'])->assertOk();
        }
        $new = $this->season('বোরো ২০২৬', 'BORO26', '2026-01-01', '2026-04-30');

        // the season before is found by itself
        $p = $this->actingAs($this->irr)->getJson("/api/irrigation-rates/copy-preview?to={$new->id}")->assertOk();
        $this->assertSame($old->id, $p->json('from.id'));
        $this->assertCount(2, $p->json('rows'));

        // copy with the deep tubewell rate raised to 12
        $rows = collect($p->json('rows'))->map(fn ($r) => ['irrigation_type_id' => $r['irrigation_type_id'], 'land_type_id' => $r['land_type_id'], 'rate' => $r['irrigation_type_id'] === $deep->id ? 12 : $r['rate']])->all();
        $this->actingAs($this->irr)->postJson('/api/irrigation-rates/copy', ['from_season_id' => $old->id, 'to_season_id' => $new->id, 'effective_from' => '2026-01-01', 'rows' => $rows])->assertCreated()->assertJsonPath('count', 2);

        $rates = IrrigationRate::where('season_id', $new->id)->get();
        $this->assertSame(['pending'], $rates->pluck('status')->unique()->values()->all());
        $this->assertSame(1, $rates->pluck('approval_request_id')->unique()->count());
        $req = ApprovalRequest::findOrFail($rates->first()->approval_request_id);
        $this->assertSame('irrigation.rate_batch', $req->action_key);

        // nothing is copied twice
        $this->assertTrue(collect($this->actingAs($this->irr)->getJson("/api/irrigation-rates/copy-preview?to={$new->id}")->json('rows'))->every(fn ($r) => $r['exists']));
        $this->actingAs($this->irr)->postJson('/api/irrigation-rates/copy', ['from_season_id' => $old->id, 'to_season_id' => $new->id, 'effective_from' => '2026-01-01', 'rows' => $rows])->assertStatus(422);

        // one approval puts both live
        $this->actingAs($this->manager)->postJson("/api/approvals/{$req->id}/decide", ['decision' => 'approve'])->assertOk();
        $this->assertSame(['approved'], IrrigationRate::where('season_id', $new->id)->pluck('status')->unique()->values()->all());
        $this->assertEquals(12, (float) IrrigationRate::where('season_id', $new->id)->where('irrigation_type_id', $deep->id)->value('rate'));
    }
}
