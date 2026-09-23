<?php

namespace Tests\Feature;

use App\Models\District;
use App\Models\Division;
use App\Models\Farmer;
use App\Models\Mouza;
use App\Models\Union;
use App\Models\Upazila;
use App\Models\User;
use App\Models\Village;
use App\Services\SequenceService;
use Database\Seeders\RolePermissionSeeder;
use Database\Seeders\SystemSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

abstract class Phase2TestCase extends TestCase
{
    use RefreshDatabase;

    protected Village $village;

    protected Mouza $mouza;

    protected User $officer;

    protected User $manager;

    protected User $president;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed([RolePermissionSeeder::class, SystemSeeder::class]);

        $division = Division::create(['name_bn' => 'ঢাকা']);
        $district = District::create(['division_id' => $division->id, 'name_bn' => 'ঢাকা']);
        $upazila = Upazila::create(['district_id' => $district->id, 'name_bn' => 'সাভার']);
        $union = Union::create(['upazila_id' => $upazila->id, 'name_bn' => 'আশুলিয়া']);
        $this->village = Village::create(['union_id' => $union->id, 'name_bn' => 'পলাশবাড়ী']);
        $this->mouza = Mouza::create(['union_id' => $union->id, 'upazila_id' => $upazila->id, 'name_bn' => 'পলাশবাড়ী', 'jl_no' => '12']);
        $this->mouza->villages()->attach($this->village->id);

        $this->officer = $this->userWithRole('member_officer');
        $this->manager = $this->userWithRole('manager');
        $this->president = $this->userWithRole('president');
    }

    protected function userWithRole(string $role): User
    {
        $u = User::factory()->create();
        $u->assignRole($role);

        return $u;
    }

    protected function farmerPayload(array $overrides = []): array
    {
        return array_merge([
            'name_bn' => 'আব্দুল করিম',
            'father_name' => 'রহিম উদ্দিন',
            'gender' => 'male',
            'village_id' => $this->village->id,
            'mouza_id' => $this->mouza->id,
        ], $overrides);
    }

    protected function makeFarmer(array $overrides = []): Farmer
    {
        return Farmer::create($this->farmerPayload($overrides) + ['farmer_code' => SequenceService::next('farmer')]);
    }

    protected function applicationPayload(Farmer $farmer, array $overrides = []): array
    {
        return array_merge([
            'farmer_id' => $farmer->id,
            'applied_on' => now()->toDateString(),
            'admission_fee' => 0,
            'fee_status' => 'paid',
            'nominees' => [['name' => 'সেলিনা', 'relation' => 'স্ত্রী', 'share_percent' => 100]],
        ], $overrides);
    }

    protected function approveBothSteps(int $approvalId): void
    {
        $this->actingAs($this->manager)->postJson("/api/approvals/{$approvalId}/decide", ['decision' => 'approve'])->assertOk();
        $this->actingAs($this->president)->postJson("/api/approvals/{$approvalId}/decide", ['decision' => 'approve'])->assertOk();
    }
}
