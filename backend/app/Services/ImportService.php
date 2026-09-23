<?php

namespace App\Services;

use App\Models\Farmer;
use App\Models\ImportBatch;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Member;
use App\Models\Mouza;
use App\Models\Union;
use App\Models\Upazila;
use App\Models\User;
use App\Models\Village;
use App\Support\AreaUnit;
use App\Support\Bn;
use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * First-cut CSV import for farmers and lands (the full mapping wizard is
 * phase 10). Preview validates every row and stores the parsed rows under a
 * token; commit re-validates against the current database and imports the
 * valid rows under one ImportBatch so a later rollback can find them.
 */
class ImportService
{
    public const COLUMNS = [
        'farmers' => [
            'name_bn' => ['নাম', 'name'], 'name_en' => ['ইংরেজি নাম', 'english name'], 'father_name' => ['পিতার নাম', 'father'],
            'mother_name' => ['মাতার নাম', 'mother'], 'gender' => ['লিঙ্গ', 'sex'], 'nid' => ['nid', 'এনআইডি', 'জাতীয় পরিচয়পত্র'],
            'mobile' => ['মোবাইল', 'phone'], 'upazila' => ['উপজেলা'], 'union' => ['ইউনিয়ন'], 'village' => ['গ্রাম'],
            'mouza_jl' => ['মৌজা jl', 'jl', 'জেএল'], 'para' => ['পাড়া', 'বাড়ি'], 'member_no' => ['সদস্য নং', 'member no'],
            'admitted_on' => ['ভর্তির তারিখ', 'admission date'],
        ],
        'lands' => [
            'upazila' => ['উপজেলা'], 'mouza_jl' => ['মৌজা jl', 'jl', 'জেএল'], 'survey' => ['জরিপ'], 'khatian_no' => ['খতিয়ান', 'khatian'],
            'dag_no' => ['দাগ', 'dag'], 'area' => ['পরিমাণ', 'area'], 'area_unit' => ['একক', 'unit'], 'land_type' => ['জমির ধরন', 'type'],
            'status' => ['অবস্থা'], 'owners' => ['মালিক', 'owner'], 'owned_since' => ['মালিকানার তারিখ'],
            'cultivator' => ['চাষি', 'cultivator'], 'cultivation_type' => ['চাষের ধরন'], 'cultivation_since' => ['চাষ শুরুর তারিখ'],
            'terms' => ['শর্ত', 'বর্গার শর্ত'],
        ],
    ];

    public const REQUIRED = [
        'farmers' => ['name_bn', 'father_name', 'gender', 'upazila', 'union', 'village', 'mouza_jl'],
        'lands' => ['upazila', 'mouza_jl', 'khatian_no', 'dag_no', 'area', 'land_type', 'owners'],
    ];

    private const SAMPLE = [
        'farmers' => ['আব্দুল করিম', 'Abdul Karim', 'রহিম উদ্দিন', 'রহিমা খাতুন', 'পুরুষ', '1985123456', '01711223344',
            'সাভার', 'আশুলিয়া', 'পলাশবাড়ী', '12', 'উত্তর পাড়া', '96', '01/01/2010'],
        'lands' => ['সাভার', '12', 'RS', '145', '1023', '33', 'শতক', 'মাঝারি উঁচু জমি', 'চাষাধীন',
            'F-000001:50; F-000002:50', '01/01/2015', 'F-000003', 'বর্গা', '01/01/2024', 'ফসলের অর্ধেক'],
    ];

    public function __construct(private LandService $lands, private MembershipService $membership, private FarmerDuplicateService $duplicates) {}

    /** Template: header row (Bangla labels) + one sample row. */
    public function templateRows(string $type): array
    {
        $headers = array_map(fn ($aliases) => $aliases[0], self::COLUMNS[$type]);
        $headers['mouza_jl'] = 'মৌজা JL';

        return [array_values($headers), self::SAMPLE[$type]];
    }

    public function preview(string $type, UploadedFile $file, User $user): array
    {
        $rows = $this->parse($type, $file);
        [$valid, $errors, $warnings] = $this->validateRows($type, $rows, $user);

        $token = Str::uuid()->toString();
        Storage::disk('local')->put("imports/{$token}.json", json_encode([
            'type' => $type, 'user_id' => $user->id, 'filename' => $file->getClientOriginalName(), 'rows' => $rows,
        ], JSON_UNESCAPED_UNICODE));

        return [
            'token' => $token,
            'total' => count($rows),
            'valid' => count($valid),
            'errors' => $errors,
            'warnings' => $warnings,
            'sample' => array_slice(array_values($valid), 0, 20),
        ];
    }

    public function commit(string $token, bool $allowSimilar, User $user): ImportBatch
    {
        $path = "imports/{$token}.json";
        if (! Storage::disk('local')->exists($path)) {
            throw ValidationException::withMessages(['token' => 'প্রিভিউ পাওয়া যায়নি বা মেয়াদ শেষ। আবার আপলোড করুন।']);
        }
        $stored = json_decode(Storage::disk('local')->get($path), true);
        if ($stored['user_id'] !== $user->id) {
            abort(403);
        }
        $type = $stored['type'];
        [$valid, $errors, $warnings] = $this->validateRows($type, $stored['rows'], $user);
        if (! $allowSimilar) {
            $warnedLines = array_column($warnings, 'line');
            foreach ($valid as $line => $row) {
                if (in_array($line, $warnedLines, true)) {
                    unset($valid[$line]);
                    $errors[] = ['line' => $line, 'messages' => ['সতর্কতার কারণে বাদ (সম্ভাব্য ডুপ্লিকেট)']];
                }
            }
        }

        $batch = DB::transaction(function () use ($type, $stored, $valid, $errors, $user) {
            $batch = ImportBatch::create([
                'type' => $type, 'filename' => $stored['filename'], 'total_rows' => count($stored['rows']),
                'created_by' => $user->id,
            ]);
            $imported = 0;
            foreach ($valid as $line => $row) {
                try {
                    DB::transaction(fn () => $type === 'farmers' ? $this->importFarmer($row, $batch, $user) : $this->importLand($row, $batch, $user));
                    $imported++;
                } catch (ValidationException $e) {
                    $errors[] = ['line' => $line, 'messages' => collect($e->errors())->flatten()->all()];
                } catch (Throwable $e) {
                    report($e);
                    $errors[] = ['line' => $line, 'messages' => ['সংরক্ষণে ত্রুটি: '.Str::limit($e->getMessage(), 150)]];
                }
            }
            usort($errors, fn ($a, $b) => $a['line'] <=> $b['line']);
            $batch->update(['imported_rows' => $imported, 'skipped_rows' => count($stored['rows']) - $imported, 'errors' => $errors]);

            return $batch;
        });

        Storage::disk('local')->delete($path);
        AuditLogger::log('import', 'import', $batch, null, ['type' => $type, 'imported' => $batch->imported_rows, 'skipped' => $batch->skipped_rows]);

        return $batch;
    }

    // ---------------------------------------------------------------- parsing

    /** @return array<int, array<string,string>> keyed by spreadsheet line number */
    private function parse(string $type, UploadedFile $file): array
    {
        $content = (string) file_get_contents($file->getRealPath());
        $content = preg_replace('/^\xEF\xBB\xBF/', '', $content);
        if (! mb_check_encoding($content, 'UTF-8')) {
            throw ValidationException::withMessages(['file' => 'ফাইলটি UTF-8 নয়। Excel-এ "CSV UTF-8 (Comma delimited)" হিসেবে সেভ করুন।']);
        }

        $handle = fopen('php://temp', 'r+');
        fwrite($handle, $content);
        rewind($handle);

        $header = fgetcsv($handle, escape: '\\');
        if (! $header) {
            throw ValidationException::withMessages(['file' => 'ফাইল খালি।']);
        }
        $map = $this->mapHeader($type, $header);
        $missing = array_diff(self::REQUIRED[$type], array_values($map));
        if ($missing) {
            $labels = array_map(fn ($k) => self::COLUMNS[$type][$k][0], $missing);
            throw ValidationException::withMessages(['file' => 'প্রয়োজনীয় কলাম পাওয়া যায়নি: '.implode(', ', $labels).'। Template ডাউনলোড করে ব্যবহার করুন।']);
        }

        $rows = [];
        $line = 1;
        while (($cells = fgetcsv($handle, escape: '\\')) !== false) {
            $line++;
            if (count(array_filter($cells, fn ($c) => trim((string) $c) !== '')) === 0) {
                continue;
            }
            $row = [];
            foreach ($map as $index => $key) {
                $row[$key] = trim((string) ($cells[$index] ?? ''));
            }
            $rows[$line] = $row;
            if (count($rows) > 5000) {
                throw ValidationException::withMessages(['file' => 'একবারে সর্বোচ্চ ৫০০০ সারি Import করা যাবে।']);
            }
        }
        fclose($handle);

        return $rows;
    }

    private function mapHeader(string $type, array $header): array
    {
        $norm = fn ($s) => mb_strtolower(trim(preg_replace('/\s+/u', ' ', (string) $s)));
        $map = [];
        foreach ($header as $i => $h) {
            $h = $norm($h);
            foreach (self::COLUMNS[$type] as $key => $aliases) {
                if ($h === $key || in_array($h, array_map($norm, $aliases), true)) {
                    $map[$i] = $key;
                }
            }
        }

        return $map;
    }

    // ------------------------------------------------------------- validation

    /** @return array{0: array<int,array>, 1: array, 2: array} [valid rows, errors, warnings] */
    private function validateRows(string $type, array $rows, User $user): array
    {
        $valid = $errors = $warnings = [];
        $seen = [];
        foreach ($rows as $line => $row) {
            [$resolved, $errs, $warns] = $type === 'farmers'
                ? $this->validateFarmer($row, $user, $seen, $line)
                : $this->validateLand($row, $seen, $line);
            if ($errs) {
                $errors[] = ['line' => $line, 'messages' => $errs];
            } else {
                $valid[$line] = $resolved;
            }
            if ($warns) {
                $warnings[] = ['line' => $line, 'messages' => $warns];
            }
        }

        return [$valid, $errors, $warnings];
    }

    private function validateFarmer(array $r, User $user, array &$seen, int $line): array
    {
        $e = $w = [];
        foreach (self::REQUIRED['farmers'] as $k) {
            if (($r[$k] ?? '') === '') {
                $e[] = self::COLUMNS['farmers'][$k][0].' খালি';
            }
        }
        $gender = $this->gender($r['gender'] ?? '');
        if (($r['gender'] ?? '') !== '' && ! $gender) {
            $e[] = 'লিঙ্গ বোঝা যায়নি (পুরুষ/মহিলা/অন্যান্য)';
        }
        $nid = Bn::toEnDigits($r['nid'] ?? '') ?: null;
        if ($nid && ! preg_match('/^(\d{10}|\d{13}|\d{17})$/', $nid)) {
            $e[] = 'NID ১০/১৩/১৭ অঙ্কের নয়';
        }
        $mobile = Bn::toEnDigits($r['mobile'] ?? '') ?: null;
        if ($mobile && strlen($mobile) === 10 && str_starts_with($mobile, '1')) {
            $mobile = '0'.$mobile; // Excel drops the leading zero
        }
        if ($mobile && ! preg_match('/^01[3-9]\d{8}$/', $mobile)) {
            $e[] = 'মোবাইল নম্বর সঠিক নয়';
        }

        [$village, $mouza, $locErr, $locWarn] = $this->resolveLocation($r);
        $e = array_merge($e, $locErr);
        $w = array_merge($w, $locWarn);

        if ($nid) {
            if (isset($seen['nid'][$nid])) {
                $e[] = "একই NID ফাইলের {$seen['nid'][$nid]} নং সারিতেও আছে";
            } elseif (Farmer::where('nid', $nid)->exists()) {
                $e[] = 'এই NID-এর কৃষক আগে থেকেই আছেন';
            }
            $seen['nid'][$nid] ??= $line;
        }

        $memberNo = null;
        $admittedOn = null;
        if (($r['member_no'] ?? '') !== '') {
            $memberNo = (int) Bn::toEnDigits($r['member_no']);
            if (! $user->can('member.admin')) {
                $e[] = 'সদস্য নং Import করতে member.admin অনুমতি লাগবে';
            } elseif ($memberNo < 1) {
                $e[] = 'সদস্য নং সঠিক নয়';
            } elseif (isset($seen['member'][$memberNo])) {
                $e[] = "সদস্য নং {$memberNo} ফাইলের {$seen['member'][$memberNo]} নং সারিতেও আছে";
            } elseif (Member::where('member_no', $memberNo)->exists()) {
                $e[] = "সদস্য নং {$memberNo} ইতিমধ্যে ব্যবহৃত";
            }
            $seen['member'][$memberNo] ??= $line;
            $admittedOn = $this->date($r['admitted_on'] ?? '');
            if (! $admittedOn) {
                $e[] = 'সদস্য নং দিলে ভর্তির তারিখ (দিন/মাস/বছর) দিতে হবে';
            }
        }

        if (! $e && $village) {
            $similar = $this->duplicates->check(['name_bn' => $r['name_bn'], 'father_name' => $r['father_name'], 'village_id' => $village->id, 'mobile' => $mobile]);
            if ($similar['warn']) {
                $w[] = 'সম্ভাব্য ডুপ্লিকেট: '.collect($similar['warn'])->map(fn ($m) => "{$m['farmer_code']} {$m['name_bn']}")->implode(', ');
            }
        }

        return [[
            'name_bn' => $r['name_bn'], 'name_en' => ($r['name_en'] ?? '') ?: null, 'father_name' => $r['father_name'],
            'mother_name' => ($r['mother_name'] ?? '') ?: null, 'gender' => $gender, 'nid' => $nid, 'mobile' => $mobile,
            'village_id' => $village?->id, 'mouza_id' => $mouza?->id, 'para' => ($r['para'] ?? '') ?: null,
            'member_no' => $memberNo, 'admitted_on' => $admittedOn,
            // For the preview table:
            'village' => $village?->name_bn, 'mouza' => $mouza?->name_bn,
        ], $e, $w];
    }

    private function validateLand(array $r, array &$seen, int $line): array
    {
        $e = $w = [];
        foreach (self::REQUIRED['lands'] as $k) {
            if (($r[$k] ?? '') === '') {
                $e[] = self::COLUMNS['lands'][$k][0].' খালি';
            }
        }
        $upazila = $this->upazila($r['upazila'] ?? '', $e);
        $jl = Bn::toEnDigits($r['mouza_jl'] ?? '');
        $mouza = $upazila && $jl !== '' ? Mouza::where('upazila_id', $upazila->id)->where('jl_no', $jl)->first() : null;
        if ($upazila && $jl !== '' && ! $mouza) {
            $e[] = "এই উপজেলায় JL {$jl}-এর মৌজা নেই";
        }

        $survey = strtoupper(trim($r['survey'] ?? '')) ?: 'RS';
        $survey = ['আর.এস' => 'RS', 'বি.এস' => 'BS', 'এস.এ' => 'SA', 'সি.এস' => 'CS'][$survey] ?? $survey;
        if (! array_key_exists($survey, Land::SURVEYS)) {
            $e[] = 'জরিপ RS/BS/SA/CS হতে হবে';
        }
        $khatian = Bn::toEnDigits($r['khatian_no'] ?? '');
        $dag = Bn::toEnDigits($r['dag_no'] ?? '');

        $unitKey = array_search(trim($r['area_unit'] ?? ''), AreaUnit::LABELS, true) ?: (array_key_exists(trim($r['area_unit'] ?? ''), AreaUnit::LABELS) ? trim($r['area_unit']) : 'decimal');
        $area = ($r['area'] ?? '') !== '' ? AreaUnit::parse($r['area'], $unitKey) : null;
        if (($r['area'] ?? '') !== '' && (! $area || $area <= 0)) {
            $e[] = 'পরিমাণ সঠিক নয়';
        }

        $type = ($r['land_type'] ?? '') !== '' ? LandType::where('name_bn', $r['land_type'])->first() : null;
        if (($r['land_type'] ?? '') !== '' && ! $type) {
            $e[] = "জমির ধরন \"{$r['land_type']}\" তালিকায় নেই";
        }
        $status = array_search($r['status'] ?? '', Land::STATUSES, true) ?: (array_key_exists($r['status'] ?? '', Land::STATUSES) ? $r['status'] : 'cultivated');

        $owners = [];
        foreach (array_filter(array_map('trim', preg_split('/[;,]/u', $r['owners'] ?? ''))) as $part) {
            [$ref, $share] = array_pad(explode(':', $part, 2), 2, null);
            $farmer = $this->farmerRef($ref);
            if (! $farmer) {
                $e[] = "মালিক \"{$ref}\" পাওয়া যায়নি (Farmer ID, NID বা সদস্য নং দিন)";

                continue;
            }
            $owners[] = ['farmer_id' => $farmer->id, 'share_percent' => $share !== null ? (float) Bn::toEnDigits($share) : null, 'name' => $farmer->name_bn];
        }
        if ($owners) {
            $unset = array_filter($owners, fn ($o) => $o['share_percent'] === null);
            if (count($unset) === count($owners)) { // no shares given → split equally
                $each = round(100 / count($owners), 2);
                foreach ($owners as $i => $o) {
                    $owners[$i]['share_percent'] = $i === count($owners) - 1 ? round(100 - $each * (count($owners) - 1), 2) : $each;
                }
            }
            try {
                $this->lands->assertOwners($owners);
            } catch (ValidationException $ex) {
                $e = array_merge($e, collect($ex->errors())->flatten()->all());
            }
        }
        $ownedSince = ($r['owned_since'] ?? '') !== '' ? $this->date($r['owned_since']) : now()->toDateString();
        if (! $ownedSince) {
            $e[] = 'মালিকানার তারিখ বোঝা যায়নি';
        }

        $cultivation = null;
        if (($r['cultivator'] ?? '') !== '') {
            $cf = $this->farmerRef($r['cultivator']);
            $ctype = ['নিজ' => 'own', 'নিজ চাষ' => 'own', 'বর্গা' => 'borga', 'লিজ' => 'lease', 'ইজারা' => 'lease'][trim($r['cultivation_type'] ?? '')]
                ?? (in_array($r['cultivation_type'] ?? '', ['own', 'borga', 'lease'], true) ? $r['cultivation_type'] : null);
            $isOwner = $cf && in_array($cf->id, array_column($owners, 'farmer_id'), true);
            $ctype ??= $isOwner ? 'own' : 'borga';
            if (! $cf) {
                $e[] = "চাষি \"{$r['cultivator']}\" পাওয়া যায়নি";
            } elseif ($ctype === 'own' && ! $isOwner) {
                $e[] = 'নিজ চাষ হলে চাষিকে মালিকদের একজন হতে হবে';
            } elseif ($ctype === 'borga' && $isOwner) {
                $e[] = 'মালিক নিজের জমিতে বর্গাচাষি হতে পারেন না';
            }
            $since = ($r['cultivation_since'] ?? '') !== '' ? $this->date($r['cultivation_since']) : $ownedSince;
            $cultivation = $cf ? ['farmer_id' => $cf->id, 'type' => $ctype, 'terms' => ($r['terms'] ?? '') ?: null, 'start_date' => $since, 'name' => $cf->name_bn] : null;
        }

        if ($mouza && $khatian !== '' && $dag !== '') {
            $key = "{$mouza->id}|{$survey}|{$khatian}|{$dag}";
            if (isset($seen['land'][$key])) {
                $w[] = "একই মৌজা/জরিপ/খতিয়ান/দাগ ফাইলের {$seen['land'][$key]} নং সারিতেও আছে";
            } elseif ($this->lands->similar($mouza->id, $survey, $khatian, $dag)->isNotEmpty()) {
                $w[] = 'একই মৌজা/জরিপ/খতিয়ান/দাগে আগে থেকেই জমি আছে';
            }
            $seen['land'][$key] ??= $line;
        }

        return [[
            'mouza_id' => $mouza?->id, 'mouza' => $mouza?->name_bn, 'survey' => $survey, 'khatian_no' => $khatian, 'dag_no' => $dag,
            'area_decimal' => $area, 'land_type_id' => $type?->id, 'status' => $status,
            'owners' => $owners, 'owned_since' => $ownedSince, 'cultivation' => $cultivation,
        ], $e, $w];
    }

    // -------------------------------------------------------------- importing

    private function importFarmer(array $r, ImportBatch $batch, User $user): void
    {
        $farmer = Farmer::create([
            'farmer_code' => SequenceService::next('farmer'),
            'name_bn' => $r['name_bn'], 'name_en' => $r['name_en'], 'father_name' => $r['father_name'],
            'mother_name' => $r['mother_name'], 'gender' => $r['gender'], 'nid' => $r['nid'], 'mobile' => $r['mobile'],
            'village_id' => $r['village_id'], 'mouza_id' => $r['mouza_id'], 'para' => $r['para'],
            'created_by' => $user->id, 'import_batch_id' => $batch->id,
        ]);
        // Import names the pairing explicitly, so link the mouza to the village if it isn't yet.
        DB::table('mouza_village')->insertOrIgnore(['mouza_id' => $r['mouza_id'], 'village_id' => $r['village_id']]);

        if ($r['member_no']) {
            $this->membership->createLegacy($farmer, $r['member_no'], $r['admitted_on'], 'Import ব্যাচ #'.$batch->id, $user->id);
        }
    }

    private function importLand(array $r, ImportBatch $batch, User $user): void
    {
        $cult = $r['cultivation'];
        unset($cult['name']);
        $this->lands->create(
            ['mouza_id' => $r['mouza_id'], 'survey' => $r['survey'], 'khatian_no' => $r['khatian_no'], 'dag_no' => $r['dag_no'],
                'area_decimal' => $r['area_decimal'], 'land_type_id' => $r['land_type_id'], 'status' => $r['status']],
            array_map(fn ($o) => ['farmer_id' => $o['farmer_id'], 'share_percent' => $o['share_percent']], $r['owners']),
            $r['owned_since'],
            $cult ?: null,
            $user->id,
            $batch->id,
        );
    }

    // ---------------------------------------------------------------- helpers

    private function resolveLocation(array $r): array
    {
        $e = $w = [];
        $upazila = $this->upazila($r['upazila'] ?? '', $e);
        $union = $upazila && ($r['union'] ?? '') !== '' ? Union::where('upazila_id', $upazila->id)->where('name_bn', $r['union'])->first() : null;
        if ($upazila && ($r['union'] ?? '') !== '' && ! $union) {
            $e[] = "ইউনিয়ন \"{$r['union']}\" এই উপজেলায় নেই";
        }
        $village = $union && ($r['village'] ?? '') !== '' ? Village::where('union_id', $union->id)->where('name_bn', $r['village'])->first() : null;
        if ($union && ($r['village'] ?? '') !== '' && ! $village) {
            $e[] = "গ্রাম \"{$r['village']}\" এই ইউনিয়নে নেই — আগে এলাকা পাতায় যোগ করুন";
        }
        $jl = Bn::toEnDigits($r['mouza_jl'] ?? '');
        $mouza = $upazila && $jl !== '' ? Mouza::where('upazila_id', $upazila->id)->where('jl_no', $jl)->first() : null;
        if ($upazila && $jl !== '' && ! $mouza) {
            $e[] = "JL {$jl}-এর মৌজা এই উপজেলায় নেই";
        }
        if ($mouza && $village && ! $mouza->villages()->where('villages.id', $village->id)->exists()) {
            $w[] = "মৌজা {$mouza->name_bn} গ্রাম {$village->name_bn}-এর সাথে যুক্ত ছিল না — Import-এ যুক্ত করা হবে";
        }

        return [$village, $mouza, $e, $w];
    }

    private function upazila(string $name, array &$e): ?Upazila
    {
        if ($name === '') {
            return null;
        }
        $matches = Upazila::where('name_bn', $name)->get();
        if ($matches->count() === 1) {
            return $matches->first();
        }
        $e[] = $matches->isEmpty() ? "উপজেলা \"{$name}\" পাওয়া যায়নি" : "উপজেলা \"{$name}\" একাধিক জেলায় আছে";

        return null;
    }

    /** F-000123 → farmer code; 10/13/17 digits → NID; other digits → member number. */
    private function farmerRef(?string $ref): ?Farmer
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

    private function gender(string $v): ?string
    {
        $v = mb_strtolower(trim($v));

        return match (true) {
            in_array($v, ['পুরুষ', 'male', 'm', 'পু'], true) => 'male',
            in_array($v, ['মহিলা', 'নারী', 'female', 'f', 'ম'], true) => 'female',
            in_array($v, ['অন্যান্য', 'other'], true) => 'other',
            default => null,
        };
    }

    private function date(string $v): ?string
    {
        $v = trim(Bn::toEnDigits($v) ?? '');
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
}
