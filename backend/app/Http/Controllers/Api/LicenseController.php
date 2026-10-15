<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\LicenseService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Any signed-in user may see the license, enter a key and ask for a recheck — these work even while blocked. */
class LicenseController extends Controller
{
    public function __construct(private LicenseService $licenses) {}

    public function status(): JsonResponse
    {
        return response()->json($this->licenses->status());
    }

    public function activate(Request $request): JsonResponse
    {
        $data = $request->validate(['license_key' => ['required', 'string', 'min:4', 'max:200']], [
            'license_key.required' => __('লাইসেন্স কী দিন।'),
        ]);
        $r = $this->licenses->activate($data['license_key']);

        return response()->json(['ok' => $r['ok'], 'message' => $r['message'], 'license' => $this->licenses->status()], $r['ok'] ? 200 : 422);
    }

    /** Asks the server now, whatever the 6-hour cache says (rate-limited per user). */
    public function recheck(): JsonResponse
    {
        $r = $this->licenses->verify(true);

        return response()->json(['ok' => $r['ok'], 'message' => $r['message'], 'license' => $this->licenses->status()]);
    }
}
