<?php

namespace App\Support;

class Bn
{
    private const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

    private const EN = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

    /** Normalise Bangla digits typed into numeric fields (mobile, NID, member no). */
    public static function toEnDigits(?string $value): ?string
    {
        return $value === null ? null : str_replace(self::BN, self::EN, trim($value));
    }

    public static function toBnDigits(string|int|null $value): ?string
    {
        return $value === null ? null : str_replace(self::EN, self::BN, (string) $value);
    }
}
