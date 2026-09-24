<?php

namespace App\Services;

use App\Models\IntegrityScan;

/** Full data + ledger integrity scan; results are stored so the nightly run can be reviewed later. */
class IntegrityScanService
{
    public function __construct(private DataHealthService $health, private LedgerIntegrityService $ledger) {}

    public function run(string $trigger = 'manual', ?int $userId = null): IntegrityScan
    {
        $started = now();
        $results = [];

        foreach ($this->health->checks() as $key => $c) {
            $q = $c['query']();
            $count = (clone $q)->count();
            $samples = $count ? $q->limit(20)->get()->map(fn ($m) => match ($c['entity']) {
                'land' => ['no' => $m->land_code, 'detail' => __('দাগ :d, খতিয়ান :k', ['d' => $m->dag_no, 'k' => $m->khatian_no]), 'link' => '/lands/'.$m->id],
                'farmer' => ['no' => $m->farmer_code, 'detail' => $m->name_bn, 'link' => '/farmers/'.$m->id],
                default => ['no' => 'JL '.$m->jl_no, 'detail' => $m->name_bn, 'link' => '/masters/mouzas'],
            })->all() : [];
            $results[] = ['key' => $key, 'group' => 'data', 'label' => $c['label'], 'severity' => $c['severity'], 'count' => $count, 'samples' => $samples];
        }
        foreach ($this->ledger->run() as $r) {
            $results[] = $r;
        }

        $issues = collect($results)->filter(fn ($r) => $r['count'] > 0);

        return IntegrityScan::create([
            'trigger' => $trigger, 'created_by' => $userId,
            'total_issues' => $issues->sum('count'),
            'errors' => $issues->where('severity', 'error')->sum('count'),
            'results' => $results, 'started_at' => $started, 'finished_at' => now(),
        ]);
    }
}
