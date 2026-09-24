<?php

/*
 * Wraps user-facing Bangla strings in app/ with __() so they follow the
 * request locale. Bangla text stays the translation key (lang/en.json maps
 * it to English). Safe to re-run.
 *
 * Not wrapped (they are data or input-matching, not messages):
 *   - class constants and property defaults (e.g. import column aliases)
 *   - array keys
 *   - strings inside functions listed in SKIP_FUNCTIONS
 *
 *   php scripts/i18n-wrap.php [--dry]      → rewrite (or report)
 *   php scripts/i18n-wrap.php --keys FILE  → also write every key to FILE
 */

// Input-matching code: translating these would break matching in English mode.
const SKIP_FUNCTIONS = ['gender', 'normalizeName'];
const BANGLA = '/[\x{0980}-\x{09FF}]/u';

$dry = in_array('--dry', $argv, true);
$keysFile = ($i = array_search('--keys', $argv, true)) !== false ? $argv[$i + 1] : null;
$root = dirname(__DIR__).'/app';
$allKeys = [];
$total = 0;

$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
foreach ($it as $file) {
    if ($file->getExtension() !== 'php') {
        continue;
    }
    $path = $file->getPathname();
    $src = file_get_contents($path);
    if (! preg_match(BANGLA, $src)) {
        continue;
    }

    $tokens = token_get_all($src);
    $n = count($tokens);
    $text = fn ($t) => is_array($t) ? $t[1] : $t;
    $id = fn ($t) => is_array($t) ? $t[0] : $t;
    $isWs = fn ($t) => is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true);
    $prev = function ($i) use ($tokens, $isWs) {
        for ($j = $i - 1; $j >= 0; $j--) {
            if (! $isWs($tokens[$j])) {
                return $j;
            }
        }

        return -1;
    };
    $next = function ($i) use ($tokens, $n, $isWs) {
        for ($j = $i + 1; $j < $n; $j++) {
            if (! $isWs($tokens[$j])) {
                return $j;
            }
        }

        return $n;
    };

    // Mark token ranges to leave alone: const/property declarations and skipped functions.
    $skip = array_fill(0, $n, false);
    $braceDepth = 0;
    $parenDepth = 0;
    $classDepth = null;
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        if ($t === '(') {
            $parenDepth++;
        } elseif ($t === ')') {
            $parenDepth--;
        }
        // `Foo::class` is also a T_CLASS token — only a declaration starts a class body.
        $afterDoubleColon = ($pc = $prev($i)) >= 0 && $id($tokens[$pc]) === T_DOUBLE_COLON;
        if (($id($t) === T_CLASS || $id($t) === T_TRAIT) && ! $afterDoubleColon) {
            $classDepth = $braceDepth + 1;
        }
        if ($t === '{' || $id($t) === T_CURLY_OPEN || $id($t) === T_DOLLAR_OPEN_CURLY_BRACES) {
            $braceDepth++;
        } elseif ($t === '}') {
            $braceDepth--;
        }
        // `const X = …;` and class-level `… $prop = …;`
        // Method parameters also sit at class brace depth — exclude anything inside parentheses.
        $classLevel = $classDepth !== null && $braceDepth === $classDepth && $parenDepth === 0;
        if ($id($t) === T_CONST || ($classLevel && $id($t) === T_VARIABLE)) {
            for ($j = $i; $j < $n && $tokens[$j] !== ';'; $j++) {
                $skip[$j] = true;
            }
        }
        if ($id($t) === T_FUNCTION) {
            $nameIdx = $next($i);
            if ($nameIdx < $n && in_array($text($tokens[$nameIdx]), SKIP_FUNCTIONS, true)) {
                $depth = 0;
                for ($j = $nameIdx; $j < $n; $j++) {
                    $skip[$j] = true;
                    if ($tokens[$j] === '{') {
                        $depth++;
                    } elseif ($tokens[$j] === '}' && --$depth === 0) {
                        break;
                    }
                }
            }
        }
    }

    $out = '';
    $edits = 0;
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        $p = $prev($i);
        $alreadyWrapped = $p >= 0 && $tokens[$p] === '(' && ($pp = $prev($p)) >= 0 && $text($tokens[$pp]) === '__';
        $isKey = ($nx = $next($i)) < $n && $id($tokens[$nx]) === T_DOUBLE_ARROW;

        // Plain literal: 'text' or "text" without variables.
        if ($id($t) === T_CONSTANT_ENCAPSED_STRING && preg_match(BANGLA, $t[1]) && ! $skip[$i] && ! $alreadyWrapped && ! $isKey) {
            $value = eval('return '.$t[1].';');
            $allKeys[$value] = true;
            $out .= '__('.$t[1].')';
            $edits++;

            continue;
        }

        // Interpolated "… {$x} …" → __('… :p0 …', ['p0' => $x])
        if ($t === '"' && ! $skip[$i]) {
            $end = $i + 1;
            while ($end < $n && $tokens[$end] !== '"') {
                $end++;
            }
            $inner = array_slice($tokens, $i + 1, $end - $i - 1);
            $literal = implode('', array_map(fn ($x) => $id($x) === T_ENCAPSED_AND_WHITESPACE ? $x[1] : '', $inner));
            $closeNext = $next($end);
            $isKeyStr = $closeNext < $n && $id($tokens[$closeNext]) === T_DOUBLE_ARROW;
            if (preg_match(BANGLA, $literal) && ! $alreadyWrapped && ! $isKeyStr) {
                $key = '';
                $params = [];
                for ($k = 0; $k < count($inner); $k++) {
                    $x = $inner[$k];
                    if ($id($x) === T_ENCAPSED_AND_WHITESPACE) {
                        $key .= stripcslashes(str_replace(['\\$'], ['$'], $x[1]));

                        continue;
                    }
                    // Collect one interpolated expression.
                    $expr = '';
                    if ($id($x) === T_CURLY_OPEN) {
                        $depth = 1;
                        for ($k++; $k < count($inner); $k++) {
                            if ($inner[$k] === '{' || $id($inner[$k]) === T_CURLY_OPEN) {
                                $depth++;
                            } elseif ($inner[$k] === '}' && --$depth === 0) {
                                break;
                            }
                            $expr .= $text($inner[$k]);
                        }
                    } else { // simple "$var" / "$var->prop" / "$var[0]"
                        $expr = $text($x);
                        while ($k + 1 < count($inner) && $id($inner[$k + 1]) !== T_ENCAPSED_AND_WHITESPACE) {
                            $expr .= $text($inner[++$k]);
                        }
                    }
                    $name = 'p'.count($params);
                    $params[] = "'{$name}' => {$expr}";
                    $key .= ':'.$name;
                }
                $allKeys[$key] = true;
                $quoted = "'".str_replace(['\\', "'"], ['\\\\', "\\'"], $key)."'";
                $out .= '__('.$quoted.', ['.implode(', ', $params).'])';
                $edits++;
                $i = $end;

                continue;
            }
        }

        $out .= $text($t);
    }

    if ($edits) {
        $total += $edits;
        echo str_replace(dirname(__DIR__).DIRECTORY_SEPARATOR, '', $path).": {$edits}\n";
        if (! $dry) {
            file_put_contents($path, $out);
        }
    }
}

echo "total edits: {$total}".($dry ? ' (dry run)' : '')."\n";
if ($keysFile) {
    $keys = array_keys($allKeys);
    sort($keys);
    file_put_contents($keysFile, json_encode(array_fill_keys($keys, ''), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo count($keys)." keys written to {$keysFile}\n";
}
