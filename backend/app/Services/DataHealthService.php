<?php

namespace App\Services;

use App\Models\Farmer;
use App\Models\Land;
use App\Models\Mouza;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Each check is a query returning the offending records, so the same
 * definition drives the counts, the per-mouza table and the drill-down list.
 */
class DataHealthService
{
    /** @return array<string, array{label:string, entity:string, severity:string, query:callable}> */
    public function checks(): array
    {
        $liveFarmerIds = fn () => Farmer::query()->whereNull('merged_into_id')->where('is_active', true)->select('id');

        return [
            'land_no_owner' => [
                'label' => 'মালিক নেই এমন জমি', 'entity' => 'land', 'severity' => 'error',
                'query' => fn () => Land::query()->whereDoesntHave('owners'),
            ],
            'land_share_mismatch' => [
                'label' => 'মালিকদের অংশ ১০০% নয়', 'entity' => 'land', 'severity' => 'error',
                'query' => fn () => Land::query()->whereIn('id', DB::table('land_owners')->whereNull('end_date')
                    ->groupBy('land_id')->havingRaw('abs(sum(share_percent) - 100) > 0.01')->select('land_id')),
            ],
            'land_duplicate' => [
                'label' => 'একই মৌজা/জরিপ/খতিয়ান/দাগে একাধিক জমি', 'entity' => 'land', 'severity' => 'warning',
                'query' => fn () => Land::query()->whereExists(fn ($q) => $q->from('lands as l2')
                    ->whereColumn('l2.mouza_id', 'lands.mouza_id')->whereColumn('l2.survey', 'lands.survey')
                    ->whereColumn('l2.khatian_no', 'lands.khatian_no')->whereColumn('l2.dag_no', 'lands.dag_no')
                    ->whereColumn('l2.id', '!=', 'lands.id')->whereNull('l2.deleted_at')),
            ],
            'land_incomplete' => [
                'label' => 'অসম্পূর্ণ জমি (ধরন/পরিমাণ/দাগ/খতিয়ান নেই)', 'entity' => 'land', 'severity' => 'warning',
                'query' => fn () => Land::query()->where(fn ($w) => $w->whereNull('land_type_id')->orWhere('area_decimal', '<=', 0)
                    ->orWhereIn('dag_no', ['', '0'])->orWhereIn('khatian_no', ['', '0'])),
            ],
            'land_no_cultivator' => [
                'label' => 'চাষাধীন কিন্তু চাষি নেই', 'entity' => 'land', 'severity' => 'warning',
                'query' => fn () => Land::query()->where('status', 'cultivated')->whereDoesntHave('cultivation'),
            ],
            'land_invalid_own' => [
                'label' => '"নিজ চাষ" কিন্তু চাষি মালিক নন', 'entity' => 'land', 'severity' => 'error',
                'query' => fn () => Land::query()->whereHas('cultivation', fn ($c) => $c->where('type', 'own')
                    ->whereNotExists(fn ($o) => $o->from('land_owners')->whereColumn('land_owners.land_id', 'land_cultivations.land_id')
                        ->whereColumn('land_owners.farmer_id', 'land_cultivations.farmer_id')->whereNull('land_owners.end_date'))),
            ],
            'land_invalid_borga' => [
                'label' => 'বর্গাচাষি নিজেই মালিক', 'entity' => 'land', 'severity' => 'error',
                'query' => fn () => Land::query()->whereHas('cultivation', fn ($c) => $c->where('type', 'borga')
                    ->whereExists(fn ($o) => $o->from('land_owners')->whereColumn('land_owners.land_id', 'land_cultivations.land_id')
                        ->whereColumn('land_owners.farmer_id', 'land_cultivations.farmer_id')->whereNull('land_owners.end_date'))),
            ],
            'land_inactive_party' => [
                'label' => 'মালিক/চাষি নিষ্ক্রিয় বা মার্জ হয়ে গেছেন', 'entity' => 'land', 'severity' => 'error',
                'query' => fn () => Land::query()->where(fn ($w) => $w
                    ->whereHas('owners', fn ($o) => $o->whereNotIn('farmer_id', $liveFarmerIds()))
                    ->orWhereHas('cultivation', fn ($c) => $c->whereNotIn('farmer_id', $liveFarmerIds()))),
            ],
            'land_inactive_mouza' => [
                'label' => 'নিষ্ক্রিয় মৌজায় জমি', 'entity' => 'land', 'severity' => 'warning',
                'query' => fn () => Land::query()->whereHas('mouza', fn ($m) => $m->where('is_active', false)),
            ],
            'farmer_wrong_mouza' => [
                'label' => 'ভুল মৌজা (কৃষকের গ্রামের সাথে মৌজা যুক্ত নয়)', 'entity' => 'farmer', 'severity' => 'error',
                'query' => fn () => Farmer::query()->whereNull('merged_into_id')->whereNotExists(fn ($q) => $q->from('mouza_village')
                    ->whereColumn('mouza_village.mouza_id', 'farmers.mouza_id')->whereColumn('mouza_village.village_id', 'farmers.village_id')),
            ],
            'farmer_no_id' => [
                'label' => 'NID বা জন্ম নিবন্ধন নেই', 'entity' => 'farmer', 'severity' => 'info',
                'query' => fn () => Farmer::query()->whereNull('merged_into_id')->whereNull('nid')->whereNull('birth_reg_no'),
            ],
            'farmer_no_mobile' => [
                'label' => 'মোবাইল নম্বর নেই', 'entity' => 'farmer', 'severity' => 'info',
                'query' => fn () => Farmer::query()->whereNull('merged_into_id')->whereNull('mobile'),
            ],
            'mouza_no_village' => [
                'label' => 'কোনো গ্রাম যুক্ত নেই এমন মৌজা', 'entity' => 'mouza', 'severity' => 'warning',
                'query' => fn () => Mouza::query()->whereDoesntHave('villages'),
            ],
        ];
    }

    public function summary(?int $mouzaId = null): array
    {
        $out = [];
        foreach ($this->checks() as $key => $c) {
            $out[] = [
                'key' => $key,
                'label' => $c['label'],
                'entity' => $c['entity'],
                'severity' => $c['severity'],
                'count' => $this->scoped($c, $mouzaId)->count(),
            ];
        }
        $out[] = [
            'key' => 'farmer_duplicate', 'label' => 'সম্ভাব্য ডুপ্লিকেট কৃষক (জোড়া)', 'entity' => 'farmer', 'severity' => 'warning',
            'count' => $mouzaId ? null : app(FarmerDuplicateService::class)->pairs()->count(),
        ];

        return $out;
    }

    /** Per-mouza counts: lands, area, farmers, and problems found in that mouza. */
    public function mouzaTable(): array
    {
        $landStats = DB::table('lands')->whereNull('deleted_at')->groupBy('mouza_id')
            ->selectRaw('mouza_id, count(*) as land_count, coalesce(sum(area_decimal),0) as area')->get()->keyBy('mouza_id');
        $farmerCounts = DB::table('farmers')->whereNull('deleted_at')->whereNull('merged_into_id')->groupBy('mouza_id')
            ->selectRaw('mouza_id, count(*) as c')->pluck('c', 'mouza_id');

        $issues = [];
        foreach ($this->checks() as $c) {
            if ($c['entity'] === 'mouza') {
                foreach ($c['query']()->pluck('id') as $id) {
                    $issues[$id] = ($issues[$id] ?? 0) + 1;
                }

                continue;
            }
            foreach ($c['query']()->groupBy('mouza_id')->selectRaw('mouza_id, count(*) as c')->pluck('c', 'mouza_id') as $id => $n) {
                $issues[$id] = ($issues[$id] ?? 0) + $n;
            }
        }

        return Mouza::with('union:id,name_bn', 'upazila:id,name_bn')->withCount('villages')->orderBy('name_bn')->get()
            ->map(fn (Mouza $m) => [
                'id' => $m->id,
                'name_bn' => $m->name_bn,
                'jl_no' => $m->jl_no,
                'union' => $m->union?->name_bn,
                'upazila' => $m->upazila?->name_bn,
                'is_active' => $m->is_active,
                'villages_count' => $m->villages_count,
                'land_count' => (int) ($landStats[$m->id]->land_count ?? 0),
                'area_decimal' => (float) ($landStats[$m->id]->area ?? 0),
                'farmer_count' => (int) ($farmerCounts[$m->id] ?? 0),
                'issue_count' => $issues[$m->id] ?? 0,
            ])->all();
    }

    public function items(string $key, ?int $mouzaId, int $perPage)
    {
        $c = $this->checks()[$key] ?? abort(404);
        $q = $this->scoped($c, $mouzaId);

        return match ($c['entity']) {
            'land' => $q->with(['mouza:id,name_bn', 'owners.farmer:id,name_bn', 'cultivation.farmer:id,name_bn'])->paginate($perPage)
                ->through(fn (Land $l) => [
                    'id' => $l->id, 'code' => $l->land_code, 'link' => "/lands/{$l->id}",
                    'title' => "দাগ {$l->dag_no}, খতিয়ান {$l->khatian_no} ({$l->survey})",
                    'detail' => 'মালিক: '.($l->owners->map(fn ($o) => $o->farmer?->name_bn.' '.(float) $o->share_percent.'%')->implode(', ') ?: '—')
                        .' · চাষি: '.($l->cultivation?->farmer?->name_bn ?? '—'),
                    'mouza' => $l->mouza?->name_bn,
                ]),
            'farmer' => $q->with(['mouza:id,name_bn', 'village:id,name_bn'])->paginate($perPage)
                ->through(fn (Farmer $f) => [
                    'id' => $f->id, 'code' => $f->farmer_code, 'link' => "/farmers/{$f->id}",
                    'title' => $f->name_bn, 'detail' => "পিতা: {$f->father_name} · গ্রাম: ".($f->village?->name_bn ?? '—'),
                    'mouza' => $f->mouza?->name_bn,
                ]),
            default => $q->with('union:id,name_bn')->paginate($perPage)
                ->through(fn (Mouza $m) => [
                    'id' => $m->id, 'code' => 'JL '.$m->jl_no, 'link' => '/masters/mouzas',
                    'title' => $m->name_bn, 'detail' => 'ইউনিয়ন: '.($m->union?->name_bn ?? '—'), 'mouza' => $m->name_bn,
                ]),
        };
    }

    private function scoped(array $check, ?int $mouzaId): Builder
    {
        $q = $check['query']();
        if ($mouzaId) {
            $q->where($check['entity'] === 'mouza' ? 'id' : 'mouza_id', $mouzaId);
        }

        return $q;
    }
}
