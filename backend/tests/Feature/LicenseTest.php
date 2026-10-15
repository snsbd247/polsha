<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsureWorkspaceReady;
use App\Models\Account;
use App\Services\LedgerService;
use App\Services\LicenseService;
use App\Services\SequenceService;
use App\Support\CsvExport;
use App\Support\Runtime\TrustAnchor;
use App\Support\Runtime\WorkspaceUnavailable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class LicenseTest extends Phase2TestCase
{
    private const URL = 'https://syncsolutionbd.com/api/v1';

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-10-10 10:00:00');
        $this->signedLicense(expires: '2027-10-10T00:00:00Z');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** A signed answer from the (faked) license server. */
    private function answer(string $status, ?string $expires = '2027-10-10T00:00:00Z', string $key = 'KEY-NEW-1234', string $domain = 'localhost', ?string $signature = null): array
    {
        return [
            'status' => $status, 'message' => 'from server', 'license_key' => $key, 'domain' => $domain,
            'activated_at' => '2026-10-10T10:00:00Z', 'expires_at' => $expires,
            'signature' => $signature ?? self::licenseSignature($status, $key, $domain, $expires),
        ];
    }

    private function cashier()
    {
        return $this->userWithRole('cashier');
    }

    private function blocked(string $status = 'expired', string $expires = '2026-09-01T00:00:00Z'): void
    {
        $this->signedLicense($status, $expires);
    }

    public function test_activation_stores_only_a_signed_answer_and_any_user_may_activate(): void
    {
        DB::table('license_state')->delete();
        $user = $this->cashier();
        $this->actingAs($user)->getJson('/api/farmers')->assertForbidden()->assertJsonPath('code', 'WORKSPACE_LOCKED');

        Http::fake([self::URL.'/license/activate' => Http::sequence()
            ->push($this->answer('activated', signature: base64_encode('forged')))
            ->push(['status' => 'denied', 'message' => 'License key not found'], 404)
            ->push($this->answer('activated'))]);
        // a forged answer is shown as a failure and never saved
        $this->actingAs($user)->postJson('/api/license/activate', ['license_key' => 'KEY-NEW-1234'])->assertStatus(422);
        $this->assertSame(0, DB::table('license_state')->count());

        // key not found: unsigned 404, nothing saved
        $this->actingAs($user)->postJson('/api/license/activate', ['license_key' => 'NOPE-0000'])->assertStatus(422)->assertJsonPath('message', 'License key not found');

        $this->actingAs($user)->postJson('/api/license/activate', ['license_key' => 'KEY-NEW-1234'])->assertOk()
            ->assertJsonPath('ok', true)->assertJsonPath('license.state', 'active')->assertJsonPath('license.blocked', false);
        Http::assertSent(fn ($r) => $r['domain'] === 'localhost' && $r['product_slug'] === config('license.product_slug') && $r['license_key'] === 'KEY-NEW-1234');
        $this->actingAs($user)->getJson('/api/farmers')->assertOk();
        // the key is shown masked
        $this->actingAs($user)->getJson('/api/license/status')->assertOk()->assertJsonPath('license_key', 'KEY-••••1234');
    }

    public function test_a_signed_refusal_for_a_mistyped_key_does_not_lock_a_working_installation(): void
    {
        // the real server signs refusals too: {"status":"denied","message":"License key not found.","signature":…}
        Http::fake([self::URL.'/license/activate' => Http::response([
            'status' => 'denied', 'message' => 'License key not found.', 'signature' => self::licenseSignature('denied', '', '', null),
        ], 404)]);
        $this->actingAs($this->cashier())->postJson('/api/license/activate', ['license_key' => 'TYPO-0000'])
            ->assertStatus(422)->assertJsonPath('message', 'License key not found.');
        $this->assertSame('TEST-KEY-0001', DB::table('license_state')->value('license_key'));
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertOk();
    }

    public function test_verify_reuses_a_fresh_answer_for_six_hours_unless_forced(): void
    {
        Http::fake([self::URL.'/license/verify' => Http::response($this->answer('active', key: 'TEST-KEY-0001'))]);
        $svc = app(LicenseService::class);
        $svc->verify();
        Http::assertNothingSent();

        Carbon::setTestNow(now()->addHours(7));
        $svc->getEffectiveStatus();
        Http::assertSentCount(1);
        $svc->verify(true);
        Http::assertSentCount(2);
    }

    public function test_expired_suspended_and_revoked_answers_block_everything_but_the_license_routes(): void
    {
        $user = $this->cashier();
        $answers = Http::sequence();
        foreach (['expired', 'suspended', 'revoked'] as $status) {
            $answers->push($this->answer($status, '2026-09-01T00:00:00Z', 'TEST-KEY-0001'), $status === 'expired' ? 200 : 403);
        }
        Http::fake([self::URL.'/license/verify' => $answers]);
        foreach (['expired', 'suspended', 'revoked'] as $status) {
            $this->actingAs($user)->postJson('/api/license/recheck')->assertOk()->assertJsonPath('license.blocked', true)->assertJsonPath('license.reason', $status);
            $this->actingAs($user)->getJson('/api/farmers')->assertForbidden()->assertJsonPath('code', 'WORKSPACE_LOCKED');
            $this->actingAs($user)->getJson('/api/me')->assertOk()->assertJsonPath('user.license.blocked', true);
            $this->actingAs($user)->getJson('/api/license/status')->assertOk();
            $this->travel(31)->seconds();
        }
    }

    public function test_grace_keeps_working_and_the_signed_expiry_is_enforced_offline(): void
    {
        $this->signedLicense('active', '2026-10-09T00:00:00Z'); // expired yesterday
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertOk();
        $this->assertSame('grace', app(LicenseService::class)->getEffectiveStatus()['state']);

        // more than the 2-day grace past expiry: blocked even though the stored status says active
        $this->signedLicense('active', '2026-10-07T00:00:00Z');
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertForbidden()->assertJsonPath('reason', 'expired');
    }

    public function test_server_out_of_reach_trusts_the_last_signed_answer_for_five_days(): void
    {
        Http::fake([self::URL.'/*' => Http::failedConnection()]);
        DB::table('license_state')->update(['last_ok_at' => now()->subDays(4), 'last_checked_at' => now()->subDays(4)]);
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertOk();

        DB::table('license_state')->update(['last_ok_at' => now()->subDays(6), 'last_checked_at' => now()->subDays(6)]);
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertForbidden()->assertJsonPath('reason', 'unverified');

        // a bad signature from the server is not stored either: the old answer stays
        $this->signedLicense();
        Http::fake([self::URL.'/license/verify' => Http::response($this->answer('expired', key: 'TEST-KEY-0001', signature: base64_encode('x')))]);
        app(LicenseService::class)->verify(true);
        $this->assertSame('active', DB::table('license_state')->value('status'));
    }

    public function test_editing_the_stored_row_or_moving_the_database_is_caught(): void
    {
        $this->blocked();
        // someone writes "active" and a far expiry straight into the database
        DB::table('license_state')->update(['status' => 'active', 'expires_at' => '2030-01-01T00:00:00Z']);
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertForbidden()->assertJsonPath('reason', 'tampered');

        // a genuine row signed for another domain does not work here
        $expires = '2027-10-10T00:00:00Z';
        DB::table('license_state')->update(['status' => 'active', 'domain' => 'other.com', 'expires_at' => $expires,
            'signature' => self::licenseSignature('active', 'TEST-KEY-0001', 'other.com', $expires)]);
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertForbidden()->assertJsonPath('reason', 'domain');
    }

    public function test_a_public_key_from_the_environment_cannot_replace_the_built_in_one(): void
    {
        // pretend someone signed the row with their own key and put that key in .env
        config(['license.public_key_pem' => file_get_contents(base_path('tests/fixtures/license-test.pub'))]);
        $this->app->forgetInstance(TrustAnchor::class);
        $this->app->bind(TrustAnchor::class, fn () => new TrustAnchor);
        $this->actingAs($this->cashier())->getJson('/api/farmers')->assertForbidden()->assertJsonPath('reason', 'tampered');
    }

    public function test_without_the_middleware_the_other_layers_still_block(): void
    {
        $this->blocked();
        $user = $this->cashier();
        // as if the middleware file were deleted
        $this->withoutMiddleware(EnsureWorkspaceReady::class);
        $this->actingAs($user)->getJson('/api/farmers')->assertForbidden()->assertJsonPath('code', 'WORKSPACE_LOCKED');
        $this->actingAs($this->manager)->postJson('/api/farmers', $this->farmerPayload())->assertForbidden();

        // the business core refuses on its own too (scheduler, imports, anything that skips controllers)
        $this->actingAs($this->manager);
        foreach ([
            fn () => SequenceService::next('receipt'),
            fn () => app(LedgerService::class)->postNow('receipt', now()->toDateString(), 'x', [
                ['account_id' => Account::where('code', '1111')->value('id'), 'debit' => 10],
                ['account_id' => Account::where('code', '4100')->value('id'), 'credit' => 10],
            ]),
            fn () => app(LedgerService::class)->openPeriodFor(now()->toDateString()),
            fn () => CsvExport::download('x.csv', ['a'], []),
        ] as $i => $call) {
            try {
                $call();
                $this->fail("layer {$i} did not block");
            } catch (WorkspaceUnavailable $e) {
                $this->assertSame('expired', $e->reason);
            }
        }
    }

    public function test_recheck_is_limited_to_once_per_thirty_seconds_per_user(): void
    {
        Http::fake([self::URL.'/license/verify' => Http::response($this->answer('active', key: 'TEST-KEY-0001'))]);
        $user = $this->cashier();
        $this->actingAs($user)->postJson('/api/license/recheck')->assertOk();
        $this->actingAs($user)->postJson('/api/license/recheck')->assertStatus(429);
        $this->actingAs($this->manager)->postJson('/api/license/recheck')->assertOk();
        $this->travel(31)->seconds();
        $this->actingAs($user)->postJson('/api/license/recheck')->assertOk();
    }

    public function test_days_until_expiry_for_the_near_expiry_popup(): void
    {
        $this->signedLicense('active', '2026-10-12T10:00:00Z');
        $this->assertSame(2, app(LicenseService::class)->daysUntilExpiry());
        $this->actingAs($this->cashier())->getJson('/api/license/status')->assertJsonPath('days_until_expiry', 2)->assertJsonPath('warn_days', 3);
    }
}
