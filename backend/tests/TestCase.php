<?php

namespace Tests;

use App\Support\Runtime\Continuity;
use App\Support\Runtime\TrustAnchor;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Throwable;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // the suite's own key pair stands in for the vendor's (swapped in the container, not by any setting)
        $this->app->instance(TrustAnchor::class, new TrustAnchor(file_get_contents(base_path('tests/fixtures/license-test.pub'))));
        $this->signedLicense();
    }

    /** Signs like the license server does: RSA-SHA256 over status|license_key|domain|expires_at. */
    protected static function licenseSignature(string $status, string $key, string $domain, ?string $expires): string
    {
        openssl_sign(Continuity::canonical($status, $key, $domain, $expires), $sig, file_get_contents(base_path('tests/fixtures/license-test.key')), OPENSSL_ALGO_SHA256);

        return base64_encode($sig);
    }

    /** A valid, signed license for this test installation (when the suite has a database). */
    protected function signedLicense(string $status = 'active', ?string $expires = null, array $extra = []): void
    {
        $expires ??= now()->addYear()->toIso8601String();
        try {
            DB::table('license_state')->delete();
            DB::table('license_state')->insert($extra + [
                'license_key' => 'TEST-KEY-0001', 'domain' => 'localhost', 'status' => $status, 'expires_at' => $expires,
                'signature' => self::licenseSignature($status, 'TEST-KEY-0001', 'localhost', $expires),
                'message' => '', 'last_checked_at' => now(), 'last_check_ok' => true, 'last_ok_at' => now(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        } catch (Throwable) {
            // tests without a database
        }
    }
}
