<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Super Admin passes every permission check.
        Gate::before(fn ($user) => $user->hasRole('super_admin') ? true : null);

        // "Recheck now" on the license page: once per 30 seconds per user
        RateLimiter::for('license-recheck', fn (Request $request) => Limit::perSecond(1, (int) config('license.recheck_seconds', 30))
            ->by('license-recheck:'.($request->user()?->id ?: $request->ip())));
    }
}
