<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\Member;
use App\Services\ImageService;
use App\Services\SettingService;
use App\Support\Bn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

/**
 * The society's public website (landing page at "/"). Its text and photos live in
 * the `site` setting; every text has a Bangla and an optional English version.
 */
class WebsiteController extends Controller
{
    private const DIR = 'website';

    private const STATS_CACHE = 'website.stats';

    public const DEFAULTS = [
        'enabled' => true,
        'tagline' => ['bn' => 'সেচ, নিরাপদ পানি ও সঞ্চয় — এক সমিতিতে, গ্রামের মানুষের জন্য', 'en' => ''],
        'intro' => ['bn' => 'আমাদের সমিতি গ্রামের কৃষক ও পরিবারগুলোর জন্য সেচের পানি, নিরাপদ খাবার পানি, সঞ্চয় ও সহজ শর্তে ঋণের ব্যবস্থা করে। সব হিসাব কম্পিউটারে রাখা হয়, প্রতিটি টাকার রশিদ QR কোড দিয়ে যাচাই করা যায়।', 'en' => ''],
        'founded_year' => '',
        'work_area' => ['bn' => '', 'en' => ''],
        'about_photo' => null,
        'show_stats' => true,
        'notices' => [],
        'committee' => [],
        'gallery' => [],
        'phone' => '',
        'email' => '',
        'address' => ['bn' => '', 'en' => ''],
        'hours' => ['bn' => '', 'en' => ''],
        'map_url' => '',
    ];

    public static function content(): array
    {
        return array_replace(self::DEFAULTS, (array) SettingService::get('site', []));
    }

    /** Public: what the landing page shows. Contact details fall back to General Settings. */
    public function show(): JsonResponse
    {
        $c = self::content();
        $s = SettingService::all();
        $c['phone'] = $c['phone'] ?: $s['phone'];
        $c['email'] = $c['email'] ?: $s['email'];
        if (trim((string) ($c['address']['bn'] ?? '')) === '') {
            $c['address'] = ['bn' => $s['print_address'] ?: $s['address'], 'en' => $c['address']['en'] ?? ''];
        }
        $c['registration_no'] = $s['registration_no'];
        $c['stats'] = $c['show_stats'] ? $this->stats($c['founded_year']) : [];

        return response()->json($c);
    }

    public function edit(): JsonResponse
    {
        return response()->json(self::content());
    }

    public function update(Request $request): JsonResponse
    {
        $request->merge(['founded_year' => Bn::toEnDigits(trim((string) $request->input('founded_year'))) ?: null]);
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'show_stats' => ['required', 'boolean'],
            'tagline.bn' => ['nullable', 'string', 'max:200'], 'tagline.en' => ['nullable', 'string', 'max:200'],
            'intro.bn' => ['nullable', 'string', 'max:1500'], 'intro.en' => ['nullable', 'string', 'max:1500'],
            'founded_year' => ['nullable', 'digits:4', 'integer', 'min:1900', 'max:'.now()->year],
            'work_area.bn' => ['nullable', 'string', 'max:150'], 'work_area.en' => ['nullable', 'string', 'max:150'],
            'about_photo' => ['nullable', 'string', 'regex:/^website\/[A-Za-z0-9]{40}\.jpg$/'],
            'notices' => ['array', 'max:12'],
            'notices.*.date' => ['required', 'date'],
            'notices.*.title.bn' => ['required', 'string', 'max:250'], 'notices.*.title.en' => ['nullable', 'string', 'max:250'],
            'notices.*.tag.bn' => ['nullable', 'string', 'max:40'], 'notices.*.tag.en' => ['nullable', 'string', 'max:40'],
            'committee' => ['array', 'max:20'],
            'committee.*.name.bn' => ['required', 'string', 'max:100'], 'committee.*.name.en' => ['nullable', 'string', 'max:100'],
            'committee.*.role.bn' => ['required', 'string', 'max:60'], 'committee.*.role.en' => ['nullable', 'string', 'max:60'],
            'committee.*.photo' => ['nullable', 'string', 'regex:/^website\/[A-Za-z0-9]{40}\.jpg$/'],
            'gallery' => ['array', 'max:12'],
            'gallery.*.photo' => ['required', 'string', 'regex:/^website\/[A-Za-z0-9]{40}\.jpg$/'],
            'gallery.*.caption.bn' => ['nullable', 'string', 'max:120'], 'gallery.*.caption.en' => ['nullable', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:100'],
            'address.bn' => ['nullable', 'string', 'max:250'], 'address.en' => ['nullable', 'string', 'max:250'],
            'hours.bn' => ['nullable', 'string', 'max:100'], 'hours.en' => ['nullable', 'string', 'max:100'],
            'map_url' => ['nullable', 'url', 'max:1000', 'regex:/^https:\/\/(www\.)?google\.[a-z.]+\/maps\//'],
        ], [
            'map_url.regex' => __('গুগল ম্যাপের "Embed a map" লিংক দিন (https://www.google.com/maps/embed?... )।'),
        ]);

        $pair = fn ($v) => ['bn' => trim((string) ($v['bn'] ?? '')), 'en' => trim((string) ($v['en'] ?? ''))];
        $site = [
            'enabled' => (bool) $data['enabled'],
            'show_stats' => (bool) $data['show_stats'],
            'tagline' => $pair($data['tagline'] ?? []),
            'intro' => $pair($data['intro'] ?? []),
            'founded_year' => (string) ($data['founded_year'] ?? ''),
            'work_area' => $pair($data['work_area'] ?? []),
            'about_photo' => $data['about_photo'] ?? null,
            'notices' => collect($data['notices'] ?? [])->map(fn ($n) => ['date' => date('Y-m-d', strtotime($n['date'])), 'title' => $pair($n['title']), 'tag' => $pair($n['tag'] ?? [])])
                ->sortByDesc('date')->values()->all(),
            'committee' => collect($data['committee'] ?? [])->map(fn ($m) => ['name' => $pair($m['name']), 'role' => $pair($m['role']), 'photo' => $m['photo'] ?? null])->values()->all(),
            'gallery' => collect($data['gallery'] ?? [])->map(fn ($g) => ['photo' => $g['photo'], 'caption' => $pair($g['caption'] ?? [])])->values()->all(),
            'phone' => trim((string) ($data['phone'] ?? '')),
            'email' => trim((string) ($data['email'] ?? '')),
            'address' => $pair($data['address'] ?? []),
            'hours' => $pair($data['hours'] ?? []),
            'map_url' => trim((string) ($data['map_url'] ?? '')),
        ];

        $before = self::photos(self::content());
        SettingService::setMany(['site' => $site]);
        // photos taken off the page are deleted from disk
        foreach (array_diff($before, self::photos($site)) as $gone) {
            Storage::disk('local')->delete($gone);
        }
        Cache::forget(self::STATS_CACHE);

        return response()->json(self::content());
    }

    /** One photo for the site; saved with the page on the next "সংরক্ষণ". */
    public function upload(Request $request): JsonResponse
    {
        $request->validate(['image' => ['required', 'image', 'mimes:png,jpg,jpeg,webp', 'max:5120']]);
        $path = ImageService::storeCompressed($request->file('image'), self::DIR, 1600, 82);

        return response()->json(['path' => $path]);
    }

    /** Public: a photo used on the site. */
    public function image(string $name)
    {
        $path = self::DIR.'/'.$name;
        abort_unless(Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path, null, ['Cache-Control' => 'public, max-age=86400']);
    }

    private static function photos(array $c): array
    {
        return array_values(array_filter([
            $c['about_photo'] ?? null,
            ...array_column($c['committee'] ?? [], 'photo'),
            ...array_column($c['gallery'] ?? [], 'photo'),
        ]));
    }

    /** Headline numbers from the society's own records (cached; cheap on shared hosting). */
    private function stats(string $foundedYear): array
    {
        $stats = Cache::remember(self::STATS_CACHE, 600, function () {
            $season = Invoice::where('status', '!=', 'cancelled')->max('season_id');
            $decimal = $season ? (float) Invoice::where('status', '!=', 'cancelled')->where('season_id', $season)->sum('area_decimal') : 0;

            return [
                ['key' => 'members', 'value' => Member::where('status', Member::ACTIVE)->count()],
                ['key' => 'farmers', 'value' => Farmer::count()],
                ['key' => 'irrigated_acres', 'value' => (int) round($decimal / 100)],
            ];
        });
        if ($foundedYear !== '' && ($years = now()->year - (int) $foundedYear) > 0) {
            $stats[] = ['key' => 'years', 'value' => $years];
        }

        return array_values(array_filter($stats, fn ($s) => $s['value'] > 0));
    }
}
