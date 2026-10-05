<?php

namespace Tests\Feature;

use App\Services\SettingService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class WebsiteTest extends Phase2TestCase
{
    private function page(array $overrides = []): array
    {
        return array_replace([
            'enabled' => true, 'show_stats' => true,
            'tagline' => ['bn' => 'গ্রামের মানুষের সমিতি', 'en' => 'A society for our villages'],
            'intro' => ['bn' => 'পরিচিতি', 'en' => ''],
            'founded_year' => '১৯৯৮',
            'work_area' => ['bn' => '৫টি গ্রাম', 'en' => ''],
            'notices' => [
                ['date' => '2026-09-01', 'title' => ['bn' => 'পুরোনো নোটিশ', 'en' => ''], 'tag' => ['bn' => 'সভা', 'en' => 'Meeting']],
                ['date' => '2026-10-01', 'title' => ['bn' => 'নতুন নোটিশ', 'en' => ''], 'tag' => ['bn' => '', 'en' => '']],
            ],
            'committee' => [['name' => ['bn' => 'আব্দুল করিম', 'en' => 'Abdul Karim'], 'role' => ['bn' => 'সভাপতি', 'en' => 'President'], 'photo' => null]],
            'gallery' => [],
            'phone' => '', 'email' => '',
            'address' => ['bn' => '', 'en' => ''], 'hours' => ['bn' => 'সকাল ৯টা – বিকেল ৫টা', 'en' => ''],
            'map_url' => 'https://www.google.com/maps/embed?pb=!1m18',
        ], $overrides);
    }

    public function test_public_page_has_defaults_contact_fallbacks_and_live_numbers(): void
    {
        SettingService::setMany(['phone' => '01712-345678', 'address' => 'শিবপুর, রাজশাহী', 'registration_no' => '123/98']);
        $this->makeFarmer();

        $site = $this->getJson('/api/public/website')->assertOk()
            ->assertJsonPath('enabled', true)
            ->assertJsonPath('phone', '01712-345678')
            ->assertJsonPath('address.bn', 'শিবপুর, রাজশাহী')
            ->assertJsonPath('registration_no', '123/98')
            ->assertJsonPath('committee', [])
            ->json();
        $this->assertContains(['key' => 'farmers', 'value' => 1], $site['stats']);
        // nothing to count yet → not shown at all
        $this->assertNotContains('members', array_column($site['stats'], 'key'));
    }

    public function test_only_settings_admins_edit_the_site(): void
    {
        $this->actingAs($this->userWithRole('cashier'))->putJson('/api/settings/website', $this->page())->assertForbidden();
        $this->actingAs($this->userWithRole('cashier'))->getJson('/api/settings/website')->assertForbidden();
    }

    public function test_saving_orders_notices_reads_bangla_year_and_counts_years(): void
    {
        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->putJson('/api/settings/website', $this->page())->assertOk()
            ->assertJsonPath('founded_year', '1998')
            ->assertJsonPath('notices.0.title.bn', 'নতুন নোটিশ');

        $site = $this->getJson('/api/public/website')->assertOk()->assertJsonPath('committee.0.name.en', 'Abdul Karim')->json();
        $this->assertContains(['key' => 'years', 'value' => now()->year - 1998], $site['stats']);

        $this->actingAs($admin)->putJson('/api/settings/website', $this->page(['show_stats' => false]))->assertOk();
        $this->getJson('/api/public/website')->assertJsonPath('stats', []);
    }

    public function test_validation_rejects_bad_map_link_and_foreign_photo_paths(): void
    {
        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->putJson('/api/settings/website', $this->page([
            'map_url' => 'https://evil.example/maps/embed',
            'about_photo' => '../.env',
            'founded_year' => '3000',
        ]))->assertStatus(422)->assertJsonValidationErrors(['map_url', 'about_photo', 'founded_year']);
    }

    public function test_photos_upload_show_publicly_and_are_deleted_when_removed(): void
    {
        Storage::fake('local');
        $admin = $this->userWithRole('super_admin');
        $path = $this->actingAs($admin)->post('/api/settings/website/images', ['image' => UploadedFile::fake()->image('team.png', 2400, 1600)])
            ->assertOk()->json('path');
        $this->assertMatchesRegularExpression('#^website/[A-Za-z0-9]{40}\.jpg$#', $path);
        // downscaled for the web
        [$w] = getimagesizefromstring(Storage::disk('local')->get($path));
        $this->assertSame(1600, $w);

        $this->actingAs($admin)->putJson('/api/settings/website', $this->page([
            'gallery' => [['photo' => $path, 'caption' => ['bn' => 'বার্ষিক সভা', 'en' => '']]],
        ]))->assertOk();
        $this->get('/api/public/website/images/'.basename($path))->assertOk();
        $this->get('/api/public/website/images/..%2F.env')->assertNotFound();

        $this->actingAs($admin)->putJson('/api/settings/website', $this->page(['gallery' => []]))->assertOk();
        Storage::disk('local')->assertMissing($path);
    }

    public function test_switching_the_site_off_is_public(): void
    {
        $this->actingAs($this->userWithRole('super_admin'))->putJson('/api/settings/website', $this->page(['enabled' => false]))->assertOk();
        $this->getJson('/api/public/website')->assertOk()->assertJsonPath('enabled', false);
    }

    public function test_homepage_texts_faqs_and_social_links_are_saved(): void
    {
        $this->getJson('/api/public/website')->assertOk()
            ->assertJsonPath('hero_title.en', "Reliable Water\nfor [Agriculture]\nand a Prosperous\nCommunity")
            ->assertJsonCount(8, 'faqs');

        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->putJson('/api/settings/website', $this->page([
            'hero_title' => ['bn' => "[সেচ] সবার জন্য", 'en' => ''],
            'vision' => ['bn' => '  সমৃদ্ধ গ্রাম  ', 'en' => ''],
            'faqs' => [['q' => ['bn' => 'প্রশ্ন?', 'en' => 'Question?'], 'a' => ['bn' => 'উত্তর।', 'en' => '']]],
            'facebook' => 'https://www.facebook.com/polsha',
        ]))->assertOk();
        $this->getJson('/api/public/website')->assertOk()
            ->assertJsonPath('hero_title.bn', '[সেচ] সবার জন্য')
            ->assertJsonPath('vision.bn', 'সমৃদ্ধ গ্রাম')
            ->assertJsonPath('faqs.0.q.en', 'Question?')
            ->assertJsonPath('facebook', 'https://www.facebook.com/polsha');

        $this->actingAs($admin)->putJson('/api/settings/website', $this->page([
            'facebook' => 'not a link',
            'hero_photos' => ['website/x.jpg'],
            'faqs' => [['q' => ['bn' => ''], 'a' => ['bn' => 'উত্তর।']]],
        ]))->assertStatus(422)->assertJsonValidationErrors(['facebook', 'hero_photos.0', 'faqs.0.q.bn']);
    }
}
