<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_sees_the_full_dashboard_in_design_order(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::factory()->create();
        $admin->assignRole('super_admin');

        $res = $this->actingAs($admin)->getJson('/api/dashboard?refresh=1')->assertOk();

        $keys = collect($res->json('kpis'))->pluck('key')->all();
        $this->assertSame([
            'farmers', 'member_farmers', 'non_member_farmers', 'land',
            'irrigation_invoices', 'irrigation_collection', 'irrigation_due', 'water_collection', 'water_due', 'savings',
            'loans', 'share', 'cash', 'bank', 'assets',
        ], $keys);
        $res->assertJsonStructure([
            'kpis' => [['key', 'label', 'value', 'type', 'link']],
            'collection' => ['days', 'modules'],
            'recent', 'approvals', 'notices' => [['key', 'label', 'count', 'tone', 'link']], 'alerts', 'generated_at',
        ]);
        $this->assertCount(40, $res->json('collection.days'));
        $this->assertSame(
            ['irrigation_due_30', 'water_owing', 'loan_overdue', 'membership', 'withdrawals', 'bank_recon', 'maintenance'],
            collect($res->json('notices'))->pluck('key')->all(),
        );

        $this->actingAs($admin)->getJson('/api/approvals/pending-count')->assertOk()->assertJsonStructure(['count', 'applications']);
    }

    public function test_user_without_permissions_gets_no_money_figures(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $user = User::factory()->create();

        $res = $this->actingAs($user)->getJson('/api/dashboard?refresh=1')->assertOk();
        $this->assertSame([], $res->json('kpis'));
        $this->assertNull($res->json('collection'));
        $this->assertNull($res->json('recent'));
    }
}
