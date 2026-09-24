<?php

namespace App\Http\Controllers;

use App\Services\SettingService;
use Illuminate\Http\Request;

abstract class Controller
{
    protected function perPage(Request $request): int
    {
        $n = (int) $request->query('per_page', SettingService::get('page_size', 25));

        return in_array($n, [10, 25, 50, 100], true) ? $n : 25;
    }
}
