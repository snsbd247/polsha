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
use App\Services\Imports\FinanceImporter;
use App\Support\AreaUnit;
use App\Support\Bn;
use App\Support\ImportValue;
use App\Support\Spreadsheet;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Data migration wizard. A CSV/xlsx upload is stored under an upload token;
 * the user maps its columns to fields (auto-guessed from the header); the
 * mapped rows are validated into a preview token; commit re-validates
 * against the current database and imports the valid rows under one
 * ImportBatch, so the audit page and a later rollback can find them.
 */
class ImportService
{
    /** type => [label, permission needed besides import.create, money type?] */
    public const TYPES = [
        'farmers' => ['কৃষক', 'farmer.create', false],
        'lands' => ['জমি', 'land.create', false],
        'savings_opening' => ['সঞ্চয় প্রারম্ভিক জের', 'savings.create', true],
        'share_opening' => ['শেয়ার প্রারম্ভিক জের', 'share.create', true],
        'loan_opening' => ['চলমান ঋণ', 'loan.create', true],
        'legacy_irrigation' => ['পুরনো সেচ বকেয়া', 'irrigation.create', true],
        'payments' => ['পুরনো রশিদ', 'payment.create', true],
    ];

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
        'savings_opening' => [
            'member_ref' => ['সদস্য নং', 'member no', 'সদস্য', 'nid', 'farmer id'], 'amount' => ['জের', 'টাকা', 'balance', 'amount', 'স্থিতি'],
            'date' => ['তারিখ', 'date'], 'remarks' => ['মন্তব্য', 'remarks'],
        ],
        'share_opening' => [
            'member_ref' => ['সদস্য নং', 'member no', 'সদস্য', 'nid', 'farmer id'], 'amount' => ['শেয়ার মূলধন', 'জের', 'টাকা', 'amount'],
            'date' => ['তারিখ', 'date'], 'remarks' => ['মন্তব্য', 'remarks'],
        ],
        'loan_opening' => [
            'member_ref' => ['সদস্য নং', 'member no', 'সদস্য', 'nid'], 'product' => ['ঋণের ধরন', 'product', 'ঋণ পণ্য'],
            'amount' => ['মূল ঋণ', 'ঋণের পরিমাণ', 'loan amount'], 'disbursed_on' => ['বিতরণের তারিখ', 'disbursed on'],
            'first_due_on' => ['প্রথম কিস্তির তারিখ', 'first due'], 'principal_outstanding' => ['বকেয়া আসল', 'outstanding principal'],
            'interest_outstanding' => ['বকেয়া সুদ', 'outstanding interest'], 'legacy_no' => ['পুরনো ঋণ নং', 'old loan no'],
        ],
        'legacy_irrigation' => [
            'land_code' => ['জমির কোড', 'land code'], 'upazila' => ['উপজেলা'], 'mouza_jl' => ['মৌজা jl', 'jl', 'জেএল'],
            'khatian_no' => ['খতিয়ান', 'khatian'], 'dag_no' => ['দাগ', 'dag'], 'season' => ['মৌসুম', 'season'],
            'amount' => ['বিলের টাকা', 'বিল', 'amount'], 'paid' => ['আদায়', 'আদায়কৃত', 'paid'],
            'invoice_date' => ['বিলের তারিখ', 'তারিখ', 'date'], 'cultivator' => ['চাষি', 'cultivator'],
        ],
        'payments' => [
            'legacy_no' => ['পুরনো রশিদ নং', 'রশিদ নং', 'receipt no'], 'date' => ['তারিখ', 'date'],
            'invoice_no' => ['ইনভয়েস নং', 'invoice no'], 'land_code' => ['জমির কোড', 'land code'], 'season' => ['মৌসুম', 'season'],
            'amount' => ['টাকা', 'পরিমাণ', 'amount'], 'method' => ['মাধ্যম', 'method'], 'payer' => ['প্রদানকারী', 'payer'],
            'remarks' => ['মন্তব্য', 'remarks'],
        ],
    ];

    public const REQUIRED = [
        'farmers' => ['name_bn', 'father_name', 'gender', 'upazila', 'union', 'village', 'mouza_jl'],
        'lands' => ['upazila', 'mouza_jl', 'khatian_no', 'dag_no', 'area', 'land_type', 'owners'],
        'savings_opening' => ['member_ref', 'amount'],
        'share_opening' => ['member_ref', 'amount'],
        'loan_opening' => ['member_ref', 'product', 'amount', 'disbursed_on', 'principal_outstanding'],
        'legacy_irrigation' => ['season', 'amount'],
        'payments' => ['legacy_no', 'date', 'amount'],
    ];

    private const SAMPLE = [
        'farmers' => ['আব্দুল করিম', 'Abdul Karim', 'রহিম উদ্দিন', 'রহিমা খাতুন', 'পুরুষ', '1985123456', '01711223344',
            'সাভার', 'আশুলিয়া', 'পলাশবাড়ী', '12', 'উত্তর পাড়া', '96', '01/01/2010'],
        'lands' => ['সাভার', '12', 'RS', '145', '1023', '33', 'শতক', 'মাঝারি উঁচু জমি', 'চাষাধীন',
            'F-000001:50; F-000002:50', '01/01/2015', 'F-000003', 'বর্গা', '01/01/2024', 'ফসলের অর্ধেক'],
        'savings_opening' => ['96', '12,500', '', 'খাতা নং ৩, পৃষ্ঠা ১২'],
        'share_opening' => ['96', '5000', '', ''],
        'loan_opening' => ['96', 'কৃষি ঋণ', '50000', '15/01/2026', '', '30000', '', 'পুরনো-১২'],
        'legacy_irrigation' => ['L-000001', '', '', '', '', 'বোরো ২০২৫', '3300', '1000', '15/03/2025', ''],
        'payments' => ['১২৩৪', '20/04/2025', 'IRR-000010', '', '', '1500', 'নগদ', 'আব্দুল করিম', ''],
    ];

    /** How long an unfinished upload/preview is kept. */
    private const TTL_HOURS = 24;

    public function __construct(
        private LandService $lands,
        private MembershipService $membership,
        private FarmerDuplicateService $duplicates,
        private FinanceImporter $finance,
    ) {}

    public static function isMoney(string $type): bool
    {
        return self::TYPES[$type][2] ?? false;
    }

    public function canImport(User $user, string $type): bool
    {
        return $user->can('import.create') && $user->can(self::TYPES[$type][1]);
    }

    /** Field list for the mapping step. */
    public function columns(string $type): array
    {
        return collect(self::COLUMNS[$type])->map(fn ($aliases, $key) => [
            'key' => $key, 'label' => $key === 'mouza_jl' ? __('মৌজা JL') : __($aliases[0]),
            'required' => in_array($key, self::REQUIRED[$type], true),
        ])->values()->all();
    }

    /** Template: header row (Bangla labels) + one sample row. */
    public function templateRows(string $type): array
    {
        $headers = array_map(fn ($aliases) => $aliases[0], self::COLUMNS[$type]);
        $headers['mouza_jl'] = 'মৌজা JL';

        return [array_values($headers), self::SAMPLE[$type]];
    }

    /** Step 1: read the file, keep the raw cells, and guess the column mapping. */
    public function upload(string $type, UploadedFile $file, User $user): array
    {
        $this->prune();
        $raw = Spreadsheet::read($file->getRealPath(), $file->getClientOriginalExtension());
        $headerLine = array_key_first($raw);
        $header = $raw[$headerLine];
        unset($raw[$headerLine]);
        if (! $raw) {
            throw ValidationException::withMessages(['file' => __('শিরোনাম ছাড়া কোনো সারি নেই।')]);
        }
        $token = Str::uuid()->toString();
        Storage::disk('local')->put("imports/upload-{$token}.json", json_encode([
            'type' => $type, 'user_id' => $user->id, 'filename' => $file->getClientOriginalName(), 'header' => $header, 'rows' => $raw,
        ], JSON_UNESCAPED_UNICODE));

        $guess = [];
        foreach ($this->mapHeader($type, $header) as $index => $key) {
            $guess[$key] ??= $index;
        }

        return [
            'upload_token' => $token,
            'filename' => $file->getClientOriginalName(),
            'total' => count($raw),
            'headers' => array_map(fn ($h, $i) => ['index' => $i, 'label' => $h !== '' ? $h : __('কলাম :n', ['n' => $i + 1])], $header, array_keys($header)),
            'sample' => array_map(fn ($cells) => array_values($cells), array_slice(array_values($raw), 0, 5)),
            'columns' => $this->columns($type),
            'mapping' => (object) $guess,
        ];
    }

    /** Step 2: apply the chosen mapping (field => column index) and validate. */
    public function validateMapped(string $uploadToken, array $mapping, User $user): array
    {
        $stored = $this->stored("imports/upload-{$uploadToken}.json", $user);
        $type = $stored['type'];
        $mapping = array_filter($mapping, fn ($i, $k) => $i !== null && $i !== '' && isset(self::COLUMNS[$type][$k]), ARRAY_FILTER_USE_BOTH);
        $missing = array_diff(self::REQUIRED[$type], array_keys($mapping));
        if ($missing) {
            throw ValidationException::withMessages(['mapping' => __('প্রয়োজনীয় কলাম মেলানো হয়নি: ').implode(', ', array_map(fn ($k) => __(self::COLUMNS[$type][$k][0]), $missing))]);
        }
        $rows = [];
        foreach ($stored['rows'] as $line => $cells) {
            $rows[(int) $line] = array_map(fn ($i) => trim((string) ($cells[(int) $i] ?? '')), $mapping);
        }
        $headers = [];
        foreach ($mapping as $key => $i) {
            $headers[$key] = $stored['header'][(int) $i] ?? '';
        }

        return $this->previewRows($type, $rows, $stored['filename'], $headers, $user);
    }

    /** One-shot upload with the automatic mapping (kept for the farmer/land pages). */
    public function preview(string $type, UploadedFile $file, User $user): array
    {
        $up = $this->upload($type, $file, $user);
        $mapping = (array) $up['mapping'];
        $missing = array_diff(self::REQUIRED[$type], array_keys($mapping));
        if ($missing) {
            $labels = array_map(fn ($k) => self::COLUMNS[$type][$k][0], $missing);
            throw ValidationException::withMessages(['file' => __('প্রয়োজনীয় কলাম পাওয়া যায়নি: ').implode(', ', $labels).__('। Template ডাউনলোড করে ব্যবহার করুন।')]);
        }

        return $this->validateMapped($up['upload_token'], $mapping, $user);
    }

    private function previewRows(string $type, array $rows, string $filename, array $mapping, User $user): array
    {
        [$valid, $errors, $warnings] = $this->validateRows($type, $rows, $user);

        $token = Str::uuid()->toString();
        Storage::disk('local')->put("imports/{$token}.json", json_encode([
            'type' => $type, 'user_id' => $user->id, 'filename' => $filename, 'rows' => $rows, 'mapping' => $mapping,
        ], JSON_UNESCAPED_UNICODE));

        return [
            'token' => $token,
            'type' => $type,
            'total' => count($rows),
            'valid' => count($valid),
            'amount' => round(array_sum(array_map(fn ($r) => (float) ($r['principal_outstanding'] ?? $r['due'] ?? $r['amount'] ?? 0), $valid)), 2),
            'errors' => $errors,
            'warnings' => $warnings,
            'sample' => array_slice(array_values($valid), 0, 20),
        ];
    }

    private function stored(string $path, User $user): array
    {
        if (! Storage::disk('local')->exists($path)) {
            throw ValidationException::withMessages(['token' => __('প্রিভিউ পাওয়া যায়নি বা মেয়াদ শেষ। আবার আপলোড করুন।')]);
        }
        $stored = json_decode(Storage::disk('local')->get($path), true);
        if ($stored['user_id'] !== $user->id) {
            abort(403);
        }
        abort_unless($this->canImport($user, $stored['type']), 403);

        return $stored;
    }

    /** Uploads and previews nobody finished. */
    private function prune(): void
    {
        $disk = Storage::disk('local');
        foreach ($disk->files('imports') as $f) {
            if ($disk->lastModified($f) < now()->subHours(self::TTL_HOURS)->getTimestamp()) {
                $disk->delete($f);
            }
        }
    }

    public function commit(string $token, bool $allowSimilar, User $user): ImportBatch
    {
        $path = "imports/{$token}.json";
        $stored = $this->stored($path, $user);
        $type = $stored['type'];
        [$valid, $errors, $warnings] = $this->validateRows($type, $stored['rows'], $user);
        // Duplicate-suspect warnings only exist for farmers and lands; money warnings are informational.
        if (! $allowSimilar && ! self::isMoney($type)) {
            $warnedLines = array_column($warnings, 'line');
            foreach ($valid as $line => $row) {
                if (in_array($line, $warnedLines, true)) {
                    unset($valid[$line]);
                    $errors[] = ['line' => $line, 'messages' => [__('সতর্কতার কারণে বাদ (সম্ভাব্য ডুপ্লিকেট)')]];
                }
            }
        }

        $batch = DB::transaction(function () use ($type, $stored, $valid, $errors, $user) {
            $batch = ImportBatch::create([
                'type' => $type, 'filename' => $stored['filename'], 'total_rows' => count($stored['rows']),
                'mapping' => $stored['mapping'] ?? null, 'created_by' => $user->id,
            ]);
            $imported = 0;
            $amount = 0.0;
            foreach ($valid as $line => $row) {
                try {
                    $amount += (float) DB::transaction(fn () => match ($type) {
                        'farmers' => $this->importFarmer($row, $batch, $user),
                        'lands' => $this->importLand($row, $batch, $user),
                        default => $this->finance->import($type, $row, $batch),
                    });
                    $imported++;
                } catch (ValidationException $e) {
                    $errors[] = ['line' => $line, 'messages' => collect($e->errors())->flatten()->all()];
                } catch (Throwable $e) {
                    report($e);
                    $errors[] = ['line' => $line, 'messages' => [__('সংরক্ষণে ত্রুটি: ').Str::limit($e->getMessage(), 150)]];
                }
            }
            usort($errors, fn ($a, $b) => $a['line'] <=> $b['line']);
            $batch->update(['imported_rows' => $imported, 'skipped_rows' => count($stored['rows']) - $imported, 'errors' => $errors, 'total_amount' => round($amount, 2)]);

            return $batch;
        });

        Storage::disk('local')->delete($path);
        AuditLogger::log('import', 'import', $batch, null, ['type' => $type, 'imported' => $batch->imported_rows, 'skipped' => $batch->skipped_rows, 'amount' => (float) $batch->total_amount]);

        return $batch;
    }

    // ---------------------------------------------------------------- mapping

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
            [$resolved, $errs, $warns] = match ($type) {
                'farmers' => $this->validateFarmer($row, $user, $seen, $line),
                'lands' => $this->validateLand($row, $seen, $line),
                default => $this->finance->validate($type, $row, $seen, $line),
            };
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
                $e[] = self::COLUMNS['farmers'][$k][0].__(' খালি');
            }
        }
        $gender = $this->gender($r['gender'] ?? '');
        if (($r['gender'] ?? '') !== '' && ! $gender) {
            $e[] = __('লিঙ্গ বোঝা যায়নি (পুরুষ/মহিলা/অন্যান্য)');
        }
        $nid = Bn::toEnDigits($r['nid'] ?? '') ?: null;
        if ($nid && ! preg_match('/^(\d{10}|\d{13}|\d{17})$/', $nid)) {
            $e[] = __('NID ১০/১৩/১৭ অঙ্কের নয়');
        }
        $mobile = Bn::toEnDigits($r['mobile'] ?? '') ?: null;
        if ($mobile && strlen($mobile) === 10 && str_starts_with($mobile, '1')) {
            $mobile = '0'.$mobile; // Excel drops the leading zero
        }
        if ($mobile && ! preg_match('/^01[3-9]\d{8}$/', $mobile)) {
            $e[] = __('মোবাইল নম্বর সঠিক নয়');
        }

        [$village, $mouza, $locErr, $locWarn] = $this->resolveLocation($r);
        $e = array_merge($e, $locErr);
        $w = array_merge($w, $locWarn);

        if ($nid) {
            if (isset($seen['nid'][$nid])) {
                $e[] = __('একই NID ফাইলের :p0 নং সারিতেও আছে', ['p0' => $seen['nid'][$nid]]);
            } elseif (Farmer::where('nid', $nid)->exists()) {
                $e[] = __('এই NID-এর কৃষক আগে থেকেই আছেন');
            }
            $seen['nid'][$nid] ??= $line;
        }

        $memberNo = null;
        $admittedOn = null;
        if (($r['member_no'] ?? '') !== '') {
            $memberNo = (int) Bn::toEnDigits($r['member_no']);
            if (! $user->can('member.admin')) {
                $e[] = __('সদস্য নং Import করতে member.admin অনুমতি লাগবে');
            } elseif ($memberNo < 1) {
                $e[] = __('সদস্য নং সঠিক নয়');
            } elseif (isset($seen['member'][$memberNo])) {
                $e[] = __('সদস্য নং :p0 ফাইলের :p1 নং সারিতেও আছে', ['p0' => $memberNo, 'p1' => $seen['member'][$memberNo]]);
            } elseif (Member::where('member_no', $memberNo)->exists()) {
                $e[] = __('সদস্য নং :p0 ইতিমধ্যে ব্যবহৃত', ['p0' => $memberNo]);
            }
            $seen['member'][$memberNo] ??= $line;
            $admittedOn = $this->date($r['admitted_on'] ?? '');
            if (! $admittedOn) {
                $e[] = __('সদস্য নং দিলে ভর্তির তারিখ (দিন/মাস/বছর) দিতে হবে');
            }
        }

        if (! $e && $village) {
            $similar = $this->duplicates->check(['name_bn' => $r['name_bn'], 'father_name' => $r['father_name'], 'village_id' => $village->id, 'mobile' => $mobile]);
            if ($similar['warn']) {
                $w[] = __('সম্ভাব্য ডুপ্লিকেট: ').collect($similar['warn'])->map(fn ($m) => "{$m['farmer_code']} {$m['name_bn']}")->implode(', ');
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
                $e[] = self::COLUMNS['lands'][$k][0].__(' খালি');
            }
        }
        $upazila = $this->upazila($r['upazila'] ?? '', $e);
        $jl = Bn::toEnDigits($r['mouza_jl'] ?? '');
        $mouza = $upazila && $jl !== '' ? Mouza::where('upazila_id', $upazila->id)->where('jl_no', $jl)->first() : null;
        if ($upazila && $jl !== '' && ! $mouza) {
            $e[] = __('এই উপজেলায় JL :p0-এর মৌজা নেই', ['p0' => $jl]);
        }

        $survey = strtoupper(trim($r['survey'] ?? '')) ?: 'RS';
        $survey = ['আর.এস' => 'RS', 'বি.এস' => 'BS', 'এস.এ' => 'SA', 'সি.এস' => 'CS'][$survey] ?? $survey;
        if (! array_key_exists($survey, Land::SURVEYS)) {
            $e[] = __('জরিপ RS/BS/SA/CS হতে হবে');
        }
        $khatian = Bn::toEnDigits($r['khatian_no'] ?? '');
        $dag = Bn::toEnDigits($r['dag_no'] ?? '');

        $unitKey = array_search(trim($r['area_unit'] ?? ''), AreaUnit::LABELS, true) ?: (array_key_exists(trim($r['area_unit'] ?? ''), AreaUnit::LABELS) ? trim($r['area_unit']) : 'decimal');
        $area = ($r['area'] ?? '') !== '' ? AreaUnit::parse($r['area'], $unitKey) : null;
        if (($r['area'] ?? '') !== '' && (! $area || $area <= 0)) {
            $e[] = __('পরিমাণ সঠিক নয়');
        }

        $type = ($r['land_type'] ?? '') !== '' ? LandType::where('name_bn', $r['land_type'])->first() : null;
        if (($r['land_type'] ?? '') !== '' && ! $type) {
            $e[] = __('জমির ধরন ":p0" তালিকায় নেই', ['p0' => $r['land_type']]);
        }
        $status = array_search($r['status'] ?? '', Land::STATUSES, true) ?: (array_key_exists($r['status'] ?? '', Land::STATUSES) ? $r['status'] : 'cultivated');

        $owners = [];
        foreach (array_filter(array_map('trim', preg_split('/[;,]/u', $r['owners'] ?? ''))) as $part) {
            [$ref, $share] = array_pad(explode(':', $part, 2), 2, null);
            $farmer = $this->farmerRef($ref);
            if (! $farmer) {
                $e[] = __('মালিক ":p0" পাওয়া যায়নি (Farmer ID, NID বা সদস্য নং দিন)', ['p0' => $ref]);

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
            $e[] = __('মালিকানার তারিখ বোঝা যায়নি');
        }

        $cultivation = null;
        if (($r['cultivator'] ?? '') !== '') {
            $cf = $this->farmerRef($r['cultivator']);
            $ctype = ['নিজ' => 'own', 'নিজ চাষ' => 'own', 'বর্গা' => 'borga', 'লিজ' => 'lease', 'ইজারা' => 'lease'][trim($r['cultivation_type'] ?? '')]
                ?? (in_array($r['cultivation_type'] ?? '', ['own', 'borga', 'lease'], true) ? $r['cultivation_type'] : null);
            $isOwner = $cf && in_array($cf->id, array_column($owners, 'farmer_id'), true);
            $ctype ??= $isOwner ? 'own' : 'borga';
            if (! $cf) {
                $e[] = __('চাষি ":p0" পাওয়া যায়নি', ['p0' => $r['cultivator']]);
            } elseif ($ctype === 'own' && ! $isOwner) {
                $e[] = __('নিজ চাষ হলে চাষিকে মালিকদের একজন হতে হবে');
            } elseif ($ctype === 'borga' && $isOwner) {
                $e[] = __('মালিক নিজের জমিতে বর্গাচাষি হতে পারেন না');
            }
            $since = ($r['cultivation_since'] ?? '') !== '' ? $this->date($r['cultivation_since']) : $ownedSince;
            $cultivation = $cf ? ['farmer_id' => $cf->id, 'type' => $ctype, 'terms' => ($r['terms'] ?? '') ?: null, 'start_date' => $since, 'name' => $cf->name_bn] : null;
        }

        if ($mouza && $khatian !== '' && $dag !== '') {
            $key = "{$mouza->id}|{$survey}|{$khatian}|{$dag}";
            if (isset($seen['land'][$key])) {
                $w[] = __('একই মৌজা/জরিপ/খতিয়ান/দাগ ফাইলের :p0 নং সারিতেও আছে', ['p0' => $seen['land'][$key]]);
            } elseif ($this->lands->similar($mouza->id, $survey, $khatian, $dag)->isNotEmpty()) {
                $w[] = __('একই মৌজা/জরিপ/খতিয়ান/দাগে আগে থেকেই জমি আছে');
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
            $this->membership->createLegacy($farmer, $r['member_no'], $r['admitted_on'], __('Import ব্যাচ #').$batch->id, $user->id);
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
            $e[] = __('ইউনিয়ন ":p0" এই উপজেলায় নেই', ['p0' => $r['union']]);
        }
        $village = $union && ($r['village'] ?? '') !== '' ? Village::where('union_id', $union->id)->where('name_bn', $r['village'])->first() : null;
        if ($union && ($r['village'] ?? '') !== '' && ! $village) {
            $e[] = __('গ্রাম ":p0" এই ইউনিয়নে নেই — আগে এলাকা পাতায় যোগ করুন', ['p0' => $r['village']]);
        }
        $jl = Bn::toEnDigits($r['mouza_jl'] ?? '');
        $mouza = $upazila && $jl !== '' ? Mouza::where('upazila_id', $upazila->id)->where('jl_no', $jl)->first() : null;
        if ($upazila && $jl !== '' && ! $mouza) {
            $e[] = __('JL :p0-এর মৌজা এই উপজেলায় নেই', ['p0' => $jl]);
        }
        if ($mouza && $village && ! $mouza->villages()->where('villages.id', $village->id)->exists()) {
            $w[] = __('মৌজা :p0 গ্রাম :p1-এর সাথে যুক্ত ছিল না — Import-এ যুক্ত করা হবে', ['p0' => $mouza->name_bn, 'p1' => $village->name_bn]);
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
        $e[] = $matches->isEmpty() ? __('উপজেলা ":p0" পাওয়া যায়নি', ['p0' => $name]) : __('উপজেলা ":p0" একাধিক জেলায় আছে', ['p0' => $name]);

        return null;
    }

    private function farmerRef(?string $ref): ?Farmer
    {
        return ImportValue::farmer($ref);
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
        return ImportValue::date($v);
    }
}
