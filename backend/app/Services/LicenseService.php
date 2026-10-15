<?php

namespace App\Services;

use App\Support\Runtime\Continuity;
use App\Support\Runtime\TrustAnchor;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * Talks to the vendor's license server: activate a key for this domain, and
 * verify it now and then (an answer is reused for 6 hours unless forced).
 * An answer is stored only when its signature verifies; otherwise the last
 * signed answer stays, and Continuity keeps trusting it for up to 5 days.
 */
class LicenseService
{
    /** Ask the server again sooner than the 6 hours when the last attempt failed. */
    private const RETRY_MINUTES = 15;

    public function __construct(private TrustAnchor $anchor) {}

    public static function installationId(): string
    {
        $id = SettingService::get('installation_id');
        if (! $id) {
            $id = (string) Str::uuid();
            SettingService::putQuiet('installation_id', $id);
        }

        return $id;
    }

    private function row(): ?object
    {
        return DB::table('license_state')->orderBy('id')->first();
    }

    private function save(array $values): void
    {
        $row = $this->row();
        $values['updated_at'] = now();
        $row ? DB::table('license_state')->where('id', $row->id)->update($values) : DB::table('license_state')->insert($values + ['created_at' => now()]);
    }

    /**
     * @return array{ok:bool, http:int|null, body:array|null, error:?string}
     */
    private function call(string $path, array $payload): array
    {
        try {
            $r = Http::acceptJson()->asJson()->connectTimeout(5)->timeout(10)
                ->post(config('license.server_url').$path, $payload);
            $body = $r->json();

            return ['ok' => is_array($body), 'http' => $r->status(), 'body' => is_array($body) ? $body : null, 'error' => is_array($body) ? null : 'bad_response'];
        } catch (Throwable $e) {
            return ['ok' => false, 'http' => null, 'body' => null, 'error' => 'unreachable'];
        }
    }

    /** True when the answer carries a valid signature over status|license_key|domain|expires_at. */
    private function signed(array $b): bool
    {
        return $this->anchor->accepts(
            Continuity::canonical($b['status'] ?? null, $b['license_key'] ?? null, $b['domain'] ?? null, $b['expires_at'] ?? null),
            $b['signature'] ?? null,
        );
    }

    /**
     * Activate a key for this domain.
     *
     * @return array{ok:bool, message:string, status:?string}
     */
    public function activate(string $key): array
    {
        $key = trim($key);
        $r = $this->call('/license/activate', ['license_key' => $key, 'domain' => Continuity::host(), 'product_slug' => config('license.product_slug')]);
        if (! $r['ok']) {
            return ['ok' => false, 'message' => __('লাইসেন্স সার্ভারের সাথে যোগাযোগ করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।'), 'status' => null];
        }
        $b = $r['body'];
        $message = (string) ($b['message'] ?? '');
        // Only a signed success is stored. The server signs refusals too ("key not found", wrong
        // domain …): those are shown but never replace the current state — a mistyped key must
        // not lock an installation that is working.
        if (! isset($b['signature']) || ! $this->signed($b) || ! in_array($b['status'] ?? '', ['activated', 'already_active'], true)) {
            return ['ok' => false, 'message' => $message ?: __('লাইসেন্স কী গ্রহণ করা হয়নি।'), 'status' => $b['status'] ?? null];
        }
        $this->save([
            // exactly the signed values, so the stored row still matches the signature
            'license_key' => $b['license_key'] ?? null, 'domain' => $b['domain'] ?? null, 'status' => $b['status'] ?? null,
            'expires_at' => $b['expires_at'] ?? null, 'activated_at' => $b['activated_at'] ?? null, 'signature' => $b['signature'],
            'message' => mb_substr($message, 0, 500), 'last_checked_at' => now(), 'last_check_ok' => true, 'last_ok_at' => now(),
        ]);
        $ok = in_array($b['status'] ?? '', ['activated', 'already_active'], true) && Continuity::usable();

        return ['ok' => $ok, 'message' => $message ?: ($ok ? __('লাইসেন্স সক্রিয় হয়েছে।') : __('লাইসেন্স কী গ্রহণ করা হয়নি।')), 'status' => $b['status'] ?? null];
    }

    /** Ask the server about the stored key; skipped while the last answer is under 6 hours old, unless forced. */
    public function verify(bool $force = false): array
    {
        $row = $this->row();
        if (! $row || ! $row->license_key) {
            return ['ok' => false, 'checked' => false, 'message' => __('কোনো লাইসেন্স কী সক্রিয় করা নেই।')];
        }
        if (! $force && ! $this->due($row)) {
            return ['ok' => (bool) $row->last_check_ok, 'checked' => false, 'message' => (string) $row->message];
        }
        $r = $this->call('/license/verify', ['license_key' => $row->license_key, 'domain' => Continuity::host()]);
        if (! $r['ok'] || ! isset($r['body']['signature']) || ! $this->signed($r['body'])) {
            // keep the last signed answer; only note that this attempt did not count
            $this->save(['last_checked_at' => now(), 'last_check_ok' => false]);

            return ['ok' => false, 'checked' => true, 'message' => $r['ok']
                ? (string) ($r['body']['message'] ?? __('লাইসেন্স সার্ভারের উত্তর যাচাই করা যায়নি।'))
                : __('লাইসেন্স সার্ভারের সাথে যোগাযোগ করা যায়নি।')];
        }
        $b = $r['body'];
        $this->save([
            'license_key' => $b['license_key'] ?? null, 'domain' => $b['domain'] ?? null, 'status' => $b['status'] ?? null,
            'expires_at' => $b['expires_at'] ?? null, 'signature' => $b['signature'], 'message' => mb_substr((string) ($b['message'] ?? ''), 0, 500),
            'last_checked_at' => now(), 'last_check_ok' => true, 'last_ok_at' => now(),
        ]);

        return ['ok' => true, 'checked' => true, 'message' => (string) ($b['message'] ?? '')];
    }

    private function due(?object $row): bool
    {
        if (! $row || ! $row->license_key) {
            return false;
        }
        $okAt = $row->last_ok_at ? CarbonImmutable::parse($row->last_ok_at) : null;
        $triedAt = $row->last_checked_at ? CarbonImmutable::parse($row->last_checked_at) : null;
        $fresh = $okAt && $okAt->addHours((int) config('license.cache_hours', 6))->isFuture();
        $recentlyTried = $triedAt && $triedAt->addMinutes(self::RETRY_MINUTES)->isFuture();

        return ! $fresh && ! $recentlyTried;
    }

    /** The state to act on: refresh from the server when the cached answer is stale, then judge offline. */
    public function getEffectiveStatus(): array
    {
        try {
            if ($this->due($this->row())) {
                $this->verify();
            }
        } catch (Throwable) {
            // the offline judgement below still applies
        }

        return Continuity::snapshot();
    }

    public function daysUntilExpiry(): ?int
    {
        return Continuity::snapshot()['days_left'];
    }

    /** What the app shows: blocked or not, why, the key (masked), the dates. */
    public function status(): array
    {
        $s = $this->getEffectiveStatus();
        $row = $s['row'];
        $key = (string) ($row->license_key ?? '');

        return [
            'state' => $s['state'],
            'blocked' => $s['state'] === 'blocked',
            'reason' => $s['reason'],
            'status' => $s['status'],
            'message' => $s['state'] === 'blocked' ? \App\Support\Runtime\WorkspaceUnavailable::text($s['reason'] ?? 'inactive') : (string) ($row->message ?? ''),
            'server_message' => (string) ($row->message ?? ''),
            'license_key' => $key !== '' ? (strlen($key) > 8 ? substr($key, 0, 4).str_repeat('•', max(4, strlen($key) - 8)).substr($key, -4) : $key) : null,
            'domain' => $row->domain ?? null,
            'current_domain' => Continuity::host(),
            'expires_at' => $s['expires_at'],
            'activated_at' => $row->activated_at ?? null,
            'days_until_expiry' => $s['days_left'],
            'warn_days' => (int) config('license.warn_days', 3),
            'last_checked_at' => $row->last_checked_at ?? null,
            'last_check_ok' => (bool) ($row->last_check_ok ?? false),
            'last_ok_at' => $row->last_ok_at ?? null,
            'recheck_seconds' => (int) config('license.recheck_seconds', 30),
        ];
    }
}
