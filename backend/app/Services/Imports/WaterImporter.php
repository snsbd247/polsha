<?php

namespace App\Services\Imports;

use App\Models\Account;
use App\Models\Farmer;
use App\Models\ImportBatch;
use App\Models\Village;
use App\Models\WaterBill;
use App\Models\WaterConnection;
use App\Models\WaterConnectionType;
use App\Services\LedgerService;
use App\Services\SequenceService;
use App\Services\SettingService;
use App\Support\Bn;
use Carbon\Carbon;

/**
 * Water customers from the paper register: one row = one connection, with
 * the dues it already owed on the go-live day (booked as an "old due" bill
 * against opening-balance equity, like the other money imports).
 */
class WaterImporter
{
    public function __construct(private LedgerService $ledger) {}

    /** @return array{0: array, 1: list<string>, 2: list<string>} resolved row, errors, warnings */
    public function validate(array $r, array &$seen, int $line): array
    {
        $e = $w = [];
        foreach (['name_bn' => 'নাম', 'type' => 'সংযোগের ধরন', 'connected_on' => 'সংযোগের তারিখ'] as $k => $label) {
            if (trim((string) ($r[$k] ?? '')) === '') {
                $e[] = __($label).__(' খালি');
            }
        }

        $typeText = mb_strtolower(trim((string) ($r['type'] ?? '')));
        $type = $typeText === '' ? null : WaterConnectionType::get()->first(fn ($t) => in_array($typeText, array_map('mb_strtolower', array_filter([$t->code, $t->name_bn, $t->name_en])), true));
        if ($typeText !== '' && ! $type) {
            $e[] = __('সংযোগের ধরন ":p0" পাওয়া যায়নি (কোড বা নাম দিন)', ['p0' => $r['type']]);
        }

        $mobile = Bn::toEnDigits(trim((string) ($r['mobile'] ?? ''))) ?: null;
        if ($mobile && strlen($mobile) === 10 && str_starts_with($mobile, '1')) {
            $mobile = '0'.$mobile; // Excel drops the leading zero
        }
        if ($mobile && ! preg_match('/^01[3-9]\d{8}$/', $mobile)) {
            $e[] = __('মোবাইল নম্বর সঠিক নয়');
        }

        $connectedOn = self::date($r['connected_on'] ?? '');
        if (($r['connected_on'] ?? '') !== '' && ! $connectedOn) {
            $e[] = __('সংযোগের তারিখ বোঝা যায়নি (দিন/মাস/বছর)');
        } elseif ($connectedOn && $connectedOn > now()->toDateString()) {
            $e[] = __('সংযোগের তারিখ ভবিষ্যতের');
        }

        $fee = self::money($r['monthly_fee'] ?? '');
        $due = self::money($r['due'] ?? '') ?? 0.0;
        foreach (['monthly_fee' => $fee, 'due' => $due] as $k => $v) {
            if (trim((string) ($r[$k] ?? '')) !== '' && self::money($r[$k]) === null) {
                $e[] = __('টাকার অঙ্ক বোঝা যায়নি: :p0', ['p0' => $r[$k]]);
            }
        }
        if (($fee !== null && $fee < 0) || $due < 0) {
            $e[] = __('টাকার অঙ্ক ঋণাত্মক হতে পারে না');
        }

        $villageId = null;
        if (($name = trim((string) ($r['village'] ?? ''))) !== '') {
            $villages = Village::where('name_bn', $name)->orWhere('name_en', $name)->get(['id', 'union_id']);
            $union = (array) SettingService::get('default_location', []);
            $village = $villages->count() > 1 && isset($union[3]) ? $villages->firstWhere('union_id', $union[3]) : null;
            $village ??= $villages->count() === 1 ? $villages->first() : null;
            if ($village) {
                $villageId = $village->id;
            } else {
                $w[] = $villages->isEmpty() ? __('গ্রাম ":p0" পাওয়া যায়নি — খালি রাখা হবে', ['p0' => $name])
                    : __('":p0" নামে একাধিক গ্রাম — খালি রাখা হবে, পরে সংযোগের পাতায় ঠিক করুন', ['p0' => $name]);
            }
        }

        $farmerId = null;
        if (($code = trim(Bn::toEnDigits((string) ($r['farmer_code'] ?? '')))) !== '') {
            $farmerId = Farmer::where('farmer_code', $code)->value('id');
            if (! $farmerId) {
                $e[] = __('কৃষক আইডি :p0 পাওয়া যায়নি', ['p0' => $code]);
            }
        }

        // the same person and address twice in one file is most likely a copied row
        $key = mb_strtolower(trim((string) ($r['name_bn'] ?? ''))).'|'.$mobile.'|'.mb_strtolower(trim((string) ($r['address'] ?? '')));
        if (isset($seen['water'][$key])) {
            $w[] = __('একই গ্রাহক ও ঠিকানা ফাইলের :p0 নং সারিতেও আছে', ['p0' => $seen['water'][$key]]);
        }
        $seen['water'][$key] ??= $line;

        return [[
            'name_bn' => trim((string) ($r['name_bn'] ?? '')), 'name_en' => trim((string) ($r['name_en'] ?? '')) ?: null,
            'father_name' => trim((string) ($r['father_name'] ?? '')) ?: null, 'mobile' => $mobile, 'village_id' => $villageId,
            'address' => trim((string) ($r['address'] ?? '')) ?: null, 'type_id' => $type?->id, 'monthly_fee' => $fee,
            'connected_on' => $connectedOn, 'farmer_id' => $farmerId, 'due' => round($due, 2),
        ], $e, $w];
    }

    /** Creates the connection and its old-due bill; returns the money brought in. */
    public function import(array $r, ImportBatch $batch): float
    {
        $connection = WaterConnection::create([
            'connection_no' => SequenceService::next('water_connection'), 'type_id' => $r['type_id'], 'farmer_id' => $r['farmer_id'],
            'name_bn' => $r['name_bn'], 'name_en' => $r['name_en'], 'father_name' => $r['father_name'], 'mobile' => $r['mobile'],
            'village_id' => $r['village_id'], 'address' => $r['address'], 'monthly_fee' => $r['monthly_fee'], 'connected_on' => $r['connected_on'],
            'status' => 'active', 'remarks' => __('পুরনো খাতা থেকে ইমপোর্ট (ব্যাচ #:id)', ['id' => $batch->id]),
            'created_by' => auth()->id(), 'import_batch_id' => $batch->id,
        ]);
        if ($r['due'] <= 0) {
            return 0.0;
        }
        $date = FinanceImporter::openingDate();
        $bill = WaterBill::create([
            'bill_no' => SequenceService::next('water_bill'), 'connection_id' => $connection->id, 'kind' => 'opening', 'period' => null,
            'bill_date' => $date, 'due_date' => null, 'amount' => $r['due'], 'penalty' => 0, 'paid_amount' => 0, 'status' => 'unpaid',
            'snapshot' => $connection->snapshot(), 'created_by' => auth()->id(), 'import_batch_id' => $batch->id,
        ]);
        $journal = $this->ledger->postNow('journal', $date,
            __('পুরনো পানির বিল বকেয়া :no — :name, সংযোগ :conn', ['no' => $bill->bill_no, 'name' => $connection->name_bn, 'conn' => $connection->connection_no]),
            [['account_id' => Account::byKey('water_receivable')->id, 'debit' => $r['due']],
                ['account_id' => Account::byKey('opening_balance_equity')->id, 'credit' => $r['due']]],
            'water', $bill);
        $bill->update(['journal_id' => $journal->id]);

        return (float) $r['due'];
    }

    private static function date(string $v): ?string
    {
        $v = trim(Bn::toEnDigits($v));
        foreach (['d/m/Y', 'd-m-Y', 'd.m.Y', 'Y-m-d'] as $f) {
            try {
                $d = Carbon::createFromFormat('!'.$f, $v);
            } catch (\Throwable) {
                continue;
            }
            if ($d && $d->format($f) === $v) {
                return $d->toDateString();
            }
        }

        return null;
    }

    private static function money(string $v): ?float
    {
        $v = str_replace([',', '৳', ' '], '', trim(Bn::toEnDigits($v)));

        return $v === '' ? null : (is_numeric($v) ? (float) $v : null);
    }
}
