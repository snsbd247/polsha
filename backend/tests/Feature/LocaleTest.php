<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LocaleTest extends TestCase
{
    use RefreshDatabase;

    public function test_messages_follow_x_locale_header(): void
    {
        $bad = ['username' => 'nobody', 'password' => 'wrong'];

        $this->postJson('/api/auth/login', $bad)->assertJson(['message' => 'ইউজারনেম বা পাসওয়ার্ড ভুল।']);
        $this->postJson('/api/auth/login', $bad, ['X-Locale' => 'en'])->assertJson(['message' => 'Wrong username or password.']);
        // A browser's English Accept-Language must not switch the language.
        $this->postJson('/api/auth/login', $bad, ['Accept-Language' => 'en-US'])->assertJson(['message' => 'ইউজারনেম বা পাসওয়ার্ড ভুল।']);
    }

    public function test_validation_messages_and_labels_are_localised(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::factory()->create();
        $admin->assignRole('admin');

        $this->actingAs($admin)->postJson('/api/users', [])
            ->assertJsonPath('errors.name_bn.0', 'নাম (বাংলা) আবশ্যক।');
        $this->actingAs($admin)->postJson('/api/users', [], ['X-Locale' => 'en'])
            ->assertJsonPath('errors.name_bn.0', 'The name (Bangla) field is required.');

        $roles = collect($this->actingAs($admin)->getJson('/api/roles/options', ['X-Locale' => 'en'])->json())->keyBy('name');
        $this->assertSame('Manager', $roles['manager']['label']);
    }

    public function test_user_can_save_locale(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/me/locale', ['locale' => 'en'])->assertOk();
        $this->assertSame('en', $user->fresh()->locale);
    }
}
