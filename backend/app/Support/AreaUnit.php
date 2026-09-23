<?php

namespace App\Support;

use App\Services\SettingService;

/** Land area units. Everything is stored in decimals (শতক). */
class AreaUnit
{
    public const LABELS = ['decimal' => 'শতক', 'acre' => 'একর', 'bigha' => 'বিঘা', 'katha' => 'কাঠা', 'hectare' => 'হেক্টর'];

    /** How many decimals one unit holds. Bigha (and katha = bigha/20) follow the local setting. */
    public static function factors(): array
    {
        $bigha = (float) SettingService::get('bigha_decimal', 33);

        return ['decimal' => 1.0, 'acre' => 100.0, 'bigha' => $bigha, 'katha' => $bigha / 20, 'hectare' => 247.105];
    }

    public static function toDecimal(float $value, string $unit): float
    {
        return round($value * (self::factors()[$unit] ?? 1.0), 4);
    }

    /** Accept "33", "৩৩", "1.5 একর", "2 bigha" … as used in legacy spreadsheets. */
    public static function parse(string $raw, string $defaultUnit = 'decimal'): ?float
    {
        $s = trim(Bn::toEnDigits($raw) ?? '');
        if (! preg_match('/^([\d.]+)\s*(.*)$/u', $s, $m) || ! is_numeric($m[1])) {
            return null;
        }
        $unitText = mb_strtolower(trim($m[2]));
        $unit = $defaultUnit;
        foreach (self::LABELS as $key => $label) {
            if ($unitText === $key || $unitText === $label) {
                $unit = $key;
            }
        }

        return self::toDecimal((float) $m[1], $unit);
    }
}
