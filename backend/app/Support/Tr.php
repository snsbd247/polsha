<?php

namespace App\Support;

/**
 * Translate label maps that live in config/constants (which can't call __()
 * themselves) at the moment they are sent to the client.
 */
class Tr
{
    /** ['key' => 'বাংলা লেবেল'] → ['key' => __('বাংলা লেবেল')] (nested arrays too). */
    public static function map(array $labels): array
    {
        return array_map(fn ($v) => is_array($v) ? self::map($v) : (is_string($v) ? __($v) : $v), $labels);
    }

    public static function label(?string $text): ?string
    {
        return $text === null ? null : __($text);
    }
}
