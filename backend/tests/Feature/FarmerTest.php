<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Farmer;
use App\Models\FarmerDocument;
use App\Models\FarmerFamilyMember;
use App\Models\LandType;
use App\Models\MembershipApplication;
use App\Models\User;
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

    public function test_merge_screen_data_transfer_choice_and_history(): void
    {
        $keep = $this->makeFarmer(['nid' => null]);
        $remove = $this->makeFarmer(['nid' => '9876543210', 'mobile' => '01899999999']);
        FarmerFamilyMember::create(['farmer_id' => $remove->id, 'name' => 'ছেলে', 'relation' => 'son']);

        // one side may be picked before the other
        $this->actingAs($this->officer)->getJson("/api/farmers/compare?b={$remove->id}")->assertOk()
            ->assertJsonPath('a', null)->assertJsonPath('b.related.land', 0)->assertJsonPath('b.related.membership', false);

        $res = $this->actingAs($this->officer)->postJson('/api/farmers-merge', [
            'keep_id' => $keep->id, 'remove_id' => $remove->id, 'choices' => [], 'transfer' => ['irrigation'],
        ])->assertCreated();
        $this->assertSame(['irrigation'], ApprovalRequest::find($res->json('approval_id'))->payload['transfer']);
        $this->actingAs($this->officer)->postJson('/api/farmers-merge', ['keep_id' => $keep->id, 'remove_id' => $remove->id, 'transfer' => ['bank']])
            ->assertStatus(422)->assertJsonValidationErrors('transfer.0');

        $this->actingAs($this->manager)->postJson("/api/approvals/{$res->json('approval_id')}/decide", ['decision' => 'approve'])->assertOk();
        $this->assertSame(1, FarmerFamilyMember::where('farmer_id', $keep->id)->count());
        $this->assertSame('merged', $remove->fresh()->delete_reason);

        $this->actingAs($this->officer)->getJson('/api/farmers-merge/history')->assertOk()
            ->assertJsonPath('data.0.status', 'approved')->assertJsonPath('data.0.keep.id', $keep->id)->assertJsonPath('data.0.remove.id', $remove->id);
        // the merged-away record shows on the deleted list, and cannot be restored
        $this->actingAs($this->officer)->getJson('/api/farmers-deleted')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.reason_code', 'merged')->assertJsonPath('data.0.merged_into.id', $keep->id);
    }

    public function test_super_admin_merge_needs_no_approval(): void
    {
        $admin = $this->userWithRole('super_admin');
        $keep = $this->makeFarmer(['nid' => null]);
        $remove = $this->makeFarmer();

        $res = $this->actingAs($admin)->postJson('/api/farmers-merge', ['keep_id' => $keep->id, 'remove_id' => $remove->id])
            ->assertCreated()->assertJsonPath('status', 'approved');
        $this->assertSame($keep->id, $remove->fresh()->merged_into_id);
        $this->assertSame(0, ApprovalRequest::find($res->json('approval_id'))->total_steps);

        // anyone else still waits for a manager
        $a = $this->makeFarmer(['nid' => null]);
        $b = $this->makeFarmer();
        $this->actingAs($this->officer)->postJson('/api/farmers-merge', ['keep_id' => $a->id, 'remove_id' => $b->id])->assertJsonPath('status', 'pending');
        $this->assertNull($b->fresh()->merged_into_id);

        // a merge a Super Admin sent before this rule is theirs to approve; other actions still need a second person
        $c = $this->makeFarmer(['nid' => null]);
        $d = $this->makeFarmer();
        $approvals = app(\App\Services\ApprovalService::class);
        $this->actingAs($this->officer);
        $pending = app(\App\Services\FarmerMergeService::class)->request($c, $d, []);
        $pending->update(['requested_by' => $admin->id]);
        $this->assertTrue($approvals->canAct($admin, $pending->fresh()));
        $this->actingAs($admin)->postJson("/api/approvals/{$pending->id}/decide", ['decision' => 'approve'])->assertOk();
        $this->assertSame($c->id, $d->fresh()->merged_into_id);
    }

    public function test_delete_with_reason_restore_and_purge(): void
    {
        $admin = $this->userWithRole('super_admin');
        $f = $this->makeFarmer();

        $this->actingAs($admin)->deleteJson("/api/farmers/{$f->id}", ['reason_code' => 'merged'])->assertStatus(422);
        $this->actingAs($admin)->deleteJson("/api/farmers/{$f->id}", ['reason_code' => 'wrong_data', 'reason' => 'ভুল নাম'])->assertOk();

        $this->actingAs($admin)->getJson('/api/farmers-deleted?reason=wrong_data')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.reason_code', 'wrong_data')->assertJsonPath('data.0.reason', 'ভুল নাম')->assertJsonPath('data.0.deleted_by.id', $admin->id);
        $this->actingAs($admin)->getJson('/api/farmers-deleted?reason=duplicate')->assertJsonPath('total', 0);
        $this->actingAs($admin)->getJson('/api/farmers-deleted/summary')
            ->assertJson(['total' => 1, 'restored' => 0, 'purged' => 0, 'this_month' => 1])->assertJsonPath('users.0.id', $admin->id);

        $this->actingAs($admin)->postJson("/api/farmers/{$f->id}/restore")->assertOk();
        $this->assertNull($f->fresh()->delete_reason);
        $this->actingAs($admin)->getJson('/api/farmers-deleted/summary')->assertJson(['total' => 0, 'restored' => 1]);

        // a live record cannot be purged; a deleted one with nothing attached can
        $this->actingAs($admin)->deleteJson("/api/farmers-deleted/{$f->id}")->assertNotFound();
        $this->actingAs($admin)->deleteJson("/api/farmers/{$f->id}", ['reason_code' => 'duplicate'])->assertOk();
        $this->actingAs($this->officer)->deleteJson("/api/farmers-deleted/{$f->id}")->assertForbidden();
        $this->actingAs($admin)->deleteJson("/api/farmers-deleted/{$f->id}")->assertOk();
        $this->assertNull(Farmer::withTrashed()->find($f->id));
        $this->actingAs($admin)->getJson('/api/farmers-deleted/summary')->assertJson(['total' => 0, 'purged' => 1]);
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

        // profile overview: land, membership and share figures; blocks follow permissions
        $overview = $this->actingAs($admin)->getJson("/api/farmers/{$member->id}/overview")->assertOk();
        $this->assertSame(0.33, $overview->json('land.acre'));
        $this->assertCount(1, $overview->json('land.records'));
        $this->assertNull($overview->json('land.records.0.cultivation')); // created without a cultivator
        $this->assertTrue($overview->json('membership.voter'));
        $this->assertSame(0, $overview->json('share.shares'));
        $this->assertNull($this->actingAs($admin)->getJson("/api/farmers/{$pending->id}/overview")->json('membership'));

        $viewer = User::factory()->create();
        $viewer->givePermissionTo('farmer.view');
        $limited = $this->actingAs($viewer)->getJson("/api/farmers/{$member->id}/overview")->assertOk();
        foreach (['land', 'irrigation', 'savings', 'share', 'loan'] as $block) {
            $this->assertNull($limited->json($block), $block);
        }
    }

    public function test_new_farmer_form_saves_family_documents_and_extras(): void
    {
        Storage::fake('local');
        $res = $this->actingAs($this->officer)->post('/api/farmers', $this->farmerPayload([
            'post_code' => '১৩৪০', 'blood_group' => 'B+', 'education_level' => 'secondary', 'farmer_type' => 'owner_cultivator',
            'family' => json_encode([['name' => 'রহিমা', 'relation' => 'spouse', 'occupation' => 'গৃহিণী', 'mobile' => '০১৭১১০০০২২২'], ['name' => 'করিম']]),
            'doc_nid_front' => UploadedFile::fake()->image('nid.jpg'),
        ]), ['Accept' => 'application/json'])->assertCreated();

        $farmer = $this->actingAs($this->officer)->getJson('/api/farmers/'.$res->json('id'))->assertOk();
        $farmer->assertJson(['post_code' => '1340', 'blood_group' => 'B+', 'education_level' => 'secondary', 'farmer_type' => 'owner_cultivator']);
        $this->assertSame(['রহিমা', 'করিম'], collect($farmer->json('family'))->pluck('name')->all());
        $this->assertSame('01711000222', $farmer->json('family.0.mobile'));
        $this->assertSame(['nid_front'], FarmerDocument::where('farmer_id', $res->json('id'))->pluck('type')->all());

        // editing replaces the family list
        $this->actingAs($this->officer)->post('/api/farmers/'.$res->json('id'), $this->farmerPayload(['family' => json_encode([['name' => 'নতুন']])]), ['Accept' => 'application/json'])->assertOk();
        $this->assertSame(['নতুন'], collect($this->actingAs($this->officer)->getJson('/api/farmers/'.$res->json('id'))->json('family'))->pluck('name')->all());

        $this->actingAs($this->officer)->post('/api/farmers', $this->farmerPayload(['name_bn' => 'অন্য', 'post_code' => '12']), ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonValidationErrors('post_code');
        $this->actingAs($this->officer)->post('/api/farmers', $this->farmerPayload(['name_bn' => 'অন্য', 'family' => json_encode([['name' => '', 'mobile' => '123']])]), ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonValidationErrors(['family.0.name', 'family.0.mobile']);
    }

    public function test_existing_member_number_needs_member_admin(): void
    {
        $payload = $this->farmerPayload(['legacy_member_no' => '৯৬', 'legacy_admitted_on' => '2010-01-01']);
        $this->actingAs($this->officer)->postJson('/api/farmers', $payload)->assertForbidden();
        $this->assertSame(0, Farmer::count());

        $admin = $this->userWithRole('super_admin');
        $id = $this->actingAs($admin)->postJson('/api/farmers', $payload)->assertCreated()->json('id');
        $member = Farmer::find($id)->member;
        $this->assertSame(96, $member->member_no);
        $this->assertTrue((bool) $member->is_legacy);

        // the same number cannot be used twice
        $this->actingAs($admin)->postJson('/api/farmers', $this->farmerPayload(['name_bn' => 'অন্য', 'legacy_member_no' => '96', 'legacy_admitted_on' => '2010-01-01']))
            ->assertStatus(422)->assertJsonValidationErrors('legacy_member_no');
    }

    public function test_email_is_optional_and_validated(): void
    {
        $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload(['email' => 'not-an-email']))
            ->assertStatus(422)->assertJsonValidationErrors('email');
        $res = $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload(['email' => 'karim@example.com']))->assertCreated();
        $this->actingAs($this->officer)->getJson('/api/farmers/'.$res->json('id'))->assertJsonPath('email', 'karim@example.com');
    }
}
