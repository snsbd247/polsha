<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

abstract class Controller
{
    protected function perPage(Request $request): int
    {
        $n = (int) $request->query('per_page', 25);

        return in_array($n, [10, 25, 50, 100], true) ? $n : 25;
    }
}
