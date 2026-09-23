<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The SPA sends `X-Locale: bn|en` with the user's choice. Accept-Language
 * is deliberately ignored: browsers fill it from OS settings, which would
 * switch a Bangla user's messages to English. Default is Bangla.
 */
class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        app()->setLocale($request->header('X-Locale') === 'en' ? 'en' : 'bn');

        return $next($request);
    }
}
