<?php

namespace Tests\Feature;

use App\Services\SettingService;

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
}
