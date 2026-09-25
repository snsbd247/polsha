<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sequence;
use App\Services\SequenceService;
use App\Services\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SettingController extends Controller
{
    public function index(): JsonResponse
    {
        $all = SettingService::all();
        $all['logo_url'] = $all['logo'] ? url('api/public/logo') : null;
        $all['signature_set'] = (bool) $all['signature'];
        $all['seal_set'] = (bool) $all['seal'];
        unset($all['installation_id']);
        foreach (SettingService::SECRET_KEYS as $key) {
            $all[$key.'_set'] = (string) $all[$key] !== '';
            unset($all[$key]);
        }

        return response()->json($all);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'society_name_bn' => ['required', 'string', 'max:200'],
            'society_name_en' => ['nullable', 'string', 'max:200'],
            'registration_no' => ['nullable', 'string', 'max:50'],
            'registration_date' => ['nullable', 'date'],
            'address' => ['nullable', 'string', 'max:300'],
            'phone' => ['nullable', 'string', 'max:50'],
            'email' => ['nullable', 'email'],
            'society_type' => ['required', Rule::in(self::SOCIETY_TYPES)],
            'contact_person' => ['nullable', 'string', 'max:150'],
            'contact_designation' => ['nullable', 'string', 'max:100'],
            'contact_mobile' => ['nullable', 'string', 'max:50'],
            'contact_mobile_alt' => ['nullable', 'string', 'max:50'],
            'contact_email' => ['nullable', 'email', 'max:150'],
            'phone_alt' => ['nullable', 'string', 'max:50'],
            'website' => ['nullable', 'url', 'max:200'],
            'print_address' => ['nullable', 'string', 'max:300'],
            'society_remarks' => ['nullable', 'string', 'max:300'],
            'default_location' => ['nullable', 'array', 'max:5'],
            'default_location.*' => ['nullable', 'integer'],
            'default_mouza_id' => ['nullable', 'exists:mouzas,id'],
            'timezone' => ['required', Rule::in(['Asia/Dhaka'])],
            'date_format' => ['required', Rule::in(['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD'])],
            'default_locale' => ['required', 'in:bn,en'],
            'currency_symbol' => ['required', 'string', 'max:5'],
        ]);
        foreach (['society_name_en', 'registration_no', 'address', 'phone', 'email', 'contact_person', 'contact_designation', 'contact_mobile', 'contact_mobile_alt', 'contact_email', 'phone_alt', 'website', 'print_address', 'society_remarks'] as $k) {
            if (array_key_exists($k, $data)) {
                $data[$k] ??= '';
            }
        }
        // keep the chosen levels only (a path may stop above village)
        $data['default_location'] = array_values(array_filter($data['default_location'] ?? [], fn ($v) => $v !== null));
        SettingService::setMany($data);

        return $this->index();
    }

    public const SOCIETY_TYPES = ['agricultural', 'irrigation', 'multipurpose', 'savings_credit', 'other'];

    /** Business rules, edited on the System Preferences screen. */
    private const RULES = [
        'fiscal_year_start_month' => ['required', 'integer', 'between:1,12'],
        'current_fiscal_year' => ['nullable', 'regex:/^\d{4}-\d{2}$/'],
        'digits' => ['required', 'in:bn,en'],
        'admission_fee' => ['required', 'numeric', 'min:0'],
        'voter_min_membership_months' => ['required', 'integer', 'min:0'],
        'bigha_decimal' => ['required', 'numeric', 'min:1', 'max:200'],
        'loan_max_guarantees' => ['required', 'integer', 'min:1', 'max:20'],
        'combined_payment_order' => ['required', 'array', 'size:3'],
        'combined_payment_order.*' => ['required', 'distinct', 'in:loan,irrigation,share'],
        'share_min_amount' => ['required', 'numeric', 'min:0'],
        'share_unit_price' => ['required', 'numeric', 'gt:0'],
    ];

    /** Branding, receipt/print and preference screens each save their own group. */
    public function updateSection(Request $request, string $section): JsonResponse
    {
        $rules = match ($section) {
            'branding' => [
                'brand_color' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
                'letterhead_text' => ['nullable', 'string', 'max:200'],
                'document_footer' => ['nullable', 'string', 'max:300'],
                'member_card_note' => ['nullable', 'string', 'max:300'],
            ],
            'receipt' => [
                'receipt_sign_left' => ['required', 'string', 'max:60'],
                'receipt_sign_right' => ['required', 'string', 'max:60'],
                'receipt_footer_note' => ['nullable', 'string', 'max:300'],
                'receipt_show_qr' => ['required', 'boolean'],
                'receipt_show_due' => ['required', 'boolean'],
                'receipt_copies' => ['required', 'integer', 'in:1,2'],
                'receipt_paper' => ['required', 'in:a4,a5,thermal'],
            ],
            'preferences' => [
                'default_locale' => ['required', 'in:bn,en'],
                'page_size' => ['required', 'integer', 'in:10,25,50,100'],
                'idle_logout_minutes' => ['required', 'integer', 'min:0', 'max:480'],
                'go_live_date' => ['nullable', 'date'],
            ] + array_map(fn (array $r) => ['sometimes', ...$r], self::RULES),
            default => abort(404),
        };
        $data = $request->validate($rules);
        foreach (['letterhead_text', 'document_footer', 'member_card_note', 'receipt_footer_note'] as $k) {
            if (array_key_exists($k, $data)) {
                $data[$k] ??= '';
            }
        }
        SettingService::setMany($data);

        return $this->index();
    }

    /** Logo, authorised signature or seal image. */
    public function uploadImage(Request $request, string $slot): JsonResponse
    {
        abort_unless(in_array($slot, SettingService::IMAGES, true), 404);
        $request->validate(['image' => ['required', 'image', 'mimes:png,jpg,jpeg', 'max:500']]);

        $old = SettingService::get($slot);
        $path = $request->file('image')->store('branding', 'local');
        SettingService::setMany([$slot => $path]);
        if ($old) {
            Storage::disk('local')->delete($old);
        }

        return $this->index();
    }

    public function removeImage(string $slot): JsonResponse
    {
        abort_unless(in_array($slot, SettingService::IMAGES, true), 404);
        if ($old = SettingService::get($slot)) {
            SettingService::setMany([$slot => null]);
            Storage::disk('local')->delete($old);
        }

        return $this->index();
    }

    /** Signature/seal are only served to signed-in users (they appear on printed documents). */
    public function image(string $slot)
    {
        abort_unless(in_array($slot, SettingService::IMAGES, true), 404);
        $path = SettingService::get($slot);
        abort_unless($path && Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path);
    }

    public function uploadLogo(Request $request): JsonResponse
    {
        $request->validate(['logo' => ['required', 'image', 'mimes:png,jpg,jpeg', 'max:500']]);

        $old = SettingService::get('logo');
        $path = $request->file('logo')->store('branding', 'local');
        SettingService::setMany(['logo' => $path]);
        if ($old) {
            Storage::disk('local')->delete($old);
        }

        return $this->index();
    }

    public function logo()
    {
        $path = SettingService::get('logo');
        abort_unless($path && Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path);
    }

    public function sequences(): JsonResponse
    {
        return response()->json(Sequence::orderBy('id')->get()->map(fn ($s) => array_merge($s->toArray(), [
            'label' => __($s->label), // seeded labels are translation keys
            'preview' => SequenceService::preview($s),
        ])));
    }

    public function updateSequence(Request $request, Sequence $sequence): JsonResponse
    {
        $data = $request->validate([
            'prefix' => ['nullable', 'string', 'max:20'],
            'pad_length' => ['required', 'integer', 'between:0,10'],
            'next_value' => ['required', 'integer', 'min:1'],
            'reset_yearly' => ['required', 'boolean'],
        ]);

        // Lowering the counter would re-issue numbers already printed on paper.
        if ($data['next_value'] < $sequence->next_value) {
            throw ValidationException::withMessages(['next_value' => __('পরবর্তী নম্বর কমানো যাবে না।')]);
        }
        $data['prefix'] ??= '';
        $sequence->update($data);

        return response()->json($sequence->toArray() + ['preview' => SequenceService::preview($sequence)]);
    }
}
