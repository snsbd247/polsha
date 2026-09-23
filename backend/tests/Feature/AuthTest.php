<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    public function test_login_with_mobile_in_bangla_digits(): void
    {
        User::factory()->create(['mobile' => '01711111111', 'password' => 'secret123']);

        $this->postJson('/api/auth/login', ['username' => '০১৭১১১১১১১১', 'password' => 'secret123'])
            ->assertOk()->assertJsonStructure(['token', 'user' => ['permissions']]);
    }

    public function test_account_locks_after_five_failures(): void
    {
        $user = User::factory()->create(['username' => 'karim', 'password' => 'secret123']);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/login', ['username' => 'karim', 'password' => 'wrong'])->assertStatus(422);
        }
        $this->assertTrue($user->fresh()->isLocked());
        $this->postJson('/api/auth/login', ['username' => 'karim', 'password' => 'secret123'])->assertStatus(423);
    }

    public function test_must_change_password_blocks_other_endpoints(): void
    {
        $user = User::factory()->create(['must_change_password' => true]);
        $user->assignRole('admin');

        $this->actingAs($user)->getJson('/api/users')->assertStatus(403)->assertJson(['code' => 'password_change_required']);
        $this->actingAs($user)->getJson('/api/me')->assertOk();
    }

    public function test_permission_is_enforced(): void
    {
        $user = User::factory()->create();
        $user->assignRole('data_entry');

        $this->actingAs($user)->getJson('/api/users')->assertForbidden();
        $this->actingAs($user)->getJson('/api/mouzas')->assertOk();
    }

    public function test_non_super_admin_cannot_grant_super_admin(): void
    {
        $admin = User::factory()->create();
        $admin->assignRole('admin');

        $this->actingAs($admin)->postJson('/api/users', [
            'name_bn' => 'রহিম', 'username' => 'rahim', 'mobile' => '01812345678',
            'password' => 'secret123', 'roles' => ['super_admin'],
        ])->assertStatus(422)->assertJsonValidationErrors('roles');
    }

    public function test_role_list_works_under_sanctum_guard(): void
    {
        $admin = User::factory()->create();
        $admin->assignRole('admin');
        $token = $admin->createToken('t')->plainTextToken;

        // Real bearer token (not actingAs) so the default guard switches to sanctum as in production.
        $this->withToken($token)->getJson('/api/roles')->assertOk()
            ->assertJsonFragment(['name' => 'admin', 'users_count' => 1]);
    }

    public function test_user_changes_are_audited_without_password(): void
    {
        $admin = User::factory()->create();
        $admin->assignRole('super_admin');

        $this->actingAs($admin)->postJson('/api/users', [
            'name_bn' => 'রহিম', 'username' => 'rahim', 'mobile' => '01812345678',
            'password' => 'secret123', 'roles' => ['cashier'],
        ])->assertCreated();

        $log = AuditLog::where(['module' => 'user', 'action' => 'create', 'user_id' => $admin->id])->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }
}
