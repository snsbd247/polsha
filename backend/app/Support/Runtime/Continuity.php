<?php

namespace App\Support\Runtime;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Whether the installation may keep working — decided from the stored, signed
 * answer alone (no network): the signature must match, the domain must be this
 * one, the expiry plus grace must not have passed, and the last valid answer
 * must be recent enough. Money postings, document numbers, exports and every
 * signed-in request call ensure(); none of them can be switched off by a setting.
 */
class Continuity
{
    public const LOCKED = 'WORKSPACE_LOCKED';

    private const ACTIVE = ['active', 'activated', 'already_active'];

    /** The host this installation answers on (no "www."), from the request or APP_URL. */
    public static function host(): string
    {
        $host = '';
        try {
            if (! app()->runningInConsole() || app()->runningUnitTests()) {
                $host = (string) request()->getHost();
            }
        } catch (Throwable) {
            $host = '';
        }
        if ($host === '') {
            $host = (string) parse_url((string) config('app.url'), PHP_URL_HOST);
        }

        return preg_replace('/^www\./', '', strtolower($host));
    }

    public static function canonical(?string $status, ?string $key, ?string $domain, ?string $expires): string
    {
        return ($status ?? '').'|'.($key ?? '').'|'.($domain ?? '').'|'.($expires ?? '');
    }

    /**
     * state: active | grace | blocked; reason says why when blocked.
     *
     * @return array{state:string, reason:?string, status:?string, expires_at:?string, days_left:?int, row:?object}
     */
    public static function snapshot(): array
    {
        $out = ['state' => 'blocked', 'reason' => 'inactive', 'status' => null, 'expires_at' => null, 'days_left' => null, 'row' => null];
        try {
            $row = DB::table('license_state')->orderBy('id')->first();
        } catch (Throwable) {
            $row = null;
        }
        if (! $row || ! $row->license_key || ! $row->status) {
            return $out;
        }
        $out['row'] = $row;
        $out['status'] = $row->status;
        $out['expires_at'] = $row->expires_at;
        // an edited row no longer matches the server's signature
        if (! app(TrustAnchor::class)->accepts(self::canonical($row->status, $row->license_key, $row->domain, $row->expires_at), $row->signature)) {
            $out['reason'] = 'tampered';

            return $out;
        }
        if (preg_replace('/^www\./', '', strtolower((string) $row->domain)) !== self::host()) {
            $out['reason'] = 'domain';

            return $out;
        }
        if (! in_array($row->status, [...self::ACTIVE, 'grace'], true)) {
            $out['reason'] = $row->status; // expired | suspended | revoked | denied

            return $out;
        }
        $now = CarbonImmutable::now();
        if (! $row->last_ok_at || CarbonImmutable::parse($row->last_ok_at)->addDays((int) config('license.offline_days', 5))->isPast()) {
            $out['reason'] = 'unverified';

            return $out;
        }
        $state = in_array($row->status, self::ACTIVE, true) ? 'active' : 'grace';
        if ($row->expires_at) {
            $expires = CarbonImmutable::parse($row->expires_at);
            $out['days_left'] = (int) floor($now->diffInSeconds($expires, false) / 86400);
            // the signed expiry date is enforced here too, even while the server cannot be reached
            if ($expires->addDays((int) config('license.grace_days', 2))->isPast()) {
                $out['reason'] = 'expired';

                return $out;
            }
            if ($expires->isPast()) {
                $state = 'grace';
            }
        }
        $out['state'] = $state;
        $out['reason'] = null;

        return $out;
    }

    public static function usable(): bool
    {
        return self::snapshot()['state'] !== 'blocked';
    }

    /** Stops the current operation when the installation may not work. */
    public static function ensure(): void
    {
        $s = self::snapshot();
        if ($s['state'] === 'blocked') {
            throw new WorkspaceUnavailable($s['reason'] ?? 'inactive');
        }
    }
}
