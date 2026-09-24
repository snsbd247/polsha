<?php

namespace App\Support;

use Carbon\Carbon;
use Illuminate\Validation\ValidationException;
use SimpleXMLElement;
use ZipArchive;

/**
 * Reads the first sheet of a CSV (UTF-8) or .xlsx file into plain string
 * rows keyed by spreadsheet line number. No library: an .xlsx is a zip of
 * XML parts, and only values are needed (shared strings, inline strings,
 * numbers; date-formatted numbers come back as d/m/Y).
 */
class Spreadsheet
{
    public const MAX_ROWS = 5000;

    /** Built-in Excel number formats that are dates. */
    private const DATE_FORMATS = [14, 15, 16, 17, 22, 27, 30, 36, 50, 57];

    /** @return array<int, array<int, string>> line => cells */
    public static function read(string $path, string $extension): array
    {
        $rows = strtolower($extension) === 'xlsx' ? self::xlsx($path) : self::csv($path);
        $rows = array_filter($rows, fn ($cells) => count(array_filter($cells, fn ($c) => trim($c) !== '')) > 0);
        if (! $rows) {
            throw ValidationException::withMessages(['file' => __('ফাইল খালি।')]);
        }
        if (count($rows) > self::MAX_ROWS + 1) {
            throw ValidationException::withMessages(['file' => __('একবারে সর্বোচ্চ ৫০০০ সারি Import করা যাবে।')]);
        }

        return $rows;
    }

    private static function csv(string $path): array
    {
        $content = (string) file_get_contents($path);
        $content = preg_replace('/^\xEF\xBB\xBF/', '', $content);
        if (! mb_check_encoding($content, 'UTF-8')) {
            throw ValidationException::withMessages(['file' => __('ফাইলটি UTF-8 নয়। Excel-এ "CSV UTF-8 (Comma delimited)" হিসেবে সেভ করুন।')]);
        }
        $handle = fopen('php://temp', 'r+');
        fwrite($handle, $content);
        rewind($handle);
        $rows = [];
        $line = 0;
        while (($cells = fgetcsv($handle, escape: '\\')) !== false) {
            $line++;
            $rows[$line] = array_map(fn ($c) => trim((string) $c), $cells);
            if ($line > self::MAX_ROWS + 50) {
                break;
            }
        }
        fclose($handle);

        return $rows;
    }

    private static function xlsx(string $path): array
    {
        $zip = new ZipArchive;
        if ($zip->open($path) !== true) {
            throw ValidationException::withMessages(['file' => __('Excel ফাইলটি পড়া যায়নি।')]);
        }
        try {
            $sheetPath = self::firstSheet($zip);
            $sheetXml = $sheetPath ? $zip->getFromName($sheetPath) : false;
            if ($sheetXml === false) {
                throw ValidationException::withMessages(['file' => __('Excel ফাইলটি পড়া যায়নি।')]);
            }
            $strings = self::sharedStrings($zip);
            $dateStyles = self::dateStyles($zip);
        } finally {
            $zip->close();
        }

        $sheet = self::xml($sheetXml);
        $rows = [];
        $count = 0;
        foreach ($sheet->sheetData->row ?? [] as $row) {
            $line = (int) $row['r'] ?: (array_key_last($rows) ?? 0) + 1;
            $cells = [];
            $next = 0;
            foreach ($row->c as $c) {
                $index = isset($c['r']) ? self::columnIndex((string) $c['r']) : $next;
                $next = $index + 1;
                $cells[$index] = self::cellValue($c, $strings, $dateStyles);
            }
            if ($cells) {
                $max = max(array_keys($cells));
                $rows[$line] = array_map(fn ($i) => $cells[$i] ?? '', range(0, $max));
            }
            if (++$count > self::MAX_ROWS + 50) {
                break;
            }
        }

        return $rows;
    }

    private static function firstSheet(ZipArchive $zip): ?string
    {
        $workbook = $zip->getFromName('xl/workbook.xml');
        $rels = $zip->getFromName('xl/_rels/workbook.xml.rels');
        if ($workbook === false || $rels === false) {
            return $zip->locateName('xl/worksheets/sheet1.xml') !== false ? 'xl/worksheets/sheet1.xml' : null;
        }
        $wb = self::xml($workbook);
        $first = $wb->sheets->sheet[0] ?? null;
        $rid = $first ? (string) ($first->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'] ?? '') : '';
        foreach (self::xml($rels)->Relationship as $rel) {
            if ((string) $rel['Id'] === $rid) {
                $target = ltrim((string) $rel['Target'], '/');

                return str_starts_with($target, 'xl/') ? $target : 'xl/'.$target;
            }
        }

        return 'xl/worksheets/sheet1.xml';
    }

    private static function sharedStrings(ZipArchive $zip): array
    {
        $xml = $zip->getFromName('xl/sharedStrings.xml');
        if ($xml === false) {
            return [];
        }
        $out = [];
        foreach (self::xml($xml)->si as $si) {
            $out[] = self::richText($si);
        }

        return $out;
    }

    /** @return array<int, bool> style index => is a date format */
    private static function dateStyles(ZipArchive $zip): array
    {
        $xml = $zip->getFromName('xl/styles.xml');
        if ($xml === false) {
            return [];
        }
        $styles = self::xml($xml);
        $custom = [];
        foreach ($styles->numFmts->numFmt ?? [] as $f) {
            $code = strtolower(preg_replace('/"[^"]*"|\[[^\]]*\]/', '', (string) $f['formatCode']));
            $custom[(int) $f['numFmtId']] = (bool) preg_match('/[dy]|mmm/', $code);
        }
        $out = [];
        foreach ($styles->cellXfs->xf ?? [] as $xf) {
            $id = (int) $xf['numFmtId'];
            $out[] = in_array($id, self::DATE_FORMATS, true) || ($custom[$id] ?? false);
        }

        return $out;
    }

    private static function cellValue(SimpleXMLElement $c, array $strings, array $dateStyles): string
    {
        $type = (string) $c['t'];
        $v = isset($c->v) ? (string) $c->v : '';

        $value = match ($type) {
            's' => $strings[(int) $v] ?? '',
            'inlineStr' => self::richText($c->is),
            'b' => $v === '1' ? 'TRUE' : 'FALSE',
            'str', 'e' => $v,
            default => $v,
        };
        if (($type === '' || $type === 'n') && $v !== '' && is_numeric($v)) {
            $style = (int) $c['s'];
            if (($dateStyles[$style] ?? false) && (float) $v > 0 && (float) $v < 2958466) {
                return Carbon::create(1899, 12, 30)->addDays((int) floor((float) $v))->format('d/m/Y');
            }
            // 1.0E+10 style exponents and float noise (0.30000000000000004) back to plain text
            $f = (float) $v;
            $value = floor($f) === $f && abs($f) < 1e15 ? number_format($f, 0, '.', '') : (string) round($f, 10);
        }

        return trim($value);
    }

    private static function richText(?SimpleXMLElement $node): string
    {
        if (! $node) {
            return '';
        }
        if (isset($node->t)) {
            return (string) $node->t;
        }
        $out = '';
        foreach ($node->r ?? [] as $r) {
            $out .= (string) $r->t;
        }

        return $out;
    }

    private static function columnIndex(string $ref): int
    {
        $letters = preg_replace('/\d+/', '', strtoupper($ref));
        $n = 0;
        foreach (str_split($letters) as $ch) {
            $n = $n * 26 + (ord($ch) - 64);
        }

        return $n - 1;
    }

    private static function xml(string $content): SimpleXMLElement
    {
        $xml = simplexml_load_string($content, SimpleXMLElement::class, LIBXML_NONET | LIBXML_COMPACT);
        if ($xml === false) {
            throw ValidationException::withMessages(['file' => __('Excel ফাইলটি পড়া যায়নি।')]);
        }

        return $xml;
    }
}
