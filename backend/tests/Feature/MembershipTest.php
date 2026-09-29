<?php

namespace Tests\Feature;

use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MembershipApplication;
use App\Models\Mouza;
use App\Models\Patwari;
use App\Models\Sequence;
use App\Models\VoterListItem;
use App\Services\SettingService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class MembershipTest extends Phase2TestCase
{
    public function test_full_two_step_admission_flow(): void
    {
        $farmer = $this->makeFarmer();

        $res = $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer, ['submit' => true]))
            ->assertCreated()->assertJson(['status' => 'pending']);
        $app = MembershipApplication::find($res->json('id'));
        $this->assertStringStartsWith('MA-'.date('Y').'-', $app->application_no);

        // After the manager only: still pending, no member yet.
        $this->actingAs($this->manager)->postJson("/api/approvals/{$app->approval_request_id}/decide", ['decision' => 'approve'])->assertOk();
        $this->assertNull($farmer->member()->first());

        $this->actingAs($this->president)->postJson("/api/approvals/{$app->approval_request_id}/decide", ['decision' => 'approve'])->assertOk();

        $member = $farmer->member()->first();
        $this->assertNotNull($member);
        $this->assertSame(1, $member->member_no);
        $this->assertSame('approved', $app->fresh()->status);
        $this->assertSame(1, $member->nominees()->count());
        $this->assertSame('admit', $member->history()->first()->action);
    }

    public function test_new_member_number_continues_after_legacy_numbers(): void
    {
        $admin = $this->userWithRole('admin');
        $admin->givePermissionTo('member.admin');

        foreach ([96, 230, 5876, 10001] as $no) {
            $this->actingAs($admin)->postJson('/api/members/legacy', [
                'farmer_id' => $this->makeFarmer(['name_bn' => "পুরোনো $no"])->id,
                'member_no' => (string) $no, 'admitted_on' => '2010-01-01',
            ])->assertCreated();
        }
        $this->assertSame(10002, Sequence::where('key', 'member')->value('next_value'));
        // an old-register member has savings and share like any member, opened from the admission date
        $old = Member::where('member_no', 96)->first();
        $this->assertSame(['savings', 'share'], $old->accounts()->orderBy('kind')->pluck('kind')->all());
        $this->assertSame('2010-01-01', $old->accounts()->first()->opened_on->toDateString());
        // a farmer without a member number has none (accounts belong to members only)
        $this->assertSame(4 * 2, MemberAccount::count());

        // Duplicate legacy number is refused.
        $this->actingAs($admin)->postJson('/api/members/legacy', [
            'farmer_id' => $this->makeFarmer(['name_bn' => 'আরেকজন'])->id, 'member_no' => '২৩০', 'admitted_on' => '2010-01-01',
        ])->assertStatus(422)->assertJsonValidationErrors('member_no');

        $farmer = $this->makeFarmer(['name_bn' => 'নতুন সদস্য']);
        $res = $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer, ['submit' => true]));
        $this->approveBothSteps(MembershipApplication::find($res->json('id'))->approval_request_id);

        $this->assertSame(10002, $farmer->member()->first()->member_no);
    }

    public function test_fee_override_needs_reason_and_nominees_must_total_100(): void
    {
        SettingService::setMany(['admission_fee' => 100]);
        $farmer = $this->makeFarmer();

        $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer, ['admission_fee' => 50]))
            ->assertStatus(422)->assertJsonValidationErrors('fee_override_reason');

        $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer, [
            'admission_fee' => 100,
            'nominees' => [['name' => 'ক', 'relation' => 'পুত্র', 'share_percent' => 60], ['name' => 'খ', 'relation' => 'কন্যা', 'share_percent' => 30]],
        ]))->assertStatus(422)->assertJsonValidationErrors('nominees');

        $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer, [
            'admission_fee' => 50, 'fee_override_reason' => 'দরিদ্র কৃষক — বোর্ডের সিদ্ধান্ত',
        ]))->assertCreated()->assertJson(['default_fee' => '100.00', 'admission_fee' => '50.00']);
    }

    public function test_only_one_pending_application_per_farmer_and_members_cannot_apply(): void
    {
        $farmer = $this->makeFarmer();
        $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer, ['submit' => true]))->assertCreated();

        $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer))
            ->assertStatus(422)->assertJsonValidationErrors('farmer_id');
    }

    public function test_returned_application_can_be_edited_and_resubmitted(): void
    {
        $farmer = $this->makeFarmer();
        $res = $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($farmer, ['submit' => true]));
        $app = MembershipApplication::find($res->json('id'));

        $this->actingAs($this->manager)->postJson("/api/approvals/{$app->approval_request_id}/decide", ['decision' => 'return', 'remarks' => 'নমিনির NID দিন'])->assertOk();
        $this->assertSame('returned', $app->fresh()->status);

        $this->actingAs($this->officer)->postJson("/api/membership-applications/{$app->id}", $this->applicationPayload($farmer, [
            'submit' => true, 'nominees' => [['name' => 'সেলিনা', 'relation' => 'স্ত্রী', 'nid' => '1234567890', 'share_percent' => 100]],
        ]))->assertOk()->assertJson(['status' => 'pending']);
    }

    public function test_cancel_membership_needs_two_approvals_and_updates_voters(): void
    {
        $a = $this->makeFarmer(['name_bn' => 'সদস্য এক']);
        $b = $this->makeFarmer(['name_bn' => 'সদস্য দুই']);
        foreach ([$a, $b] as $f) {
            $res = $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($f, ['submit' => true]));
            $this->approveBothSteps(MembershipApplication::find($res->json('id'))->approval_request_id);
        }
        $member = $b->member()->first();
        // approval opened both accounts; they close with the membership and reopen with it
        $this->assertSame(['savings', 'share'], $member->accounts()->orderBy('kind')->pluck('kind')->all());
        $acc = $member->accounts()->where('kind', 'savings')->first();
        $this->assertSame($member->admitted_on->toDateString(), $acc->opened_on->toDateString());

        $this->actingAs($this->manager)->postJson("/api/members/{$member->id}/status", [
            'action' => 'cancel', 'effective_date' => now()->toDateString(), 'reason' => 'মৃত্যু',
        ])->assertStatus(422)->assertJsonValidationErrors(['reason_type', 'resolution_no']);

        $res = $this->actingAs($this->officer)->postJson("/api/members/{$member->id}/status", [
            'action' => 'cancel', 'effective_date' => now()->toDateString(), 'reason_type' => 'death',
            'reason' => 'মৃত্যু', 'resolution_no' => 'সভা-১২',
        ])->assertCreated();
        $this->assertSame(Member::ACTIVE, $member->fresh()->status);

        $this->approveBothSteps($res->json('approval_id'));
        $this->assertSame(Member::CANCELLED, $member->fresh()->status);
        $this->assertSame(['closed', 'membership'], [$acc->fresh()->status, $acc->fresh()->close_kind]);

        $admin = $this->userWithRole('admin');
        $admin->givePermissionTo('member.admin');
        $list = $this->actingAs($admin)->postJson('/api/voter-lists', ['title' => 'বার্ষিক সাধারণ সভা', 'cutoff_date' => now()->toDateString()])
            ->assertCreated()->assertJson(['eligible_count' => 1, 'ineligible_count' => 1]);

        $out = VoterListItem::where('voter_list_id', $list->json('id'))->where('eligible', false)->first();
        $this->assertSame('সদস্য দুই', $out->name);
        $this->assertSame('সদস্যপদ বাতিল', $out->reason);

        // The voter list screen: latest list, header figures, and the excluded filter.
        $this->actingAs($admin)->getJson('/api/voters')->assertOk()
            ->assertJsonPath('list.id', $list->json('id'))->assertJsonPath('previous', null)
            ->assertJsonPath('summary.total', 2)->assertJsonPath('summary.eligible', 1)->assertJsonPath('summary.excluded', 1)->assertJsonPath('summary.new', 1)
            ->assertJsonPath('items.total', 2);
        $this->actingAs($admin)->getJson('/api/voters?eligible=0')->assertJsonPath('items.total', 1)
            ->assertJsonPath('items.data.0.member_status', Member::CANCELLED)->assertJsonPath('items.data.0.reason', 'সদস্যপদ বাতিল');

        // Reactivation returns the same member number.
        $no = $member->member_no;
        $res = $this->actingAs($this->officer)->postJson("/api/members/{$member->id}/status", [
            'action' => 'reactivate', 'effective_date' => now()->toDateString(), 'reason' => 'ভুল তথ্য সংশোধন',
        ])->assertCreated();
        $this->approveBothSteps($res->json('approval_id'));
        $this->assertSame([Member::ACTIVE, $no], [$member->fresh()->status, $member->fresh()->member_no]);
        $this->assertSame(['active', null], [$acc->fresh()->status, $acc->fresh()->closed_on]);
    }

    public function test_patwari_mouza_change_keeps_history(): void
    {
        $admin = $this->userWithRole('admin');
        $admin->givePermissionTo(['patwari.create', 'patwari.edit', 'patwari.view']);
        $other = Mouza::create(['union_id' => $this->mouza->union_id, 'upazila_id' => $this->mouza->upazila_id, 'name_bn' => 'বাইপাইল', 'jl_no' => '13']);

        $res = $this->actingAs($admin)->postJson('/api/patwaris', [
            'name' => 'জলিল', 'father_name' => 'খলিল', 'mobile' => '01712345678',
            'mouza_ids' => [$this->mouza->id], 'start_date' => '2024-01-01',
        ])->assertCreated();

        $this->actingAs($admin)->putJson('/api/patwaris/'.$res->json('id'), [
            'name' => 'জলিল', 'father_name' => 'খলিল', 'mobile' => '01712345678',
            'mouza_ids' => [$other->id], 'start_date' => '2026-07-01',
        ])->assertOk();

        $p = Patwari::find($res->json('id'));
        $this->assertSame(2, $p->assignments()->count());
        $this->assertSame([$other->id], $p->currentAssignments()->pluck('mouza_id')->all());
        $this->assertSame('2026-07-01', $p->assignments()->whereNotNull('end_date')->first()->end_date->toDateString());

        // the list shows where they work now and since when; summary feeds the cards and filters
        $upazila = $this->mouza->upazila;
        $this->actingAs($admin)->getJson('/api/patwaris?search=01712')->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.mouza_count', 1)->assertJsonPath('data.0.joined_on', '2024-01-01')
            ->assertJsonPath('data.0.upazila', $upazila->name_bn)->assertJsonPath('data.0.district', $upazila->district->name_bn);
        $this->actingAs($admin)->getJson("/api/patwaris?district_id={$upazila->district_id}")->assertJsonPath('total', 1);
        $this->actingAs($admin)->getJson('/api/patwaris?district_id=999999')->assertJsonPath('total', 0);
        $this->actingAs($admin)->getJson('/api/patwaris/summary')->assertOk()
            ->assertJson(['total' => 1, 'active' => 1, 'inactive' => 0, 'mouzas' => 1])->assertJsonPath('upazilas.0.id', $upazila->id);

        // Mouza management: each mouza with its patwari and farmer count, filtered by patwari
        $this->makeFarmer();
        $this->actingAs($admin)->getJson("/api/mouzas?patwari_id={$p->id}")->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $other->id)->assertJsonPath('data.0.patwari', 'জলিল')->assertJsonPath('data.0.district', $upazila->district->name_bn);
        $this->actingAs($admin)->getJson("/api/mouzas?search={$this->mouza->jl_no}")->assertJsonPath('data.0.farmers_count', 1)->assertJsonPath('data.0.patwari', null);
        $this->actingAs($admin)->getJson('/api/mouzas-summary')->assertOk()->assertJson(['mouzas' => 2, 'farmers' => 1, 'lands' => 0])->assertJsonPath('patwaris.0.id', $p->id);
    }

    public function test_application_form_updates_farmer_papers_and_profile(): void
    {
        Storage::fake('local');
        $farmer = $this->makeFarmer(['occupation' => 'farmer']);
        $payload = $this->applicationPayload($farmer, [
            'nominees' => json_encode([['name' => 'সেলিনা', 'relation' => 'স্ত্রী', 'share_percent' => 100]]),
            'initial_shares' => 10, 'remarks' => 'প্রথম আবেদন', 'education_level' => 'primary', 'blood_group' => 'O+',
            'nid_front' => UploadedFile::fake()->image('nid.jpg'), 'photo' => UploadedFile::fake()->image('me.jpg'),
            'form_scan' => UploadedFile::fake()->create('form.pdf', 50, 'application/pdf'),
        ]);
        $res = $this->actingAs($this->officer)->post('/api/membership-applications', $payload, ['Accept' => 'application/json'])->assertCreated();

        $app = MembershipApplication::find($res->json('id'));
        $this->assertSame('প্রথম আবেদন', $app->remarks);
        $this->assertSame(10, $app->initial_shares);
        $this->assertNotNull($app->form_scan);
        // NID, photo and profile fields belong to the farmer
        $farmer->refresh();
        $this->assertSame(['primary', 'O+', 'farmer'], [$farmer->education_level, $farmer->blood_group, $farmer->occupation]);
        $this->assertNotNull($farmer->photo);
        $this->assertSame(['nid_front'], $farmer->documents()->pluck('type')->all());

        $this->actingAs($this->officer)->getJson('/api/membership-applications/defaults')->assertOk()->assertJsonStructure(['admission_fee', 'share_unit_price']);
    }

    public function test_application_list_summary_filters_and_details(): void
    {
        $paid = $this->makeFarmer(['name_bn' => 'ক', 'mobile' => '01711000001']);
        $due = $this->makeFarmer(['name_bn' => 'খ']);
        $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($paid, ['submit' => true]))->assertCreated();
        $id = $this->actingAs($this->officer)->postJson('/api/membership-applications', $this->applicationPayload($due, ['fee_status' => 'due']))->assertCreated()->json('id');

        $this->actingAs($this->officer)->getJson('/api/membership-applications/summary')->assertOk()
            ->assertJson(['total' => 2, 'pending' => 1, 'approved' => 0, 'rejected' => 0, 'fee_due' => 1]);

        $this->actingAs($this->officer)->getJson('/api/membership-applications?fee_status=due')->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $id);
        // search reaches the farmer's mobile too
        $this->actingAs($this->officer)->getJson('/api/membership-applications?search=01711000001')->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.farmer.mobile', '01711000001');

        $detail = $this->actingAs($this->manager)->getJson("/api/membership-applications/{$id}")->assertOk();
        $this->assertFalse($detail->json('can_act')); // a draft has no approval request yet
        $this->assertSame('পলাশবাড়ী, আশুলিয়া, সাভার, ঢাকা', $detail->json('farmer_address'));

        // the manager may act on the submitted one; the officer who sent it may not
        $pending = MembershipApplication::where('status', 'pending')->first();
        $this->assertTrue($this->actingAs($this->manager)->getJson("/api/membership-applications/{$pending->id}")->json('can_act'));
        $this->assertFalse($this->actingAs($this->officer)->getJson("/api/membership-applications/{$pending->id}")->json('can_act'));

        $csv = $this->actingAs($this->officer)->get('/api/membership-applications?export=csv')->assertOk()->streamedContent();
        $this->assertStringContainsString($pending->application_no, $csv);
    }

    public function test_member_list_summary_and_filters(): void
    {
        $viewer = $this->userWithRole('manager');
        $old = Member::create(['farmer_id' => $this->makeFarmer(['name_bn' => 'পুরোনো', 'education_level' => 'primary', 'occupation' => 'farmer'])->id,
            'member_no' => 1, 'admitted_on' => now()->subYear()->toDateString(), 'status' => Member::ACTIVE]);
        Member::create(['farmer_id' => $this->makeFarmer(['name_bn' => 'নতুন', 'education_level' => 'graduate', 'occupation' => 'business', 'nid' => '1234567890'])->id,
            'member_no' => 2, 'admitted_on' => now()->toDateString(), 'status' => Member::ACTIVE]);
        Member::create(['farmer_id' => $this->makeFarmer(['name_bn' => 'বসা'])->id,
            'member_no' => 3, 'admitted_on' => now()->subYear()->toDateString(), 'status' => Member::INACTIVE]);
        // became inactive this month: at the end of last month it still counted as active
        \App\Models\MembershipStatusHistory::create(['member_id' => 3, 'action' => 'deactivate', 'from_status' => 'active', 'to_status' => 'inactive', 'effective_date' => now()->toDateString()]);

        $this->actingAs($viewer)->getJson('/api/members/summary')->assertOk()
            ->assertJson(['total' => 3, 'active' => 2, 'inactive' => 1, 'new' => 1, 'change' => ['total' => 50, 'active' => 0, 'inactive' => null]]);

        $names = fn (array $q) => collect($this->actingAs($viewer)->getJson('/api/members?'.http_build_query($q))->assertOk()->json('data'))->pluck('farmer.name_bn')->all();
        $this->assertSame(['পুরোনো'], $names(['education_level' => 'primary']));
        $this->assertSame(['নতুন'], $names(['occupation' => 'business']));
        $this->assertSame(['নতুন'], $names(['search' => '1234567890']));
        $this->assertSame(['নতুন'], $names(['from' => now()->startOfMonth()->toDateString()]));
        $this->assertSame($old->id, $this->actingAs($viewer)->getJson('/api/members?per_page=5')->json('data.0.id'));
    }
}
