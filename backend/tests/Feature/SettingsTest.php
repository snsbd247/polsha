<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Backup;
use App\Services\BackupService;
use App\Services\SettingService;
use Illuminate\Support\Facades\Storage;

class SettingsTest extends Phase2TestCase
{
    private function general(array $overrides = []): array
    {
        return array_merge([
            'society_name_bn' => 'শিবপুর সমবায় সমিতি', 'society_name_en' => 'Shibpur Cooperative', 'society_type' => 'irrigation',
            'contact_person' => 'Md. Abdul Karim', 'contact_designation' => 'President', 'website' => 'https://example.org',
            'print_address' => "Village: Shibpur\nPhone: 01712-345678", 'default_location' => [1, 1, 1, 1, $this->village->id],
            'default_mouza_id' => $this->mouza->id, 'timezone' => 'Asia/Dhaka', 'date_format' => 'DD-MM-YYYY',
            'default_locale' => 'en', 'currency_symbol' => '৳',
        ], $overrides);
    }

    public function test_general_settings_save_society_profile_and_defaults(): void
    {
        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->putJson('/api/settings', $this->general())->assertOk()
            ->assertJson(['society_type' => 'irrigation', 'contact_person' => 'Md. Abdul Karim', 'date_format' => 'DD-MM-YYYY']);

        // the print address replaces the plain address on documents
        $this->assertSame("Village: Shibpur\nPhone: 01712-345678", SettingService::society()['address']);
        // the new-farmer form reads the defaults from the public settings
        $this->getJson('/api/public/settings')->assertOk()
            ->assertJson(['default_location' => [1, 1, 1, 1, $this->village->id], 'default_mouza_id' => $this->mouza->id, 'date_format' => 'DD-MM-YYYY']);

        // business rules are no longer part of this form and stay untouched
        $this->assertSame(33, (int) SettingService::get('bigha_decimal'));
    }

    public function test_general_settings_validation(): void
    {
        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->putJson('/api/settings', $this->general(['society_type' => 'bank', 'website' => 'not a url', 'date_format' => 'MM/DD']))
            ->assertStatus(422)->assertJsonValidationErrors(['society_type', 'website', 'date_format']);
        $this->actingAs($admin)->putJson('/api/settings', $this->general(['print_address' => str_repeat('a', 301)]))
            ->assertStatus(422)->assertJsonValidationErrors('print_address');
    }

    public function test_business_rules_are_saved_from_preferences(): void
    {
        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->putJson('/api/settings/preferences', [
            'default_locale' => 'bn', 'page_size' => 25, 'idle_logout_minutes' => 0,
            'fiscal_year_start_month' => 1, 'digits' => 'en', 'admission_fee' => 100, 'voter_min_membership_months' => 6,
            'bigha_decimal' => 30, 'loan_max_guarantees' => 3, 'combined_payment_order' => ['irrigation', 'loan', 'share'],
            'share_min_amount' => 500, 'share_unit_price' => 20,
        ])->assertOk()->assertJson(['admission_fee' => 100, 'bigha_decimal' => 30, 'share_unit_price' => 20]);

        $this->actingAs($admin)->putJson('/api/settings/preferences', ['default_locale' => 'bn', 'page_size' => 25, 'idle_logout_minutes' => 0, 'share_unit_price' => 0])
            ->assertStatus(422)->assertJsonValidationErrors('share_unit_price');
    }
    public function test_backups_are_emailed_off_site_in_a_locked_zip(): void
    {
        $admin = $this->userWithRole('super_admin');
        config(['mail.default' => 'array']);
        Storage::fake('local');
        Storage::disk('local')->put(BackupService::DIR.'/polsha-20261001-020000.sql.gz', gzencode('-- dump'));
        $backup = Backup::create(['filename' => 'polsha-20261001-020000.sql.gz', 'size' => 10, 'type' => 'auto']);

        // no address yet: nothing is sent
        $this->actingAs($admin)->postJson("/api/backups/{$backup->id}/email")->assertStatus(422);
        $this->assertFalse(app(BackupService::class)->email($backup));

        $this->actingAs($admin)->putJson('/api/backups/settings', ['backup_email' => 'not-an-email'])->assertStatus(422);
        $this->actingAs($admin)->putJson('/api/backups/settings', ['backup_email' => 'office@example.org', 'zip_password' => 'secret-pass-1'])
            ->assertOk()->assertJson(['backup_email' => 'office@example.org', 'zip_password_set' => true])->assertJsonMissing(['secret-pass-1']);
        // the password is a secret: never in the settings API, and logged only as changed
        $this->assertStringNotContainsString('secret-pass-1', $this->actingAs($admin)->getJson('/api/settings')->getContent());
        $this->assertSame(0, AuditLog::where('new_values', 'like', '%secret-pass-1%')->count());

        $this->actingAs($admin)->postJson("/api/backups/{$backup->id}/email")->assertOk()->assertJson(['emailed_to' => 'office@example.org', 'email_error' => null]);
        $sent = app('mailer')->getSymfonyTransport()->messages();
        $this->assertCount(1, $sent);
        $attachment = $sent[0]->getOriginalMessage()->getAttachments()[0];
        $this->assertSame('polsha-20261001-020000.zip', $attachment->getFilename());
        $this->assertNotNull($backup->fresh()->emailed_at);

        // a missing file is recorded, not thrown
        Storage::disk('local')->delete(BackupService::DIR.'/polsha-20261001-020000.sql.gz');
        $this->actingAs($admin)->postJson("/api/backups/{$backup->id}/email")->assertStatus(422);
        $this->assertNotNull($backup->fresh()->email_error);

        // only the super admin manages backups
        $this->actingAs($this->userWithRole('manager'))->getJson('/api/backups/settings')->assertForbidden();
    }
}
