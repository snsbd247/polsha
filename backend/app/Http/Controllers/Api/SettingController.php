<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sequence;
use App\Services\SequenceService;
use App\Services\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class SettingController extends Controller
{
    public function index(): JsonResponse
    {
        $all = SettingService::all();
        $all['logo_url'] = $all['logo'] ? url('api/public/logo') : null;

        return response()->json($all);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'society_name_bn' => ['required', 'string', 'max:200'],
            'society_name_en' => ['nullable', 'string', 'max:200'],
            'registration_no' => ['nullable', 'string', 'max:50'],
            'registration_date' => ['nullable', 'date'],
            'address' => ['nullable', 'string', 'max:500'],
            'phone' => ['nullable', 'string', 'max:50'],
            'email' => ['nullable', 'email'],
            'fiscal_year_start_month' => ['required', 'integer', 'between:1,12'],
            'current_fiscal_year' => ['nullable', 'regex:/^\d{4}-\d{2}$/'],
            'digits' => ['required', 'in:bn,en'],
            'currency_symbol' => ['required', 'string', 'max:5'],
            'admission_fee' => ['required', 'numeric', 'min:0'],
            'voter_min_membership_months' => ['required', 'integer', 'min:0'],
            'bigha_decimal' => ['required', 'numeric', 'min:1', 'max:200'],
            'loan_max_guarantees' => ['required', 'integer', 'min:1', 'max:20'],
        ]);
        SettingService::setMany($data);

        return $this->index();
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
