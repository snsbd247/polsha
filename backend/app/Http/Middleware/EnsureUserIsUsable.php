<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks disabled users on every request (not just at login), and users who
 * must change their password from anything except the password/profile/logout
 * endpoints.
 */
class EnsureUserIsUsable
{
    private const PASSWORD_CHANGE_ALLOWED = ['api/me', 'api/me/password', 'api/auth/logout'];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && ! $user->is_active) {
            $user->currentAccessToken()?->delete();

            return response()->json(['message' => 'আপনার অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে।'], 403);
        }

        if ($user && $user->must_change_password && ! in_array($request->path(), self::PASSWORD_CHANGE_ALLOWED, true)) {
            return response()->json(['message' => 'প্রথমে পাসওয়ার্ড পরিবর্তন করুন।', 'code' => 'password_change_required'], 403);
        }

        return $next($request);
    }
}
