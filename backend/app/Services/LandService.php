<?php

namespace App\Services;

use App\Models\Farmer;
use App\Models\Land;
use App\Models\LandCultivation;
use App\Models\LandOwner;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Ownership and cultivation are append-only periods: a change closes the
 * open rows (end_date) and opens new ones, so the full history survives.
 */
class LandService
{
    /**
     * @param  array  $data  land columns
     * @param  array<int,array{farmer_id:int,share_percent:float}>  $owners
     * @param  array{farmer_id:int,type:string,terms?:string,start_date:string}|null  $cultivation
     */
    public function create(array $data, array $owners, string $ownersFrom, ?array $cultivation, int $userId, ?int $batchId = null): Land
    {
        $this->assertOwners($owners);

        return DB::transaction(function () use ($data, $owners, $ownersFrom, $cultivation, $userId, $batchId) {
            $land = Land::create($data + [
                'land_code' => SequenceService::next('land'),
                'created_by' => $userId,
                'import_batch_id' => $batchId,
            ]);
            $this->openOwners($land, $owners, $ownersFrom, null, $userId);
            if ($cultivation) {
                $this->openCultivation($land, $cultivation, $userId);
            }

            return $land;
        });
    }

    public function transferOwnership(Land $land, array $owners, string $effectiveDate, ?string $remarks, int $userId): void
    {
        $this->assertOwners($owners);

        DB::transaction(function () use ($land, $owners, $effectiveDate, $remarks, $userId) {
            $land = Land::lockForUpdate()->findOrFail($land->id);
            $current = $land->owners()->get();
            $this->assertNotBefore($current->max('start_date'), $effectiveDate, __('বর্তমান মালিকানার শুরুর'));

            $before = $current->map(fn ($o) => ['farmer_id' => $o->farmer_id, 'share' => $o->share_percent])->all();
            LandOwner::where('land_id', $land->id)->whereNull('end_date')->update(['end_date' => $effectiveDate]);
            $this->openOwners($land, $owners, $effectiveDate, $remarks, $userId);

            // Keep the current cultivation consistent with the new owners.
            $cult = $land->cultivation()->first();
            $newOwnerIds = array_map('intval', array_column($owners, 'farmer_id'));
            $cultivatorOwns = $cult && in_array($cult->farmer_id, $newOwnerIds, true);
            if ($cult && $cult->type === 'own' && ! $cultivatorOwns) {
                // Former owner no longer owns it — their "own" farming ends.
                $cult->update(['end_date' => $effectiveDate, 'remarks' => trim(($cult->remarks ?? '').__(' মালিকানা হস্তান্তরে স্বয়ংক্রিয়ভাবে শেষ'))]);
            } elseif ($cult && $cult->type === 'borga' && $cultivatorOwns) {
                // The borga tenant bought in — from now on they farm as an owner.
                $cult->update(['end_date' => $effectiveDate, 'remarks' => trim(($cult->remarks ?? '').__(' বর্গাচাষি মালিক হওয়ায় বর্গা শেষ'))]);
                LandCultivation::create([
                    'land_id' => $land->id, 'farmer_id' => $cult->farmer_id, 'type' => 'own', 'start_date' => $effectiveDate,
                    'remarks' => __('মালিকানা হস্তান্তরে বর্গা থেকে নিজ চাষ'), 'created_by' => $userId,
                ]);
            }

            AuditLogger::log('land', 'ownership_transfer', $land, ['owners' => $before],
                ['owners' => $owners, 'effective_date' => $effectiveDate, 'remarks' => $remarks]);
        });
    }

    /** Close the current cultivation (if any) and start a new one. */
    public function changeCultivation(Land $land, array $cultivation, int $userId): LandCultivation
    {
        return DB::transaction(function () use ($land, $cultivation, $userId) {
            $land = Land::lockForUpdate()->findOrFail($land->id);
            $current = $land->cultivation()->first();
            if ($current) {
                $this->assertNotBefore($current->start_date, $cultivation['start_date'], __('বর্তমান চাষের শুরুর'));
                $current->update(['end_date' => $cultivation['start_date']]);
            }
            $new = $this->openCultivation($land, $cultivation, $userId);
            AuditLogger::log('land', 'cultivation_change', $land,
                $current ? ['farmer_id' => $current->farmer_id, 'type' => $current->type] : null,
                ['farmer_id' => $new->farmer_id, 'type' => $new->type, 'start_date' => $new->start_date->toDateString()]);

            return $new;
        });
    }

    public function endCultivation(Land $land, string $endDate, ?string $remarks, int $userId): void
    {
        DB::transaction(function () use ($land, $endDate, $remarks) {
            $current = $land->cultivation()->lockForUpdate()->first();
            if (! $current) {
                throw ValidationException::withMessages(['cultivation' => __('এই জমিতে এখন কোনো চাষি নেই।')]);
            }
            $this->assertNotBefore($current->start_date, $endDate, __('চাষ শুরুর'));
            $current->update(['end_date' => $endDate, 'remarks' => $remarks ?: $current->remarks]);
            AuditLogger::log('land', 'cultivation_end', $land, ['farmer_id' => $current->farmer_id, 'type' => $current->type], ['end_date' => $endDate]);
        });
    }

    /** Owners must be distinct, live farmers whose shares total exactly 100%. */
    public function assertOwners(array $owners): void
    {
        if (! $owners) {
            throw ValidationException::withMessages(['owners' => __('কমপক্ষে একজন মালিক দিন।')]);
        }
        $ids = array_map('intval', array_column($owners, 'farmer_id'));
        if (count($ids) !== count(array_unique($ids))) {
            throw ValidationException::withMessages(['owners' => __('একই মালিক একাধিকবার দেওয়া হয়েছে।')]);
        }
        $total = round(array_sum(array_map(fn ($o) => (float) $o['share_percent'], $owners)), 2);
        if (abs($total - 100) > 0.001) {
            throw ValidationException::withMessages(['owners' => __('মালিকদের অংশের যোগফল ১০০% হতে হবে (এখন :p0%)।', ['p0' => $total])]);
        }
        if (Farmer::whereIn('id', $ids)->whereNotNull('merged_into_id')->exists()) {
            throw ValidationException::withMessages(['owners' => __('মার্জ হয়ে যাওয়া কৃষককে মালিক করা যাবে না।')]);
        }
    }

    private function openOwners(Land $land, array $owners, string $from, ?string $remarks, int $userId): void
    {
        foreach ($owners as $o) {
            LandOwner::create([
                'land_id' => $land->id,
                'farmer_id' => $o['farmer_id'],
                'share_percent' => $o['share_percent'],
                'start_date' => $from,
                'remarks' => $remarks,
                'created_by' => $userId,
            ]);
        }
    }

    private function openCultivation(Land $land, array $c, int $userId): LandCultivation
    {
        $farmer = Farmer::findOrFail($c['farmer_id']);
        if ($farmer->merged_into_id || ! $farmer->is_active) {
            throw ValidationException::withMessages(['cultivation.farmer_id' => __('নিষ্ক্রিয় বা মার্জ হয়ে যাওয়া কৃষককে চাষি করা যাবে না।')]);
        }

        $isOwner = $land->owners()->where('farmer_id', $farmer->id)->exists();
        if ($c['type'] === 'own' && ! $isOwner) {
            throw ValidationException::withMessages(['cultivation.type' => __('নিজ চাষ হলে চাষিকে এই জমির বর্তমান মালিকদের একজন হতে হবে।')]);
        }
        if ($c['type'] === 'borga' && $isOwner) {
            throw ValidationException::withMessages(['cultivation.type' => __('মালিক নিজের জমিতে বর্গাচাষি হতে পারেন না — "নিজ চাষ" বাছাই করুন।')]);
        }

        return LandCultivation::create([
            'land_id' => $land->id,
            'farmer_id' => $farmer->id,
            'type' => $c['type'],
            'terms' => $c['terms'] ?? null,
            // share and agreed end only mean something for borga/lease
            'share_percent' => $c['type'] === 'own' ? null : ($c['share_percent'] ?? null),
            'contract_end' => $c['type'] === 'own' ? null : ($c['contract_end'] ?? null),
            'start_date' => $c['start_date'],
            'remarks' => $c['remarks'] ?? null,
            'created_by' => $userId,
        ]);
    }

    private function assertNotBefore($existingStart, string $date, string $what): void
    {
        if ($existingStart && Carbon::parse($date)->lt(Carbon::parse($existingStart))) {
            throw ValidationException::withMessages(['effective_date' => __('তারিখ :p0 তারিখের আগে হতে পারবে না।', ['p0' => $what])]);
        }
    }

    /** Same mouza + survey + khatian + dag already on record (possible duplicate). */
    public function similar(int $mouzaId, string $survey, string $khatian, string $dag, ?int $ignoreId = null)
    {
        return Land::with('owners.farmer:id,name_bn')
            ->where(['mouza_id' => $mouzaId, 'survey' => $survey, 'khatian_no' => $khatian, 'dag_no' => $dag])
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->get(['id', 'land_code', 'area_decimal']);
    }
}
