<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Farmer;
use App\Models\FarmerDocument;
use App\Models\LandType;
use App\Models\MembershipApplication;
use App\Services\FarmerDuplicateService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class FarmerTest extends Phase2TestCase
{
    public function test_create_farmer_with_bangla_digits_and_generated_code(): void
    {
        $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload([
            'nid' => '১২৩৪৫৬৭৮৯০', 'mobile' => '০১৭১১২২৩৩৪৪',
        ]))->assertCreated()->assertJson(['farmer_code' => 'F-000001']);

        $this->assertDatabaseHas('farmers', ['nid' => '1234567890', 'mobile' => '01711223344']);
    }

    public function test_mouza_must_belong_to_selected_village(): void
    {
        $this->mouza->villages()->detach();

        $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload())
            ->assertStatus(422)->assertJsonValidationErrors('mouza_id');
    }

    public function test_same_nid_is_blocked(): void
    {
        $this->makeFarmer(['nid' => '1234567890']);

        $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload(['name_bn' => 'অন্য', 'nid' => '1234567890']))
            ->assertStatus(422)->assertJsonValidationErrors('nid');
    }

    public function test_similar_name_warns_until_confirmed(): void
    {
        $this->makeFarmer(['name_bn' => 'মোঃ আব্দুল করিম']);

        // "মোহাম্মদ" vs "মোঃ" prefix must still be caught.
        $payload = $this->farmerPayload(['name_bn' => 'মোহাম্মদ আব্দুল করিম']);
        $this->actingAs($this->officer)->postJson('/api/farmers', $payload)
            ->assertStatus(409)->assertJson(['code' => 'possible_duplicate'])->assertJsonCount(1, 'matches');

        $this->actingAs($this->officer)->postJson('/api/farmers', $payload + ['confirm_duplicate' => true])->assertCreated();
    }

    public function test_name_normalisation(): void
    {
        $n = fn ($s) => FarmerDuplicateService::normalizeName($s);
        $this->assertSame($n('মোঃ করিম'), $n('মোহাম্মদ  করিম'));
        $this->assertSame($n('মোছাঃ সালমা'), $n('মোসাম্মৎ সালমা'));
        $this->assertSame($n('Md. Karim'), $n('karim'));
        $this->assertNotSame($n('করিম'), $n('রহিম'));
    }

    public function test_duplicate_pairs_and_dismiss(): void
    {
        $a = $this->makeFarmer(['mobile' => '01711111111']);
        $b = $this->makeFarmer(['name_bn' => 'অন্য নাম', 'mobile' => '01711111111']);

        $this->actingAs($this->officer)->getJson('/api/farmers/duplicates')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.reasons', ['mobile']);

        $this->actingAs($this->officer)->postJson('/api/farmers-duplicates/dismiss', ['a' => $b->id, 'b' => $a->id])->assertOk();
        $this->actingAs($this->officer)->getJson('/api/farmers/duplicates')->assertJsonPath('total', 0);
    }

    public function test_merge_moves_documents_and_member_after_approval(): void
    {
        Storage::fake('local');
        $keep = $this->makeFarmer(['nid' => null]);
        $remove = $this->makeFarmer(['nid' => '9876543210', 'mobile' => '01899999999']);
        $this->actingAs($this->officer)->post("/api/farmers/{$remove->id}/documents", [
            'type' => 'nid_front', 'file' => UploadedFile::fake()->image('nid.jpg'),
        ])->assertCreated();

        $res = $this->actingAs($this->officer)->postJson('/api/farmers-merge', [
            'keep_id' => $keep->id, 'remove_id' => $remove->id, 'choices' => ['nid' => 'remove', 'mobile' => 'remove'],
        ])->assertCreated();

        // Rule is single-step (manager).
        $this->actingAs($this->manager)->postJson("/api/approvals/{$res->json('approval_id')}/decide", ['decision' => 'approve'])->assertOk();

        $keep->refresh();
        $this->assertSame('9876543210', $keep->nid);
        $this->assertSame('01899999999', $keep->mobile);
        $this->assertSame($keep->id, $remove->fresh()->merged_into_id);
        $this->assertSame(1, FarmerDocument::where('farmer_id', $keep->id)->count());
        $this->assertSame('approved', ApprovalRequest::find($res->json('approval_id'))->status);

        // Merged record disappears from the list.
        $this->actingAs($this->officer)->getJson('/api/farmers')->assertJsonPath('total', 1);
    }

    public function test_data_entry_cannot_delete_farmer(): void
    {
        $f = $this->makeFarmer();
        $this->actingAs($this->userWithRole('data_entry'))->deleteJson("/api/farmers/{$f->id}")->assertForbidden();
        $this->assertNotNull(Farmer::find($f->id));
    }

    public function test_new_household_makes_farmer_the_head(): void
    {
        $res = $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload(['new_household' => true]))->assertCreated();
        $f = Farmer::find($res->json('id'));

        $this->assertSame('self', $f->household_relation);
        $this->assertSame($f->id, $f->household->head_farmer_id);
        $this->assertSame('H-00001', $f->household->code);
    }

    public function test_list_summary_and_status_filters(): void
    {
        $admin = $this->userWithRole('super_admin');
        $member = $this->makeFarmer(['name_bn' => 'সদস্য', 'occupation' => 'farmer']);
        $pending = $this->makeFarmer(['name_bn' => 'আবেদনকারী', 'occupation' => 'business']);
        $this->makeFarmer(['name_bn' => 'সাধারণ']);

        $this->actingAs($admin)->postJson('/api/lands', [
            'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '1', 'dag_no' => '1', 'area' => 1, 'area_unit' => 'bigha',
            'land_type_id' => LandType::first()->id, 'status' => 'cultivated', 'owners' => [['farmer_id' => $member->id, 'share_percent' => 100]], 'owned_since' => '2015-01-01',
        ])->assertCreated();
        $res = $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($member, ['submit' => true]))->assertCreated();
        $this->approveBothSteps(MembershipApplication::find($res->json('id'))->approval_request_id);
        $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($pending, ['submit' => true]))->assertCreated();

        $this->actingAs($admin)->getJson('/api/farmers/summary')->assertOk()
            ->assertJson(['total' => 3, 'members' => 1, 'non_members' => 2, 'pending' => 1, 'land_acre' => 0.33]);

        $names = fn (array $q) => collect($this->actingAs($admin)->getJson('/api/farmers?'.http_build_query($q))->assertOk()->json('data'))->pluck('name_bn')->sort()->values()->all();
        $this->assertSame(['সদস্য'], $names(['member_status' => 'active']));
        $this->assertSame(['আবেদনকারী'], $names(['member_status' => 'pending']));
        $this->assertSame(['আবেদনকারী', 'সাধারণ'], $names(['member_status' => 'non_member']));
        $this->assertSame(['আবেদনকারী'], $names(['occupation' => 'business']));
        $this->assertSame(['সদস্য'], $names(['land_owner' => 'yes']));
        $this->assertSame(['আবেদনকারী', 'সাধারণ'], $names(['land_owner' => 'no']));

        $row = collect($this->actingAs($admin)->getJson('/api/farmers?search=সদস্য')->json('data'))->firstWhere('name_bn', 'সদস্য');
        $this->assertSame(0.33, $row['land_acre']);
        $this->assertFalse($row['pending_application']);
    }
}
