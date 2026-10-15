<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\LicenseController;
use App\Http\Controllers\Api\ProfileController;
use App\Services\SettingService;
use App\Support\Runtime\Continuity;
use Illuminate\Http\Request;

abstract class Controller
{
    /** Signed-in actions that must work on an installation that is not usable yet (sign in/out, own profile, activation). */
    private const ALWAYS_OPEN = [AuthController::class, LicenseController::class, ProfileController::class];

    /**
     * Every action of every controller passes through here: a signed-in user's
     * request on an installation that may not work stops before the action runs.
     */
    public function callAction($method, $parameters)
    {
        if (request()->user() && ! in_array(static::class, self::ALWAYS_OPEN, true)) {
            Continuity::ensure();
        }

        return $this->{$method}(...array_values($parameters));
    }

    protected function perPage(Request $request): int
    {
        $n = (int) $request->query('per_page', SettingService::get('page_size', 25));

        return in_array($n, [5, 10, 25, 50, 100], true) ? $n : 25;
    }
}
