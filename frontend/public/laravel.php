<?php

/*
| Front controller for /api/* on shared hosting.
| The React build lives in public_html; Laravel lives outside it in
| ~/polsha/backend so its code and .env are never web-reachable.
| .htaccess rewrites /api/... here. Local dev (Vite) never uses this file.
*/

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$backend = getenv('POLSHA_BACKEND') ?: dirname(__DIR__).'/polsha/backend';

if (file_exists($maintenance = $backend.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $backend.'/vendor/autoload.php';

/** @var Illuminate\Foundation\Application $app */
$app = require_once $backend.'/bootstrap/app.php';

$app->handleRequest(Request::capture());
