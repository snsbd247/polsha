<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;

class SettingService
{
    private const CACHE_KEY = 'settings.all';

    /** Keys safe to expose before login (login page branding). */
    public const PUBLIC_KEYS = ['society_name_bn', 'society_name_en', 'logo', 'digits', 'bigha_decimal', 'brand_color', 'default_locale', 'page_size', 'idle_logout_minutes', 'member_card_note', 'date_format', 'default_location', 'default_mouza_id'];

    public const DEFAULTS = [
        'society_name_bn' => 'সমবায় সমিতি লিমিটেড',
        'society_name_en' => '',
        'registration_no' => '',
        'registration_date' => null,
        'address' => '',
        'phone' => '',
        'email' => '',
        // society profile shown on General Settings
        'society_type' => 'agricultural',
        'contact_person' => '',
        'contact_designation' => '',
        'contact_mobile' => '',
        'contact_mobile_alt' => '',
        'contact_email' => '',
        'phone_alt' => '',
        'website' => '',
        // address block printed on receipts and reports; falls back to the address
        'print_address' => '',
        'society_remarks' => '',
        // new farmers start in this place: [division, district, upazila, union, village]
        'default_location' => [],
        'default_mouza_id' => null,
        'timezone' => 'Asia/Dhaka',
        'date_format' => 'DD/MM/YYYY',
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
        // face value of one share; share capital ÷ this = number of shares on profiles and cards
        'share_unit_price' => 10,
        // SMS gateway (any HTTP API); without it messages are only logged
        'sms_enabled' => false,
        'sms_gateway_url' => '',
        'sms_http_method' => 'GET',
        'sms_api_key' => '',
        'sms_sender_id' => '',
        'sms_success_text' => '',
        'sms_auto_payment' => true,
        'sms_auto_savings' => true,
        'sms_reminders' => true,
        'sms_reminder_days' => 3,
        // public (no-login) bKash/Nagad payment requests
        'public_payment_enabled' => false,
        'public_payment_bkash' => '',
        'public_payment_nagad' => '',
        'public_payment_rocket' => '',
        'public_payment_note' => '',
        // branding + printed documents
        'brand_color' => '#1f7a4d',
        'letterhead_text' => '',
        'signature' => null,
        'seal' => null,
        'document_footer' => '',
        'receipt_sign_left' => 'প্রদানকারীর স্বাক্ষর',
        'receipt_sign_right' => 'আদায়কারীর স্বাক্ষর',
        'receipt_footer_note' => '',
        'receipt_show_qr' => true,
        'receipt_show_due' => true,
        'receipt_copies' => 1,
        'receipt_paper' => 'a4',
        'member_card_note' => '',
        // preferences
        'default_locale' => 'bn',
        'page_size' => 25,
        'idle_logout_minutes' => 0,
        // first day of live use; opening balances are dated this day
        'go_live_date' => null,
        'installation_id' => null,
        'license_key' => '',
    ];

    /** Uploadable images (logo, authorised signature, society seal). */
    public const IMAGES = ['logo', 'signature', 'seal'];

    /** Never sent to the browser as is. */
    public const SECRET_KEYS = ['sms_api_key', 'license_key'];

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

    /** Society header + print options, as every printable document needs them. */
    public static function society(): array
    {
        $s = self::all();

        return [
            'name_bn' => $s['society_name_bn'], 'name_en' => $s['society_name_en'], 'address' => $s['print_address'] ?: $s['address'],
            'phone' => $s['phone'], 'email' => $s['email'], 'registration_no' => $s['registration_no'], 'logo' => $s['logo'],
            'letterhead_text' => $s['letterhead_text'], 'brand_color' => $s['brand_color'],
            'signature' => (bool) $s['signature'], 'seal' => (bool) $s['seal'],
            'sign_left' => $s['receipt_sign_left'], 'sign_right' => $s['receipt_sign_right'],
            'footer_note' => $s['receipt_footer_note'], 'document_footer' => $s['document_footer'],
            'show_qr' => (bool) $s['receipt_show_qr'], 'show_due' => (bool) $s['receipt_show_due'],
            'copies' => (int) $s['receipt_copies'], 'paper' => $s['receipt_paper'],
            'member_card_note' => $s['member_card_note'],
        ];
    }

    /** Internal bookkeeping values (no audit entry). */
    public static function putQuiet(string $key, mixed $value): void
    {
        Setting::updateOrCreate(['key' => $key], ['value' => $value]);
        Cache::forget(self::CACHE_KEY);
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
