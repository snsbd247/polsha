<?php

namespace App\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Offline license: POLSHA1.<base64url json>.<base64url RSA-SHA256 signature>.
 * Only the public key ships with the app, so a key cannot be forged here;
 * after expiry (when enforced) the system turns read-only until a new key is installed.
 */
class LicenseService
{
    public const PREFIX = 'POLSHA1';

    public static function installationId(): string
    {
        $id = SettingService::get('installation_id');
        if (! $id) {
            $id = (string) Str::uuid();
            SettingService::putQuiet('installation_id', $id);
        }

        return $id;
    }

    public static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function unb64(string $s): string|false
    {
        return base64_decode(strtr($s, '-_', '+/').str_repeat('=', (4 - strlen($s) % 4) % 4), true);
    }

    /** Signs a payload with a PEM private key (used by license:issue on the vendor's machine). */
    public static function sign(array $payload, string $privateKeyPem): string
    {
        $body = self::PREFIX.'.'.self::b64(json_encode($payload, JSON_UNESCAPED_UNICODE));
        $key = openssl_pkey_get_private($privateKeyPem);
        if (! $key || ! openssl_sign($body, $sig, $key, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('Could not sign the license.');
        }

        return $body.'.'.self::b64($sig);
    }

    /** Returns the payload when the signature is genuine, otherwise null. */
    public static function decode(string $key): ?array
    {
        $parts = explode('.', trim($key));
        if (count($parts) !== 3 || $parts[0] !== self::PREFIX) {
            return null;
        }
        $pub = openssl_pkey_get_public((string) config('license.public_key'));
        $sig = self::unb64($parts[2]);
        $json = self::unb64($parts[1]);
        if (! $pub || $sig === false || $json === false || openssl_verify($parts[0].'.'.$parts[1], $sig, $pub, OPENSSL_ALGO_SHA256) !== 1) {
            return null;
        }
        $payload = json_decode($json, true);

        return is_array($payload) && ! empty($payload['to']) && ! empty($payload['expires']) ? $payload : null;
    }

    /** Why a key cannot be installed here, or null when it can. */
    public static function problem(string $key): ?string
    {
        $p = self::decode($key);
        if (! $p) {
            return __('লাইসেন্স কী সঠিক নয়।');
        }
        if (! empty($p['installation']) && $p['installation'] !== self::installationId()) {
            return __('এই লাইসেন্স অন্য ইনস্টলেশনের জন্য ইস্যু করা।');
        }
        if (Carbon::parse($p['expires'])->endOfDay()->isPast()) {
            return __('এই লাইসেন্সের মেয়াদ শেষ হয়ে গেছে।');
        }

        return null;
    }

    public static function install(string $key): array
    {
        SettingService::setMany(['license_key' => trim($key)]);

        return self::status();
    }

    /** state: valid | expiring | expired | missing | invalid; locked only when enforced. */
    public static function status(): array
    {
        $key = (string) SettingService::get('license_key', '');
        $payload = $key !== '' ? self::decode($key) : null;
        $state = match (true) {
            $key === '' => 'missing',
            ! $payload, ! empty($payload['installation']) && $payload['installation'] !== self::installationId() => 'invalid',
            default => null,
        };
        $daysLeft = null;
        if (! $state) {
            $daysLeft = (int) now()->startOfDay()->diffInDays(Carbon::parse($payload['expires'])->startOfDay(), false);
            $state = $daysLeft < 0 ? 'expired' : ($daysLeft <= (int) config('license.warn_days') ? 'expiring' : 'valid');
        }
        $enforced = (bool) config('license.enforce');

        return [
            'state' => $state,
            'licensed_to' => $payload['to'] ?? null,
            'expires' => $payload['expires'] ?? null,
            'issued' => $payload['issued'] ?? null,
            'days_left' => $daysLeft,
            'enforced' => $enforced,
            'locked' => $enforced && in_array($state, ['missing', 'invalid', 'expired'], true),
        ];
    }
}
