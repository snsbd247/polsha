<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Brings in every division, district, upazila and union of Bangladesh from
 * the bundled open dataset (database/data/bd-locations.json, from
 * nuhil/bangladesh-geocode, MIT). Places already in the database are kept
 * and matched by their Bangla or English name, so farmers, mouzas and
 * villages already pointing at them stay put; only what is missing is added.
 * Running it again changes nothing. Villages are not in any open dataset;
 * they are added where they are needed.
 *
 * Written straight to the tables: one audit entry for the whole run instead
 * of one per place.
 */
class BdLocationImporter
{
    /** @var array<string, int> */
    private array $added = ['divisions' => 0, 'districts' => 0, 'upazilas' => 0, 'unions' => 0];

    /** @return array<string, int> places added per level */
    public function run(?string $path = null): array
    {
        $data = json_decode((string) file_get_contents($path ?? database_path('data/bd-locations.json')), true);
        DB::transaction(function () use ($data) {
            foreach ($data['divisions'] as $dv) {
                $divisionId = $this->place('divisions', null, null, $dv['bn'], $dv['en'], 'bd-dv-'.$dv['id']);
                foreach ($dv['districts'] as $di) {
                    $districtId = $this->place('districts', 'division_id', $divisionId, $di['bn'], $di['en'], 'bd-di-'.$di['id']);
                    foreach ($di['upazilas'] as $up) {
                        $upazilaId = $this->place('upazilas', 'district_id', $districtId, $up['bn'], $up['en'], 'bd-up-'.$up['id']);
                        foreach ($up['unions'] as [$id, $bn, $en]) {
                            $this->place('unions', 'upazila_id', $upazilaId, $bn, $en, 'bd-un-'.$id);
                        }
                    }
                }
            }
            if (array_sum($this->added) > 0) {
                AuditLogger::log('location', 'import', null, null, $this->added, __('বাংলাদেশের সব বিভাগ, জেলা, উপজেলা ও ইউনিয়ন ইমপোর্ট'));
            }
        });

        return $this->added;
    }

    /** The id of the place under this parent with this name (or code), adding it when there is none. */
    private function place(string $table, ?string $parentKey, ?int $parentId, string $bn, string $en, string $code): int
    {
        $rows = $this->children($table, $parentKey, $parentId);
        $key = self::norm($bn);
        $found = $rows['code'][$code] ?? $rows['bn'][$key] ?? $rows['en'][strtolower($en)] ?? null;
        if ($found) {
            // fill in what the society left empty, never overwrite its names
            DB::table($table)->where('id', $found)->whereNull('code')->update(['code' => $code]);
            DB::table($table)->where('id', $found)->where(fn ($q) => $q->whereNull('name_en')->orWhere('name_en', ''))->update(['name_en' => $en]);

            return $found;
        }
        $now = now();
        $id = DB::table($table)->insertGetId(array_filter([
            $parentKey => $parentId, 'name_bn' => $bn, 'name_en' => $en, 'code' => $code, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ], fn ($v, $k) => $k !== '' && $v !== null, ARRAY_FILTER_USE_BOTH));
        $this->added[$table]++;
        $this->cache[$table.'|'.$parentId]['code'][$code] = $id;
        $this->cache[$table.'|'.$parentId]['bn'][$key] = $id;
        $this->cache[$table.'|'.$parentId]['en'][strtolower($en)] = $id;

        return $id;
    }

    /** @var array<string, array{code: array<string,int>, bn: array<string,int>, en: array<string,int>}> */
    private array $cache = [];

    private function children(string $table, ?string $parentKey, ?int $parentId): array
    {
        $k = $table.'|'.$parentId;
        if (! isset($this->cache[$k])) {
            $rows = DB::table($table)->when($parentKey, fn ($q) => $q->where($parentKey, $parentId))->get(['id', 'name_bn', 'name_en', 'code']);
            $this->cache[$k] = [
                'code' => $rows->filter(fn ($r) => $r->code)->pluck('id', 'code')->all(),
                'bn' => $rows->mapWithKeys(fn ($r) => [self::norm($r->name_bn) => $r->id])->all(),
                'en' => $rows->filter(fn ($r) => $r->name_en)->mapWithKeys(fn ($r) => [strtolower(trim($r->name_en)) => $r->id])->all(),
            ];
        }

        return $this->cache[$k];
    }

    /** Bangla names are written with য়/ড়/ঢ় either as one letter or as a letter and a dot below; compare them the same. */
    public static function norm(string $s): string
    {
        $s = str_replace(["\u{09DF}", "\u{09DC}", "\u{09DD}"], ["\u{09AF}\u{09BC}", "\u{09A1}\u{09BC}", "\u{09A2}\u{09BC}"], $s);

        return preg_replace('/\s+/u', ' ', trim($s));
    }
}
