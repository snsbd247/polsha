<?php

namespace Tests\Feature;

use App\Models\Farmer;
use App\Models\ImportBatch;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Member;
use Illuminate\Http\UploadedFile;

class LandTest extends Phase2TestCase
{
    private function officer()
    {
        $u = $this->userWithRole('irrigation_officer');
        $u->givePermissionTo(['land.delete', 'import.create', 'import.view', 'farmer.create']);

        return $u;
    }

    private function landPayload(array $owners, array $overrides = []): array
    {
        return array_merge([
            'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '১৪৫', 'dag_no' => '১০২৩',
            'area' => 1, 'area_unit' => 'bigha', 'land_type_id' => LandType::first()->id, 'status' => 'cultivated',
            'owners' => $owners, 'owned_since' => '2015-01-01',
        ], $overrides);
    }

    public function test_create_land_converts_units_and_bangla_digits(): void
    {
        $owner = $this->makeFarmer();
        $res = $this->actingAs($this->officer())->postJson('/api/lands', $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]]))
            ->assertCreated()->assertJson(['land_code' => 'L-000001']);

        $land = Land::find($res->json('id'));
        $this->assertSame('33.0000', $land->area_decimal); // 1 bigha = 33 decimals by default
        $this->assertSame(['145', '1023'], [$land->khatian_no, $land->dag_no]);
    }

    public function test_owner_shares_must_total_100(): void
    {
        $a = $this->makeFarmer(['name_bn' => 'ক']);
        $b = $this->makeFarmer(['name_bn' => 'খ']);
        $this->actingAs($this->officer())->postJson('/api/lands', $this->landPayload([
            ['farmer_id' => $a->id, 'share_percent' => 50], ['farmer_id' => $b->id, 'share_percent' => 40],
        ]))->assertStatus(422)->assertJsonValidationErrors('owners');
    }

    public function test_own_and_borga_cultivation_rules(): void
    {
        $owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        $tenant = $this->makeFarmer(['name_bn' => 'বর্গাচাষি']);
        $user = $this->officer();
        $owners = [['farmer_id' => $owner->id, 'share_percent' => 100]];

        // "Own" farming by a non-owner is refused.
        $this->actingAs($user)->postJson('/api/lands', $this->landPayload($owners, [
            'cultivation' => ['farmer_id' => $tenant->id, 'type' => 'own', 'start_date' => '2024-01-01'],
        ]))->assertStatus(422)->assertJsonValidationErrors('cultivation.type');

        // An owner can't be a borga tenant on their own land.
        $this->actingAs($user)->postJson('/api/lands', $this->landPayload($owners, [
            'cultivation' => ['farmer_id' => $owner->id, 'type' => 'borga', 'start_date' => '2024-01-01'],
        ]))->assertStatus(422)->assertJsonValidationErrors('cultivation.type');

        $this->actingAs($user)->postJson('/api/lands', $this->landPayload($owners, [
            'cultivation' => ['farmer_id' => $tenant->id, 'type' => 'borga', 'terms' => 'ফসলের অর্ধেক', 'start_date' => '2024-01-01'],
        ]))->assertCreated();
    }

    public function test_transfer_keeps_history_and_closes_own_cultivation(): void
    {
        $seller = $this->makeFarmer(['name_bn' => 'বিক্রেতা']);
        $buyer = $this->makeFarmer(['name_bn' => 'ক্রেতা']);
        $user = $this->officer();
        $res = $this->actingAs($user)->postJson('/api/lands', $this->landPayload([['farmer_id' => $seller->id, 'share_percent' => 100]], [
            'cultivation' => ['farmer_id' => $seller->id, 'type' => 'own', 'start_date' => '2015-01-01'],
        ]))->assertCreated();
        $id = $res->json('id');

        $this->actingAs($user)->postJson("/api/lands/{$id}/transfer", [
            'owners' => [['farmer_id' => $buyer->id, 'share_percent' => 100]], 'effective_date' => '2025-06-01', 'remarks' => 'দলিল ১২৩৪',
        ])->assertOk()->assertJsonPath('owners.0.farmer_id', $buyer->id)->assertJsonPath('cultivation', null);

        $land = Land::find($id);
        $this->assertSame(2, $land->ownerHistory()->count());
        $this->assertSame('2025-06-01', $land->ownerHistory()->whereNotNull('end_date')->first()->end_date->toDateString());

        // Back-dating before the current ownership is refused.
        $this->actingAs($user)->postJson("/api/lands/{$id}/transfer", [
            'owners' => [['farmer_id' => $seller->id, 'share_percent' => 100]], 'effective_date' => '2020-01-01',
        ])->assertStatus(422)->assertJsonValidationErrors('effective_date');
    }

    public function test_borga_tenant_who_buys_in_becomes_own_cultivator(): void
    {
        $owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        $tenant = $this->makeFarmer(['name_bn' => 'বর্গাচাষি']);
        $user = $this->officer();
        $id = $this->actingAs($user)->postJson('/api/lands', $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]], [
            'cultivation' => ['farmer_id' => $tenant->id, 'type' => 'borga', 'start_date' => '2020-01-01'],
        ]))->assertCreated()->json('id');

        $this->actingAs($user)->postJson("/api/lands/{$id}/transfer", [
            'owners' => [['farmer_id' => $owner->id, 'share_percent' => 50], ['farmer_id' => $tenant->id, 'share_percent' => 50]],
            'effective_date' => '2025-01-01',
        ])->assertOk()->assertJsonPath('cultivation.type', 'own')->assertJsonPath('cultivation.farmer_id', $tenant->id);

        $this->assertSame(2, Land::find($id)->cultivationHistory()->count());
    }

    public function test_duplicate_dag_warns_until_confirmed(): void
    {
        $owner = $this->makeFarmer();
        $user = $this->officer();
        $payload = $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]]);
        $this->actingAs($user)->postJson('/api/lands', $payload)->assertCreated();

        $this->actingAs($user)->postJson('/api/lands', $payload)->assertStatus(409)->assertJson(['code' => 'possible_duplicate']);
        $this->actingAs($user)->postJson('/api/lands', $payload + ['confirm_duplicate' => true])->assertCreated();
    }

    public function test_data_health_finds_problems(): void
    {
        $owner = $this->makeFarmer();
        $user = $this->officer();
        $this->actingAs($user)->postJson('/api/lands', $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]]))->assertCreated();
        // A farmer whose mouza isn't linked to their village.
        $other = \App\Models\Mouza::create(['union_id' => $this->mouza->union_id, 'upazila_id' => $this->mouza->upazila_id, 'name_bn' => 'অন্য', 'jl_no' => '99']);
        Farmer::create($this->farmerPayload(['name_bn' => 'ভুল মৌজা', 'mouza_id' => $other->id]) + ['farmer_code' => 'F-X']);

        $summary = collect($this->actingAs($user)->getJson('/api/data-health/summary')->assertOk()->json())->keyBy('key');
        $this->assertSame(1, $summary['land_no_cultivator']['count']);
        $this->assertSame(1, $summary['farmer_wrong_mouza']['count']);
        $this->assertSame(1, $summary['mouza_no_village']['count']);
        $this->assertSame(0, $summary['land_share_mismatch']['count']);

        $this->actingAs($user)->getJson('/api/data-health/items/farmer_wrong_mouza')->assertJsonPath('data.0.title', 'ভুল মৌজা');
        $row = collect($this->actingAs($user)->getJson('/api/data-health/mouzas')->json())->firstWhere('id', $this->mouza->id);
        $this->assertEquals([1, 33], [$row['land_count'], $row['area_decimal']]);
    }

    public function test_csv_import_of_farmers_then_lands(): void
    {
        $user = $this->officer();
        $user->givePermissionTo('member.admin');

        $farmers = "\xEF\xBB\xBFনাম,পিতার নাম,লিঙ্গ,NID,মোবাইল,উপজেলা,ইউনিয়ন,গ্রাম,মৌজা JL,সদস্য নং,ভর্তির তারিখ\n"
            ."করিম,রহিম,পুরুষ,১৯৮৫১২৩৪৫৬,1711223344,সাভার,আশুলিয়া,পলাশবাড়ী,১২,৯৬,১/১/২০১০\n"
            ."সেলিম,জলিল,পুরুষ,,,সাভার,আশুলিয়া,পলাশবাড়ী,12,,\n"
            ."ভুল,ভুল,?,,,সাভার,আশুলিয়া,নেই-গ্রাম,12,,\n";
        $preview = $this->actingAs($user)->post('/api/imports/farmers/preview', ['file' => UploadedFile::fake()->createWithContent('f.csv', $farmers)], ['Accept' => 'application/json'])
            ->assertOk()->assertJson(['total' => 3, 'valid' => 2]);
        $this->assertSame(4, $preview->json('errors.0.line'));

        $this->actingAs($user)->postJson('/api/imports/commit', ['token' => $preview->json('token')])->assertOk()->assertJson(['imported_rows' => 2]);
        $karim = Farmer::where('name_bn', 'করিম')->first();
        $this->assertSame('01711223344', $karim->mobile); // leading zero restored
        $this->assertSame(96, Member::where('farmer_id', $karim->id)->value('member_no'));

        // Owners by member number and NID; cultivator by farmer code; area with unit.
        $selim = Farmer::where('name_bn', 'সেলিম')->first();
        $lands = "উপজেলা,মৌজা JL,খতিয়ান,দাগ,পরিমাণ,জমির ধরন,মালিক,চাষি,চাষের ধরন\n"
            ."সাভার,12,145,1023,১.৫ একর,উঁচু জমি,96,{$selim->farmer_code},বর্গা\n"
            ."সাভার,12,146,1024,20,উঁচু জমি,1985123456:60;{$selim->farmer_code}:40,,\n";
        $preview = $this->actingAs($user)->post('/api/imports/lands/preview', ['file' => UploadedFile::fake()->createWithContent('l.csv', $lands)], ['Accept' => 'application/json'])
            ->assertOk()->assertJson(['total' => 2, 'valid' => 2]);
        $this->actingAs($user)->postJson('/api/imports/commit', ['token' => $preview->json('token')])->assertOk()->assertJson(['imported_rows' => 2]);

        $first = Land::where('dag_no', '1023')->first();
        $this->assertSame('150.0000', $first->area_decimal);
        $this->assertSame('borga', $first->cultivation->type);
        $this->assertSame(2, Land::where('dag_no', '1024')->first()->owners()->count());
        $this->assertSame(2, ImportBatch::count());
    }
}
