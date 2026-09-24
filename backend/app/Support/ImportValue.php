<?php

namespace App\Support;

use App\Models\Farmer;
use Carbon\Carbon;
use Throwable;

/** Cell parsers shared by every import type (Bangla digits accepted everywhere). */
class ImportValue
{
    /** F-000123 → farmer code; 10/13/17 digits → NID; other digits → member number. */
    public static function farmer(?string $ref): ?Farmer
    {
        $ref = trim(Bn::toEnDigits($ref ?? '') ?? '');
        if ($ref === '') {
            return null;
        }
        $q = Farmer::query()->whereNull('merged_into_id');
        if (str_starts_with(strtoupper($ref), 'F-')) {
            return $q->where('farmer_code', strtoupper($ref))->first();
        }
        if (preg_match('/^(\d{10}|\d{13}|\d{17})$/', $ref)) {
            return $q->where('nid', $ref)->first();
        }
        if (ctype_digit($ref)) {
            return $q->whereHas('member', fn ($m) => $m->where('member_no', (int) $ref))->first();
        }

        return null;
    }

    /** d/m/Y (also 1/1/2010, d-m-Y, Y-m-d, d.m.Y); never a future date. */
    public static function date(?string $v): ?string
    {
        $v = trim(Bn::toEnDigits($v ?? '') ?? '');
        // j/n accept "1/1/2010" as well as "01/01/2010"; round-trip rejects 31/02 etc.
        foreach (['j/n/Y', 'd/m/Y', 'j-n-Y', 'd-m-Y', 'Y-m-d', 'j.n.Y'] as $fmt) {
            try {
                $d = Carbon::createFromFormat('!'.$fmt, $v);
                if ($d && $d->format($fmt) === $v && $d->lte(now())) {
                    return $d->toDateString();
                }
            } catch (Throwable) {
            }
        }

        return null;
    }

    /** "১২,৫০০.৫০", "12500", "৳ 1,200" → float; null when not a number. */
    public static function amount(?string $v): ?float
    {
        $v = str_replace([',', '৳', ' ', 'টাকা', 'Tk', 'tk'], '', trim(Bn::toEnDigits($v ?? '') ?? ''));
        if ($v === '' || ! is_numeric($v)) {
            return null;
        }

        return round((float) $v, 2);
    }

    public static function method(?string $v): ?string
    {
        $v = mb_strtolower(trim($v ?? ''));

        return match (true) {
            $v === '' || in_array($v, ['নগদ', 'cash', 'ক্যাশ'], true) => 'cash',
            in_array($v, ['ব্যাংক', 'bank'], true) => 'bank',
            default => null,
        };
    }
}
