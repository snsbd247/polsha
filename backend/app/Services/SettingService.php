<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;

class SettingService
{
    private const CACHE_KEY = 'settings.all';

    /** Keys safe to expose before login (login page branding). */
    public const PUBLIC_KEYS = ['society_name_bn', 'society_name_en', 'logo', 'digits', 'bigha_decimal'];

    public const DEFAULTS = [
        'society_name_bn' => 'সমবায় সমিতি লিমিটেড',
        'society_name_en' => '',
        'registration_no' => '',
        'registration_date' => null,
        'address' => '',
        'phone' => '',
        'email' => '',
        'logo' => null,
        'fiscal_year_start_month' => 7,
        'current_fiscal_year' => null,
        'digits' => 'bn',
        'currency_symbol' => '৳',
        'admission_fee' => 0,
        'voter_min_membership_months' => 0,
        // Local bigha size varies by district; 33 decimals is the common standard.
        'bigha_decimal' => 33,
        // how many running loans one member may stand guarantor for
        'loan_max_guarantees' => 2,
        // combined payment: which dues are settled first; savings takes the rest
        'combined_payment_order' => ['loan', 'irrigation', 'share'],
        // share capital every member should hold; the gap is a "share due" in combined payment
        'share_min_amount' => 0,
    ];

    public static function all(): array
    {
        $stored = Cache::rememberForever(self::CACHE_KEY, fn () => Setting::pluck('value', 'key')->all());

        return array_merge(self::DEFAULTS, $stored);
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::all()[$key] ?? $default;
    }

    public static function public(): array
    {
        return array_intersect_key(self::all(), array_flip(self::PUBLIC_KEYS));
    }

    public static function setMany(array $values): void
    {
        $before = self::all();
        foreach ($values as $key => $value) {
            Setting::updateOrCreate(['key' => $key], ['value' => $value]);
        }
        Cache::forget(self::CACHE_KEY);

        $changed = array_filter($values, fn ($v, $k) => ($before[$k] ?? null) !== $v, ARRAY_FILTER_USE_BOTH);
        if ($changed) {
            AuditLogger::log('settings', 'update', null, array_intersect_key($before, $changed), $changed);
        }
    }
}
