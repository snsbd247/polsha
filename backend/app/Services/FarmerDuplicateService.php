<?php

namespace App\Services;

use App\Models\Farmer;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class FarmerDuplicateService
{
    /**
     * Honorific prefixes that are written many ways in registers; stripped
     * before comparing so "মোঃ করিম" and "মোহাম্মদ করিম" match.
     */
    private const PREFIXES = [
        'মোহাম্মদ', 'মুহাম্মদ', 'মোহাম্মাদ', 'মোঃ', 'মো:', 'মো.', 'মো ',
        'মোসাম্মৎ', 'মোছাম্মৎ', 'মোসাঃ', 'মোছাঃ', 'মোসা:', 'মোছা:', 'মোসা.', 'মোছা.',
        'শ্রীমতি', 'শ্রী', 'md.', 'md ', 'mst.', 'mst ', 'mohammad', 'muhammad',
    ];

    public static function normalizeName(?string $name): string
    {
        $s = mb_strtolower(trim((string) $name));
        $changed = true;
        while ($changed) {
            $changed = false;
            foreach (self::PREFIXES as $p) {
                if (str_starts_with($s, $p)) {
                    $s = ltrim(mb_substr($s, mb_strlen($p)));
                    $changed = true;
                }
            }
        }
        // Drop punctuation and all whitespace.
        return preg_replace('/[\s\.\:\-ঃ,]+/u', '', $s) ?? $s;
    }

    /**
     * Pre-save check for the farmer form.
     *
     * @return array{block: array, warn: array}
     */
    public function check(array $data, ?int $ignoreId = null): array
    {
        $base = Farmer::query()->live()->with('village:id,name_bn')
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId));

        $block = [];
        if (! empty($data['nid'])) {
            $block = (clone $base)->where('nid', $data['nid'])->get()
                ->map(fn ($f) => $this->row($f, ['nid']))->all();
        }

        $warn = collect();
        if (! empty($data['mobile'])) {
            $warn = $warn->merge((clone $base)->where('mobile', $data['mobile'])->get()->map(fn ($f) => $this->row($f, ['mobile'])));
        }
        if (! empty($data['village_id']) && ! empty($data['name_bn'])) {
            $name = self::normalizeName($data['name_bn']);
            $father = self::normalizeName($data['father_name'] ?? '');
            $sameName = (clone $base)->where('village_id', $data['village_id'])->get()
                ->filter(fn ($f) => self::normalizeName($f->name_bn) === $name && self::normalizeName($f->father_name) === $father);
            $warn = $warn->merge($sameName->map(fn ($f) => $this->row($f, ['name', 'father_name', 'village'])));
        }

        $blockIds = array_column($block, 'id');
        $warn = $this->mergeRows($warn)->reject(fn ($r) => in_array($r['id'], $blockIds, true))->values()->all();

        return ['block' => $block, 'warn' => $warn];
    }

    /**
     * All suspected duplicate pairs among live farmers, excluding dismissed pairs.
     */
    public function pairs(): Collection
    {
        $farmers = Farmer::query()->live()->with('village:id,name_bn', 'member:id,farmer_id,member_no')
            ->get(['id', 'farmer_code', 'name_bn', 'father_name', 'nid', 'mobile', 'village_id']);

        $dismissed = DB::table('duplicate_dismissals')->get(['farmer_a_id', 'farmer_b_id'])
            ->map(fn ($d) => $d->farmer_a_id.'-'.$d->farmer_b_id)->flip();

        $pairs = [];
        $add = function (Farmer $a, Farmer $b, string $reason) use (&$pairs, $dismissed) {
            [$a, $b] = $a->id < $b->id ? [$a, $b] : [$b, $a];
            $key = $a->id.'-'.$b->id;
            if ($dismissed->has($key)) {
                return;
            }
            $pairs[$key] ??= ['a' => $a, 'b' => $b, 'reasons' => []];
            $pairs[$key]['reasons'][$reason] = true;
        };

        $groups = [
            'nid' => $farmers->filter(fn ($f) => $f->nid)->groupBy('nid'),
            'mobile' => $farmers->filter(fn ($f) => $f->mobile)->groupBy('mobile'),
            'name' => $farmers->groupBy(fn ($f) => $f->village_id.'|'.self::normalizeName($f->name_bn).'|'.self::normalizeName($f->father_name)),
        ];
        foreach ($groups as $reason => $byKey) {
            foreach ($byKey as $group) {
                $list = $group->values();
                for ($i = 0; $i < $list->count(); $i++) {
                    for ($j = $i + 1; $j < $list->count(); $j++) {
                        $add($list[$i], $list[$j], $reason);
                    }
                }
            }
        }

        $weights = ['nid' => 60, 'mobile' => 25, 'name' => 35];

        return collect($pairs)->map(function ($p) use ($weights) {
            $reasons = array_keys($p['reasons']);

            return [
                'a' => $this->row($p['a']),
                'b' => $this->row($p['b']),
                'reasons' => $reasons,
                'score' => min(100, array_sum(array_map(fn ($r) => $weights[$r], $reasons))),
            ];
        })->sortByDesc('score')->values();
    }

    public function dismiss(int $a, int $b, int $userId): void
    {
        [$a, $b] = $a < $b ? [$a, $b] : [$b, $a];
        DB::table('duplicate_dismissals')->insertOrIgnore([
            'farmer_a_id' => $a, 'farmer_b_id' => $b, 'dismissed_by' => $userId,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function row(Farmer $f, array $matched = []): array
    {
        return [
            'id' => $f->id,
            'farmer_code' => $f->farmer_code,
            'name_bn' => $f->name_bn,
            'father_name' => $f->father_name,
            'nid' => $f->nid,
            'mobile' => $f->mobile,
            'village' => $f->village?->name_bn,
            'member_no' => $f->member?->member_no,
            'matched' => $matched,
        ];
    }

    private function mergeRows(Collection $rows): Collection
    {
        return $rows->groupBy('id')->map(function ($group) {
            $first = $group->first();
            $first['matched'] = $group->pluck('matched')->flatten()->unique()->values()->all();

            return $first;
        })->values();
    }
}
