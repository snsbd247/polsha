<?php

namespace Tests\Feature;

use App\Services\LicenseService;
use App\Services\SettingService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

class LicenseTest extends Phase2TestCase
{
    private string $privateKey;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-06-30 10:00:00');
        // test-only key pair; production keys never touch the repo
        $this->privateKey = file_get_contents(base_path('tests/fixtures/license-test.key'));
        config(['license.public_key' => file_get_contents(base_path('tests/fixtures/license-test.pub')), 'license.enforce' => true]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function key(string $expires, ?string $installation = null): string
    {
        return LicenseService::sign(['id' => 'x', 'to' => 'টেস্ট সমিতি', 'expires' => $expires, 'issued' => '2026-01-01', 'installation' => $installation], $this->privateKey);
    }

    private function superAdmin()
    {
        $u = $this->userWithRole('admin');
        $u->assignRole('super_admin');

        return $u;
    }

    public function test_missing_or_expired_license_makes_the_system_read_only(): void
    {
        $admin = $this->userWithRole('data_entry');

        // no key yet → locked: reads work, writes get 423, login/profile stay open
        $this->actingAs($admin)->getJson('/api/me')->assertOk()->assertJsonPath('user.license.state', 'missing')->assertJsonPath('user.license.locked', true);
        $this->actingAs($admin)->getJson('/api/farmers')->assertOk();
        $this->actingAs($admin)->postJson('/api/farmers', ['name_bn' => 'x'])->assertStatus(423)->assertJsonPath('license.state', 'missing');
        $this->actingAs($admin)->postJson('/api/me/locale', ['locale' => 'en'])->assertOk();

        // a genuine key unlocks
        SettingService::setMany(['license_key' => $this->key('2027-06-30')]);
        $this->actingAs($admin)->getJson('/api/me')->assertJsonPath('user.license.state', 'valid')->assertJsonPath('user.license.days_left', 365);
        $this->actingAs($admin)->postJson('/api/farmers', [])->assertStatus(422);

        // near the end → warning, still writable
        Carbon::setTestNow('2027-06-10 10:00:00');
        $this->actingAs($admin)->getJson('/api/me')->assertJsonPath('user.license.state', 'expiring')->assertJsonPath('user.license.locked', false);

        // expiry day is still valid; the day after is locked
        Carbon::setTestNow('2027-06-30 23:00:00');
        $this->actingAs($admin)->postJson('/api/farmers', [])->assertStatus(422);
        Carbon::setTestNow('2027-07-01 09:00:00');
        $this->actingAs($admin)->postJson('/api/farmers', [])->assertStatus(423);

        // not enforced (e.g. local dev) → never locked
        config(['license.enforce' => false]);
        $this->actingAs($admin)->postJson('/api/farmers', [])->assertStatus(422);
    }

    public function test_forged_or_foreign_keys_are_refused_and_only_super_admin_installs(): void
    {
        $admin = $this->userWithRole('admin');
        $super = $this->superAdmin();
        $good = $this->key('2027-06-30');

        // a tampered payload fails the signature check
        [$p, $body, $sig] = explode('.', $good);
        $forged = $p.'.'.LicenseService::b64(json_encode(['to' => 'x', 'expires' => '2099-01-01'])).'.'.$sig;
        $this->actingAs($super)->postJson('/api/system/license', ['key' => $forged])->assertStatus(422)->assertJsonValidationErrors('key');

        // bound to another installation
        $this->actingAs($super)->postJson('/api/system/license', ['key' => $this->key('2027-06-30', 'other-installation')])->assertStatus(422);
        // already expired
        $this->actingAs($super)->postJson('/api/system/license', ['key' => $this->key('2026-01-01')])->assertStatus(422);

        // an admin can see the page but not install
        $this->actingAs($admin)->getJson('/api/system/license')->assertOk()->assertJsonStructure(['license', 'installation_id', 'system' => ['php', 'laravel', 'database', 'scheduler_ok']]);
        $this->actingAs($admin)->postJson('/api/system/license', ['key' => $good])->assertForbidden();

        // installing works even while locked, and the key itself never reaches the browser
        $id = LicenseService::installationId();
        $this->actingAs($super)->postJson('/api/system/license', ['key' => $this->key('2027-06-30', $id)])
            ->assertOk()->assertJsonPath('license.state', 'valid')->assertJsonPath('license.licensed_to', 'টেস্ট সমিতি');
        $settings = $this->actingAs($admin)->getJson('/api/settings')->assertOk()->json();
        $this->assertArrayNotHasKey('license_key', $settings);
        $this->assertTrue($settings['license_key_set']);
        $this->assertDatabaseHas('audit_logs', ['module' => 'license', 'action' => 'install']);
    }

    public function test_branding_receipt_and_preference_settings(): void
    {
        config(['license.enforce' => false]);
        Storage::fake('local');
        $admin = $this->userWithRole('admin');

        $this->actingAs($admin)->putJson('/api/settings/receipt', [
            'receipt_sign_left' => 'গ্রাহক', 'receipt_sign_right' => 'ক্যাশিয়ার', 'receipt_footer_note' => null,
            'receipt_show_qr' => false, 'receipt_show_due' => true, 'receipt_copies' => 2, 'receipt_paper' => 'a5',
        ])->assertOk()->assertJsonPath('receipt_copies', 2)->assertJsonPath('receipt_footer_note', '');
        $this->actingAs($admin)->putJson('/api/settings/branding', ['brand_color' => 'blue'])->assertStatus(422);
        $this->actingAs($admin)->putJson('/api/settings/branding', ['brand_color' => '#0a7d3b', 'letterhead_text' => 'স্থাপিত ১৯৯০'])->assertOk();
        $this->actingAs($admin)->putJson('/api/settings/preferences', [
            'default_locale' => 'en', 'page_size' => 50, 'idle_logout_minutes' => 30, 'go_live_date' => '2026-07-01',
        ])->assertOk();
        $this->actingAs($admin)->putJson('/api/settings/unknown', [])->assertNotFound();

        // images: signature is served only to signed-in users
        $this->actingAs($admin)->post('/api/settings/images/signature', ['image' => UploadedFile::fake()->image('sign.png', 200, 60)])
            ->assertOk()->assertJsonPath('signature_set', true);
        $this->actingAs($admin)->get('/api/settings/images/signature')->assertOk();

        // the society block every printed document uses
        $society = SettingService::society();
        $this->assertSame(['ক্যাশিয়ার', 2, 'a5', false, true, '#0a7d3b'], [$society['sign_right'], $society['copies'], $society['paper'], $society['show_qr'], $society['signature'], $society['brand_color']]);

        // public settings carry what the login page and layout need, nothing secret
        $public = $this->getJson('/api/public/settings')->assertOk()->json();
        $this->assertSame(['#0a7d3b', 'en', 50, 30], [$public['brand_color'], $public['default_locale'], $public['page_size'], $public['idle_logout_minutes']]);
        $this->assertArrayNotHasKey('license_key', $public);

        // ordinary users cannot change settings
        $this->actingAs($this->userWithRole('data_entry'))->putJson('/api/settings/preferences', ['default_locale' => 'bn', 'page_size' => 25, 'idle_logout_minutes' => 0])->assertForbidden();
    }
}
