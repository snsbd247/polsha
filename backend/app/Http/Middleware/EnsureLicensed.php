<?php

namespace App\Http\Middleware;

use App\Services\LicenseService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Expired license (when enforced) → read-only: every write is refused with 423 until a new key is installed. */
class EnsureLicensed
{
    /** Writes that must keep working while locked (sign in/out, own profile, installing the new key). */
    private const ALLOWED = ['api/auth/*', 'api/me', 'api/me/*', 'api/system/license'];

    public function handle(Request $request, Closure $next): Response
    {
        if (! config('license.enforce') || $request->isMethodSafe() || $request->is(...self::ALLOWED)) {
            return $next($request);
        }
        $status = LicenseService::status();
        if ($status['locked']) {
            return response()->json([
                'message' => __('লাইসেন্সের মেয়াদ শেষ — সিস্টেম এখন শুধু দেখার জন্য। নতুন লাইসেন্স কী ইনস্টল করুন।'),
                'license' => $status,
            ], 423);
        }

        return $next($request);
    }
}
