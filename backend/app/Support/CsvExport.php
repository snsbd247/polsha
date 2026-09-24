<?php

namespace App\Support;

use App\Models\ExportLog;
use Symfony\Component\HttpFoundation\StreamedResponse;

class CsvExport
{
    /**
     * Stream a CSV that Excel opens correctly with Bangla text (UTF-8 BOM).
     * Every download is written to the export audit log.
     *
     * @param  iterable<array>  $rows
     */
    public static function download(string $filename, array $headers, iterable $rows): StreamedResponse
    {
        $request = request();
        $userId = $request->user()?->id;
        $filters = collect($request->query())->except('export')->all();
        $ip = $request->ip();

        return response()->streamDownload(function () use ($headers, $rows, $filename, $userId, $filters, $ip) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, $headers);
            $count = 0;
            foreach ($rows as $row) {
                fputcsv($out, array_map(fn ($v) => $v instanceof \DateTimeInterface ? $v->format('d/m/Y') : $v, $row));
                $count++;
            }
            fclose($out);
            if ($userId) {
                ExportLog::create([
                    'user_id' => $userId, 'report_key' => substr(pathinfo($filename, PATHINFO_FILENAME), 0, 60), 'title' => $filename,
                    'format' => 'csv', 'filters' => $filters ?: null, 'row_count' => $count, 'ip' => $ip,
                ]);
            }
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
