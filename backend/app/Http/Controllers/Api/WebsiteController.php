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
use Illuminate\Support\Facades\DB;
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
        // the name block in the header: a short name, the full name below it, and a line under both (empty → the society's name)
        'brand_title' => ['bn' => '', 'en' => ''],
        'brand_subtitle' => ['bn' => '', 'en' => ''],
        'brand_tagline' => ['bn' => 'টেকসই পানি, সমৃদ্ধ সমাজ', 'en' => 'Sustainable Water, Prosperous Community'],
        // hero: a small line, the big title (one line per line; the word in [brackets] is shown in green) and the photos it slides through
        'hero_kicker' => ['bn' => 'আগামী দিনের জন্য টেকসই পানি', 'en' => 'Sustainable Water for a Better Tomorrow'],
        'hero_title' => ['bn' => "[কৃষি] ও সমৃদ্ধ\nসমাজের জন্য\nনির্ভরযোগ্য পানি", 'en' => "Reliable Water\nfor [Agriculture]\nand a Prosperous\nCommunity"],
        'hero_photos' => [],
        'tagline' => ['bn' => 'টেকসই ও সমৃদ্ধ সমাজের জন্য সমন্বিত সেচ ও আবাসিক পানি সরবরাহ।', 'en' => 'Integrated irrigation and residential water supply for a sustainable and prosperous community.'],
        // empty → the society's full name
        'about_title' => ['bn' => '', 'en' => ''],
        'intro' => ['bn' => 'আমাদের সমিতি সমবায়ের মাধ্যমে দক্ষ সেচ ও নিরাপদ আবাসিক পানি সরবরাহে প্রতিশ্রুতিবদ্ধ — স্বচ্ছতা ও আধুনিক প্রযুক্তি নিয়ে। আমাদের লক্ষ্য খাদ্য নিরাপত্তা নিশ্চিত করা, জীবিকার উন্নতি ঘটানো এবং একটি সমৃদ্ধ সমাজ গড়ে তোলা।',
            'en' => 'We are committed to providing efficient irrigation and safe residential water supply through cooperative efforts, transparency and modern technology. Our goal is to ensure food security, improve livelihoods and build a prosperous community.'],
        'vision' => ['bn' => 'টেকসই পানি ব্যবস্থাপনার মাধ্যমে একটি সমৃদ্ধ ও স্বনির্ভর সমাজ।', 'en' => 'Sustainable water management for a prosperous and self-reliant community.'],
        'mission' => ['bn' => 'সমবায়ের মাধ্যমে দক্ষ সেচ ও নিরাপদ পানি সরবরাহ নিশ্চিত করা।', 'en' => 'To provide efficient irrigation and safe water supply through cooperative efforts.'],
        'values' => ['bn' => 'স্বচ্ছতা, অংশগ্রহণ, জবাবদিহি ও সমাজের উন্নয়ন।', 'en' => 'Transparency, Participation, Accountability and Community Development.'],
        'faqs' => [
            ['q' => ['bn' => 'নতুন পানির সংযোগের জন্য কীভাবে আবেদন করব?', 'en' => 'How can I apply for a new water connection?'],
                'a' => ['bn' => 'জাতীয় পরিচয়পত্র নিয়ে সমিতির অফিসে আসুন। ফর্ম পূরণ করে সংযোগ ফি দিলে সংযোগ দেওয়া হয়।', 'en' => 'Visit the society office with your national ID card. Fill in the form and pay the connection fee to get the connection.']],
            ['q' => ['bn' => 'পানির বিল কীভাবে হিসাব করা হয়?', 'en' => 'How is the water bill calculated?'],
                'a' => ['bn' => 'সংযোগের ধরন (আবাসিক, বাণিজ্যিক, প্রাতিষ্ঠানিক) অনুযায়ী প্রতি মাসে নির্দিষ্ট বিল হয়। দেরিতে দিলে জরিমানা হতে পারে।', 'en' => 'Each connection type (residential, commercial, institutional) has a fixed monthly bill. A late payment may carry a penalty.']],
            ['q' => ['bn' => 'সেচ মৌসুমের সময়সূচি কখন জানানো হয়?', 'en' => 'When is the irrigation season schedule announced?'],
                'a' => ['bn' => 'প্রতিটি মৌসুম শুরুর আগে নোটিশ বোর্ডে ও এসএমএসে সময়সূচি ও সেচ চার্জ জানানো হয়।', 'en' => 'Before every season the schedule and the irrigation charge are announced on the notice board and by SMS.']],
            ['q' => ['bn' => 'কীভাবে সদস্য হতে পারি?', 'en' => 'How can I become a member?'],
                'a' => ['bn' => 'যেকোনো সক্রিয় কৃষক ভর্তি ফি দিয়ে সদস্যপদের আবেদন করতে পারেন। কমিটির অনুমোদনের পর সদস্য নম্বর দেওয়া হয়।', 'en' => 'Any active farmer can apply for membership with the admission fee. A member number is given once the committee approves.']],
            ['q' => ['bn' => 'পানির বিল কোথায় দেব?', 'en' => 'Where can I pay my water bill?'],
                'a' => ['bn' => 'সমিতির অফিসে, মাঠকর্মীর কাছে, অথবা বিকাশ/নগদে পাঠিয়ে এই সাইটের "অনলাইনে বিল দিন" পাতায় সংযোগ নম্বর দিয়ে।', 'en' => 'At the society office, to the field collector, or by bKash/Nagad and then on the "Pay Bill Online" page of this site with your connection number.']],
            ['q' => ['bn' => 'আমার পেমেন্টের অবস্থা কীভাবে দেখব?', 'en' => 'How can I check my payment status?'],
                'a' => ['bn' => '"পেমেন্টের অবস্থা দেখুন" অংশে অনুরোধ নম্বর ও মোবাইল নম্বর দিন; যাচাই হয়েছে কি না দেখা যাবে।', 'en' => 'Open "Check Payment Status" and enter your request number and mobile number to see whether it has been verified.']],
            ['q' => ['bn' => 'রশিদ আসল কি না কীভাবে যাচাই করব?', 'en' => 'How can I verify my receipt?'],
                'a' => ['bn' => 'রশিদের QR কোড ফোনের ক্যামেরায় স্ক্যান করুন; সমিতির খাতায় থাকা তথ্য খুলবে।', 'en' => 'Scan the QR code on the receipt with your phone camera; it opens the record kept in the society records.']],
            ['q' => ['bn' => 'সেবার অনুরোধ বা অভিযোগের জন্য কার সাথে যোগাযোগ করব?', 'en' => 'Who can I contact for service requests or complaints?'],
                'a' => ['bn' => 'সমিতির অফিসে ফোন বা ইমেইল করুন, অথবা অফিস সময়ে সরাসরি আসুন। ঠিকানা ও নম্বর নিচে দেওয়া আছে।', 'en' => 'Call or email the society office, or visit during office hours. The address and numbers are given below.']],
        ],
        'facebook' => '',
        'youtube' => '',
        'instagram' => '',
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
            'brand_title.bn' => ['nullable', 'string', 'max:80'], 'brand_title.en' => ['nullable', 'string', 'max:80'],
            'brand_subtitle.bn' => ['nullable', 'string', 'max:120'], 'brand_subtitle.en' => ['nullable', 'string', 'max:120'],
            'brand_tagline.bn' => ['nullable', 'string', 'max:120'], 'brand_tagline.en' => ['nullable', 'string', 'max:120'],
            'hero_kicker.bn' => ['nullable', 'string', 'max:80'], 'hero_kicker.en' => ['nullable', 'string', 'max:80'],
            'hero_title.bn' => ['nullable', 'string', 'max:160'], 'hero_title.en' => ['nullable', 'string', 'max:160'],
            'hero_photos' => ['array', 'max:3'],
            'hero_photos.*' => ['string', 'regex:/^website\/[A-Za-z0-9]{40}\.jpg$/'],
            'about_title.bn' => ['nullable', 'string', 'max:120'], 'about_title.en' => ['nullable', 'string', 'max:120'],
            'vision.bn' => ['nullable', 'string', 'max:300'], 'vision.en' => ['nullable', 'string', 'max:300'],
            'mission.bn' => ['nullable', 'string', 'max:300'], 'mission.en' => ['nullable', 'string', 'max:300'],
            'values.bn' => ['nullable', 'string', 'max:300'], 'values.en' => ['nullable', 'string', 'max:300'],
            'faqs' => ['array', 'max:20'],
            'faqs.*.q.bn' => ['required', 'string', 'max:200'], 'faqs.*.q.en' => ['nullable', 'string', 'max:200'],
            'faqs.*.a.bn' => ['required', 'string', 'max:1000'], 'faqs.*.a.en' => ['nullable', 'string', 'max:1000'],
            'facebook' => ['nullable', 'url', 'max:300'], 'youtube' => ['nullable', 'url', 'max:300'], 'instagram' => ['nullable', 'url', 'max:300'],
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
            'brand_title' => $pair($data['brand_title'] ?? []),
            'brand_subtitle' => $pair($data['brand_subtitle'] ?? []),
            'brand_tagline' => $pair($data['brand_tagline'] ?? []),
            'hero_kicker' => $pair($data['hero_kicker'] ?? []),
            'hero_title' => $pair($data['hero_title'] ?? []),
            'hero_photos' => array_values($data['hero_photos'] ?? []),
            'about_title' => $pair($data['about_title'] ?? []),
            'vision' => $pair($data['vision'] ?? []),
            'mission' => $pair($data['mission'] ?? []),
            'values' => $pair($data['values'] ?? []),
            'faqs' => collect($data['faqs'] ?? [])->map(fn ($f) => ['q' => $pair($f['q']), 'a' => $pair($f['a'])])->values()->all(),
            'facebook' => trim((string) ($data['facebook'] ?? '')),
            'youtube' => trim((string) ($data['youtube'] ?? '')),
            'instagram' => trim((string) ($data['instagram'] ?? '')),
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
            ...($c['hero_photos'] ?? []),
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
                ['key' => 'water_connections', 'value' => DB::table('water_connections')->where('status', 'active')->count()],
            ];
        });
        if ($foundedYear !== '' && ($years = now()->year - (int) $foundedYear) > 0) {
            $stats[] = ['key' => 'years', 'value' => $years];
        }

        return array_values(array_filter($stats, fn ($s) => $s['value'] > 0));
    }
}
