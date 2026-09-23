<?php

/*
 * Lists translation keys with no English entry in lang/en.json and keeps
 * lang/bn.json (identity map) in sync so Bangla never falls back to English.
 *   php scripts/i18n-check.php [--dump FILE]
 * Keys come from: literal __('…') calls in app/, and label maps that live in
 * config/erp.php and model constants (translated at output via App\Support\Tr).
 */

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$keys = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__.'/../app'));
foreach ($it as $file) {
    if ($file->getExtension() !== 'php') {
        continue;
    }
    $tokens = token_get_all(file_get_contents($file->getPathname()));
    foreach ($tokens as $i => $t) {
        if (is_array($t) && $t[0] === T_STRING && $t[1] === '__') {
            $j = $i + 1;
            while (isset($tokens[$j]) && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
                $j++;
            }
            if (($tokens[$j] ?? null) !== '(') {
                continue;
            }
            $j++;
            while (isset($tokens[$j]) && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
                $j++;
            }
            if (is_array($tokens[$j] ?? null) && $tokens[$j][0] === T_CONSTANT_ENCAPSED_STRING) {
                $keys[eval('return '.$tokens[$j][1].';')] = true;
            }
        }
    }
}

$labels = fn ($a) => array_values(array_filter(array_merge(...array_values(array_map(fn ($v) => is_array($v) ? [$v['label'] ?? null, $v['description'] ?? null] : [$v], $a)))));
$extra = array_merge(
    $labels(config('erp.modules')), $labels(config('erp.actions')), $labels(config('erp.roles')),
    array_merge(...array_map($labels, array_values(config('erp.farmer')))),
    $labels(config('erp.member.cancel_reasons')),
    $labels(App\Models\Land::SURVEYS), $labels(App\Models\Land::STATUSES), $labels(App\Models\Land::CULTIVATION_TYPES),
    $labels(App\Support\AreaUnit::LABELS),
    $labels((new ReflectionClassConstant(App\Http\Controllers\Api\MemberController::class, 'STATUS'))->getValue()),
    // Seeded reference data shown as labels.
    ['উঁচু জমি', 'মাঝারি উঁচু জমি', 'মাঝারি নিচু জমি', 'নিচু জমি', 'বসতভিটা', 'পুকুর/জলাশয়', 'উঁচু', 'মাঝারি', 'নিচু', 'অকৃষি'],
    ['সদস্যপদ আবেদন', 'খানা (Household)'],
    ['সদস্যপদ অনুমোদন', 'সদস্য নিষ্ক্রিয়করণ', 'সদস্য সক্রিয়করণ', 'সদস্যপদ বাতিল', 'সদস্যপদ পুনর্বহাল', 'কৃষক মার্জ'],
);
foreach ($extra as $k) {
    $keys[$k] = true;
}
$keys = array_keys(array_filter($keys, fn ($k) => preg_match('/[\x{0980}-\x{09FF}]/u', (string) $k), ARRAY_FILTER_USE_KEY));
sort($keys);

$enFile = __DIR__.'/../lang/en.json';
$en = is_file($enFile) ? json_decode(file_get_contents($enFile), true) : [];
$missing = array_values(array_filter($keys, fn ($k) => ! array_key_exists($k, $en)));

// Identity map: without it, a Bangla request would fall back to en.json.
file_put_contents(__DIR__.'/../lang/bn.json', json_encode(array_combine($keys, $keys), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n");

echo 'keys: '.count($keys).', missing: '.count($missing)."\n";
if (($i = array_search('--dump', $argv, true)) !== false) {
    file_put_contents($argv[$i + 1], json_encode(array_fill_keys($missing, ''), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
} else {
    foreach (array_slice($missing, 0, 30) as $k) {
        echo "  missing: {$k}\n";
    }
}
exit($missing ? 1 : 0);
