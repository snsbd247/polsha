<?php

namespace Tests\Feature;

use App\Models\Farmer;
use App\Models\ImportBatch;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Member;
use App\Models\Mouza;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

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

    public function test_land_profile_cards_documents_and_notes(): void
    {
        Storage::fake('local');
        $owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        $tenant = $this->makeFarmer(['name_bn' => 'বর্গাচাষি']);
        $officer = $this->officer();
        $id = $this->actingAs($officer)->postJson('/api/lands', $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]], [
            'cultivation' => ['farmer_id' => $tenant->id, 'type' => 'borga', 'start_date' => '2020-01-01'],
        ]))->assertCreated()->json('id');

        $this->actingAs($officer)->getJson("/api/lands/$id")->assertOk()
            ->assertJsonPath('owner_cards.0.id', $owner->id)->assertJsonPath('cultivator_card.id', $tenant->id)
            ->assertJsonPath('district', $this->mouza->upazila->district->name_bn)->assertJsonPath('irrigation.irrigated_decimal', 0)
            ->assertJsonCount(2, 'related_farmers');

        $doc = $this->actingAs($officer)->post("/api/lands/$id/documents", ['type' => 'khatian', 'file' => UploadedFile::fake()->create('k.pdf', 20, 'application/pdf')])
            ->assertCreated()->assertJsonMissingPath('path');
        $this->actingAs($officer)->post("/api/lands/$id/documents", ['type' => 'bad', 'file' => UploadedFile::fake()->create('k.pdf', 20, 'application/pdf')])
            ->assertStatus(422);
        $this->actingAs($officer)->get("/api/lands/$id/documents/{$doc->json('id')}")->assertOk();
        $note = $this->actingAs($officer)->postJson("/api/lands/$id/notes", ['note' => 'মাঠে যাচাই করা হয়েছে'])->assertCreated();
        $this->actingAs($officer)->getJson("/api/lands/$id")->assertJsonPath('documents.0.type', 'khatian')->assertJsonPath('notes.0.note', 'মাঠে যাচাই করা হয়েছে');

        // viewers may read but not change
        $viewer = $this->userWithRole('president');
        $this->actingAs($viewer)->postJson("/api/lands/$id/notes", ['note' => 'x'])->assertForbidden();
        $this->actingAs($officer)->deleteJson("/api/lands/$id/notes/{$note->json('id')}")->assertOk();
        $this->actingAs($officer)->deleteJson("/api/lands/$id/documents/{$doc->json('id')}")->assertOk();
        $this->actingAs($officer)->getJson("/api/lands/$id")->assertJsonCount(0, 'documents')->assertJsonCount(0, 'notes');
    }

    public function test_land_register_pages(): void
    {
        $owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        $tenant = $this->makeFarmer(['name_bn' => 'বর্গাচাষি']);
        $buyer = $this->makeFarmer(['name_bn' => 'ক্রেতা']);
        $officer = $this->officer();
        $id = $this->actingAs($officer)->postJson('/api/lands', $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]], [
            'cultivation' => ['farmer_id' => $tenant->id, 'type' => 'borga', 'start_date' => '2020-01-01', 'terms' => 'অর্ধেক'],
        ]))->assertCreated()->json('id');

        // owners and cultivators, one row per farmer
        $this->actingAs($officer)->getJson('/api/land-register/parties?role=owner')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $owner->id)->assertJsonPath('data.0.lands', 1)->assertJsonPath('data.0.also', false);
        $this->actingAs($officer)->getJson('/api/land-register/parties?role=cultivator&type=borga')->assertJsonPath('data.0.id', $tenant->id)->assertJsonPath('data.0.tenancy_count', 1);
        $this->actingAs($officer)->getJson('/api/land-register/parties/summary')->assertJson(['owners' => 1, 'cultivators' => 1, 'owner_cultivators' => 0, 'tenants' => 1, 'lands' => 1]);

        // borga list
        $this->actingAs($officer)->getJson('/api/land-register/cultivations?status=current')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.cultivator.id', $tenant->id)->assertJsonPath('data.0.owners.0.id', $owner->id)->assertJsonPath('data.0.terms', 'অর্ধেক');
        $this->actingAs($officer)->getJson('/api/land-register/cultivations/summary')->assertJson(['borga' => 1, 'lease' => 0, 'records' => 1, 'farmers' => 1, 'active' => 1, 'expired' => 0])
            ->assertJsonPath('owners.0.id', $owner->id)->assertJsonPath('cultivators.0.id', $tenant->id);
        // a contract past its agreed end, with the tenant still farming, shows as expired; the owner's name finds it
        \App\Models\LandCultivation::where('farmer_id', $tenant->id)->update(['contract_end' => now()->subDay()->toDateString(), 'share_percent' => 50]);
        $this->actingAs($officer)->getJson('/api/land-register/cultivations?status=expired&search=মালিক')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.status', 'expired')->assertJsonPath('data.0.share_percent', 50)->assertJsonPath('data.0.owners.0.id', $owner->id);
        $this->actingAs($officer)->getJson('/api/land-register/cultivations?status=active')->assertJsonPath('total', 0);
        $this->actingAs($officer)->getJson("/api/land-register/cultivations?owner_id={$tenant->id}")->assertJsonPath('total', 0);
        $this->actingAs($officer)->getJson("/api/land-register/cultivations?cultivator_id={$tenant->id}&owner_id={$owner->id}")->assertJsonPath('total', 1);

        // a sale shows as one transfer with who handed over and who received
        $this->actingAs($officer)->postJson("/api/lands/$id/transfer", ['owners' => [['farmer_id' => $buyer->id, 'share_percent' => 100]], 'effective_date' => now()->toDateString(), 'remarks' => 'দলিল ১২'])->assertOk();
        $this->actingAs($officer)->getJson('/api/land-register/transfers')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.from.0.id', $owner->id)->assertJsonPath('data.0.to.0.id', $buyer->id)->assertJsonPath('data.0.remarks', 'দলিল ১২');
        $this->actingAs($officer)->getJson('/api/land-register/transfers/summary')->assertJson(['total' => 1, 'this_year' => 1]);

        // change log across plots, and the overview figures
        $this->actingAs($officer)->getJson('/api/land-register/history?action=ownership_transfer')->assertJsonPath('total', 1)->assertJsonPath('data.0.land_id', $id);
        $this->actingAs($officer)->getJson('/api/land-register/history/summary')->assertJson(['transfers' => 1]);
        $this->actingAs($officer)->getJson('/api/land-register/overview')->assertOk()->assertJson(['lands' => 1])->assertJsonPath('by_mouza.0.id', $this->mouza->id);
        $this->actingAs($this->userWithRole('loan_officer'))->getJson('/api/land-register/history')->assertForbidden();
    }

    public function test_land_list_summary_and_filters(): void
    {
        $a = $this->makeFarmer(['name_bn' => 'এক']);
        $b = $this->makeFarmer(['name_bn' => 'দুই']);
        $officer = $this->officer();
        // 1 bigha = 33 decimals (0.33 acre), owned by one farmer
        $this->actingAs($officer)->postJson('/api/lands', $this->landPayload([['farmer_id' => $a->id, 'share_percent' => 100]]))->assertCreated();
        // 3 bigha = 99 decimals, owned jointly
        $this->actingAs($officer)->postJson('/api/lands', $this->landPayload([['farmer_id' => $a->id, 'share_percent' => 50], ['farmer_id' => $b->id, 'share_percent' => 50]],
            ['dag_no' => '2000', 'area' => 3]))->assertCreated();

        $this->actingAs($officer)->getJson('/api/lands/summary')->assertOk()->assertJson(['lands' => 2, 'owners' => 2, 'mouzas' => 1])->assertJsonPath('area_decimal', 132);
        $this->actingAs($officer)->getJson('/api/lands?ownership=joint')->assertJsonPath('total', 1)->assertJsonPath('data.0.dag_no', '2000');
        $this->actingAs($officer)->getJson('/api/lands?ownership=single')->assertJsonPath('total', 1);
        $this->actingAs($officer)->getJson('/api/lands?area_min=0.5')->assertJsonPath('total', 1);
        $this->actingAs($officer)->getJson('/api/lands?area_max=0.5')->assertJsonPath('total', 1)->assertJsonPath('data.0.owners.0.photo_url', null);
        $this->actingAs($officer)->getJson('/api/lands?district_id='.$this->mouza->upazila->district_id)->assertJsonPath('total', 2);
        $this->actingAs($officer)->getJson('/api/lands?district_id=999999')->assertJsonPath('total', 0);
    }

    public function test_land_location_details_and_irrigable_area(): void
    {
        $owner = $this->makeFarmer();
        $officer = $this->officer();
        $village = $this->mouza->villages()->first();
        $payload = $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]], [
            'area' => 2.5, 'area_unit' => 'acre', 'irrigable_area' => 3, 'village_id' => $village->id,
            'latitude' => 24.0023, 'longitude' => 90.4267, 'location_note' => 'রাস্তার পূর্ব পাশে',
        ]);
        $id = $this->actingAs($officer)->postJson('/api/lands', $payload)->assertCreated()->json('id');

        // irrigable area never exceeds the plot
        $this->actingAs($officer)->getJson("/api/lands/$id")->assertOk()
            ->assertJsonPath('village_id', $village->id)->assertJsonPath('latitude', 24.0023)->assertJsonPath('longitude', 90.4267)
            ->assertJsonPath('location_note', 'রাস্তার পূর্ব পাশে')->assertJsonPath('irrigable_decimal', 250);

        // a village outside the mouza, or impossible coordinates, are refused
        $other = \App\Models\Village::create(['union_id' => $this->mouza->union_id, 'name_bn' => 'অন্য গ্রাম']);
        $this->actingAs($officer)->putJson("/api/lands/$id", ['village_id' => $other->id, 'latitude' => 120] + $payload)
            ->assertStatus(422)->assertJsonValidationErrors(['village_id', 'latitude']);

        $this->actingAs($officer)->getJson('/api/lands/summary')->assertJsonPath('next_code', 'L-000002');
        $this->actingAs($officer)->getJson("/api/mouzas/{$this->mouza->id}")->assertOk()->assertJsonPath('patwaris', []);
    }

    public function test_owner_cultivator_counts_and_search_by_mobile(): void
    {
        $owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        $tenant = $this->makeFarmer(['name_bn' => 'বর্গাচাষি', 'mobile' => '01755500011']);
        $officer = $this->officer();
        $this->actingAs($officer)->postJson('/api/lands', $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]], [
            'cultivation' => ['farmer_id' => $tenant->id, 'type' => 'borga', 'start_date' => '2020-01-01'],
        ]))->assertCreated();

        $this->actingAs($officer)->getJson('/api/lands/summary')->assertJson(['lands' => 1, 'owners' => 1, 'cultivators' => 1, 'borga' => 1]);
        $this->actingAs($officer)->getJson('/api/lands?search=০১৭৫৫৫০০০১১')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.cultivation.farmer_id', $tenant->id)->assertJsonPath('data.0.cultivation.photo_url', null);
        $this->actingAs($officer)->getJson('/api/lands?search=01999999999')->assertJsonPath('total', 0);
    }

    public function test_land_transfer_draft_approval_and_partial_share(): void
    {
        $seller = $this->makeFarmer(['name_bn' => 'বিক্রেতা']);
        $buyer = $this->makeFarmer(['name_bn' => 'ক্রেতা']);
        $officer = $this->officer();
        $landId = $this->actingAs($officer)->postJson('/api/lands', $this->landPayload([['farmer_id' => $seller->id, 'share_percent' => 100]]))->json('id');
        $base = ['land_id' => $landId, 'from_farmer_id' => $seller->id, 'to_farmer_id' => $buyer->id, 'reason' => 'sale', 'transfer_date' => now()->toDateString(), 'amount' => 500000];

        // a partial transfer of 40%: saved as a draft first, nothing changes yet
        $draft = $this->actingAs($officer)->postJson('/api/land-transfers', $base + ['type' => 'partial', 'share_percent' => 40])
            ->assertCreated()->assertJsonPath('status', 'draft')->assertJsonPath('share_percent', 40);
        $this->assertStringStartsWith('LT-'.date('Y').'-', $draft->json('transfer_no'));
        $this->actingAs($officer)->getJson('/api/land-transfers')->assertJsonPath('total', 1);

        // more than the seller owns is refused when sent
        $this->actingAs($officer)->putJson("/api/land-transfers/{$draft->json('id')}", $base + ['type' => 'partial', 'share_percent' => 120, 'submit' => true])
            ->assertStatus(422)->assertJsonValidationErrors('share_percent');

        $sent = $this->actingAs($officer)->putJson("/api/land-transfers/{$draft->json('id')}", $base + ['type' => 'partial', 'share_percent' => 40, 'submit' => true])
            ->assertOk()->assertJsonPath('status', 'pending');
        $this->assertSame([100.0], Land::find($landId)->owners()->pluck('share_percent')->map(fn ($s) => (float) $s)->all());
        // a sent transfer can no longer be edited
        $this->actingAs($officer)->putJson("/api/land-transfers/{$draft->json('id')}", $base + ['type' => 'full'])->assertStatus(422);

        $this->actingAs($this->manager)->postJson("/api/approvals/{$sent->json('approval_id')}/decide", ['decision' => 'approve'])->assertOk();
        $owners = Land::find($landId)->owners()->get()->mapWithKeys(fn ($o) => [$o->farmer_id => (float) $o->share_percent])->all();
        $this->assertSame([$seller->id => 60.0, $buyer->id => 40.0], $owners);
        $this->assertSame('approved', \App\Models\LandTransfer::find($draft->json('id'))->status);
        $this->actingAs($officer)->getJson('/api/land-register/transfers')->assertJsonPath('total', 1);

        // a Super Admin's full transfer (the seller's remaining 60%) applies at once
        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->postJson('/api/land-transfers', $base + ['type' => 'full', 'reason' => 'inheritance', 'submit' => true])
            ->assertCreated()->assertJsonPath('status', 'approved')->assertJsonPath('share_percent', 60);
        $this->assertSame([$buyer->id => 100.0], Land::find($landId)->owners()->get()->mapWithKeys(fn ($o) => [$o->farmer_id => (float) $o->share_percent])->all());

        // the transfer list: both, newest first, filterable; summary by status
        $this->actingAs($officer)->getJson('/api/land-transfers')->assertJsonPath('total', 2)->assertJsonPath('data.0.type', 'full')
            ->assertJsonPath('data.0.from_farmer.id', $seller->id)->assertJsonPath('data.0.to_photo_url', null);
        $this->actingAs($officer)->getJson('/api/land-transfers?type=partial&search=ক্রেতা')->assertJsonPath('total', 1)->assertJsonPath('data.0.reason', 'sale');
        $this->actingAs($officer)->getJson('/api/land-transfers?status=pending')->assertJsonPath('total', 0);
        $this->actingAs($officer)->getJson('/api/land-transfers-summary')->assertJson(['total' => 2, 'approved' => 2, 'pending' => 0, 'rejected' => 0]);

        // someone who no longer owns the plot cannot give it away
        $this->actingAs($officer)->postJson('/api/land-transfers', $base + ['type' => 'full'])->assertStatus(422)->assertJsonValidationErrors('from_farmer_id');
        $this->actingAs($officer)->postJson('/api/land-transfers', array_merge($base, ['type' => 'full', 'from_farmer_id' => $buyer->id]))->assertStatus(422)->assertJsonValidationErrors('to_farmer_id');
    }

    public function test_owner_shares_must_total_100(): void
    {
        $a = $this->makeFarmer(['name_bn' => 'ক']);
        $b = $this->makeFarmer(['name_bn' => 'খ']);
        $this->actingAs($this->officer())->postJson('/api/lands', $this->landPayload([
            ['farmer_id' => $a->id, 'share_percent' => 50], ['farmer_id' => $b->id, 'share_percent' => 40],
        ]))->assertStatus(422)->assertJsonValidationErrors('owners');
    }

    public function test_land_history_activity_list(): void
    {
        $owner = $this->makeFarmer(['name_bn' => 'পুরোনো মালিক']);
        $tenant = $this->makeFarmer(['name_bn' => 'বর্গাদার']);
        $buyer = $this->makeFarmer(['name_bn' => 'নতুন ক্রেতা']);
        $officer = $this->officer();
        $landId = $this->actingAs($officer)->postJson('/api/lands', $this->landPayload([['farmer_id' => $owner->id, 'share_percent' => 100]], [
            'cultivation' => ['farmer_id' => $tenant->id, 'type' => 'borga', 'share_percent' => 60, 'start_date' => '2024-01-01'],
        ]))->assertCreated()->json('id');

        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->postJson('/api/land-transfers', ['land_id' => $landId, 'from_farmer_id' => $owner->id, 'to_farmer_id' => $buyer->id,
            'type' => 'full', 'reason' => 'sale', 'transfer_date' => now()->toDateString(), 'submit' => true])->assertCreated()->assertJsonPath('status', 'approved');

        // the buyer's ownership shows once, as the transfer
        $s = $this->actingAs($officer)->getJson('/api/land-register/activities/summary')->assertOk()
            ->assertJsonPath('ownership', 1)->assertJsonPath('transfers', 1)->assertJsonPath('borga', 1);
        $this->assertArrayHasKey('irrigation', $s->json('kinds'));

        $this->actingAs($officer)->getJson('/api/land-register/activities?kind=transfer')->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.person.id', $buyer->id)->assertJsonPath('data.0.by.id', $admin->id)
            ->assertJsonPath('data.0.land.id', $landId);
        $this->assertStringStartsWith('LT-', $this->actingAs($officer)->getJson('/api/land-register/activities?kind=transfer')->json('data.0.ref'));

        $this->actingAs($officer)->getJson('/api/land-register/activities?kind=borga_agreement')->assertJsonPath('data.0.detail2', '(অংশ: 60%)')
            ->assertJsonPath('data.0.person.id', $tenant->id);
        $this->actingAs($officer)->getJson('/api/land-register/activities?search='.urlencode('নতুন ক্রেতা'))->assertJsonPath('total', 1);
        $this->actingAs($officer)->getJson("/api/land-register/activities?user_id={$officer->id}&kind=land_created")->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.person.id', $owner->id);
        $this->actingAs($officer)->getJson('/api/land-register/activities?from=2099-01-01')->assertJsonPath('total', 0);
        $this->actingAs($officer)->get('/api/land-register/activities?export=csv')->assertOk();
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
        $other = Mouza::create(['union_id' => $this->mouza->union_id, 'upazila_id' => $this->mouza->upazila_id, 'name_bn' => 'অন্য', 'jl_no' => '99']);
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
