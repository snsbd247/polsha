<?php

namespace App\Services;

use App\Models\Sequence;
use Illuminate\Support\Facades\DB;

class SequenceService
{
    /**
     * Reserve and return the next formatted number. Row lock prevents two
     * concurrent requests from getting the same value; call it inside the
     * same transaction that saves the record so a rollback frees nothing
     * but also leaks nothing twice.
     */
    public static function next(string $key): string
    {
        return DB::transaction(function () use ($key) {
            $seq = Sequence::where('key', $key)->lockForUpdate()->firstOrFail();

            $year = (int) now()->format('Y');
            if ($seq->reset_yearly && $seq->current_year !== $year) {
                $seq->next_value = 1;
                $seq->current_year = $year;
            }

            $value = $seq->next_value;
            $seq->next_value = $value + 1;
            $seq->saveQuietly();

            return self::format($seq, $value, $year);
        });
    }

    public static function preview(Sequence $seq): string
    {
        $year = (int) now()->format('Y');
        $value = $seq->reset_yearly && $seq->current_year !== $year ? 1 : $seq->next_value;

        return self::format($seq, $value, $year);
    }

    private static function format(Sequence $seq, int $value, int $year): string
    {
        $prefix = str_replace('{YYYY}', (string) $year, $seq->prefix);
        $number = $seq->pad_length > 0 ? str_pad((string) $value, $seq->pad_length, '0', STR_PAD_LEFT) : (string) $value;

        return $prefix.$number;
    }
}
