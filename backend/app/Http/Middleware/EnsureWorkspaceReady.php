<?php

namespace App\Http\Middleware;

use App\Services\LicenseService;
use App\Support\Runtime\WorkspaceUnavailable;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Signed-in work needs a usable installation: refreshes the server's answer when
 * it is stale, then refuses with a 403 the app recognises (it opens the license page).
 */
class EnsureWorkspaceReady
{
    public function __construct(private LicenseService $service) {}

    public function handle(Request $request, Closure $next): Response
    {
        $s = $this->service->getEffectiveStatus();
        if ($s['state'] === 'blocked') {
            throw new WorkspaceUnavailable($s['reason'] ?? 'inactive');
        }

        return $next($request);
    }
}
