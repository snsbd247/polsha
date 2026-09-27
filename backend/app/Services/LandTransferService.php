<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\Land;
use App\Models\LandTransfer;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Transfers drafted on the land-transfer form. The change to the owners is
 * worked out when it is applied (after approval), from the owners at that
 * moment, so a transfer approved later never overwrites a newer one.
 */
class LandTransferService
{
    public function __construct(private ApprovalService $approvals, private LandService $lands) {}

    /** Owners after the transfer: the seller keeps what is left, the buyer gains the share. */
    public function newOwners(Land $land, int $fromId, int $toId, float $share): array
    {
        $current = $land->owners()->get(['farmer_id', 'share_percent'])->mapWithKeys(fn ($o) => [$o->farmer_id => (float) $o->share_percent])->all();
        if (! isset($current[$fromId])) {
            throw ValidationException::withMessages(['from_farmer_id' => __('এই কৃষক এখন এই জমির মালিক নন।')]);
        }
        if ($fromId === $toId) {
            throw ValidationException::withMessages(['to_farmer_id' => __('একই কৃষকের কাছে হস্তান্তর করা যায় না।')]);
        }
        if ($share > $current[$fromId] + 0.001) {
            throw ValidationException::withMessages(['share_percent' => __('হস্তান্তরের অংশ বর্তমান মালিকের অংশের (:p%) বেশি।', ['p' => rtrim(rtrim(number_format($current[$fromId], 2), '0'), '.')])]);
        }
        $current[$fromId] = round($current[$fromId] - $share, 2);
        $current[$toId] = round(($current[$toId] ?? 0) + $share, 2);

        return collect($current)->filter(fn ($s) => $s > 0)->map(fn ($s, $id) => ['farmer_id' => $id, 'share_percent' => $s])->values()->all();
    }

    public function submit(LandTransfer $t): ApprovalRequest
    {
        if (! in_array($t->status, ['draft', 'rejected'], true)) {
            throw ValidationException::withMessages(['status' => __('এই হস্তান্তর আগেই পাঠানো হয়েছে।')]);
        }
        // check it would apply cleanly before asking anyone to approve it
        $this->newOwners($t->land, $t->from_farmer_id, $t->to_farmer_id, $t->share_percent);
        $pending = LandTransfer::where('land_id', $t->land_id)->where('status', 'pending')->where('id', '!=', $t->id)->exists();
        if ($pending) {
            throw ValidationException::withMessages(['land_id' => __('এই জমির আরেকটি হস্তান্তর অনুমোদনের অপেক্ষায় আছে।')]);
        }

        return DB::transaction(function () use ($t) {
            $t->update(['status' => 'pending']);
            $req = $this->approvals->submit('land.transfer',
                __('জমি হস্তান্তর :no: :land (:from → :to)', ['no' => $t->transfer_no, 'land' => $t->land->land_code, 'from' => $t->fromFarmer->name_bn, 'to' => $t->toFarmer->name_bn]),
                $t,
                ['transfer_id' => $t->id, 'land' => $t->land->land_code, 'share_percent' => $t->share_percent, 'transfer_date' => $t->transfer_date->toDateString(),
                    'reason' => __(LandTransfer::REASONS[$t->reason] ?? $t->reason), 'amount' => $t->amount],
                ['from' => $t->fromFarmer->name_bn, 'to' => $t->toFarmer->name_bn],
                $t->amount,
            );
            $t->update(['approval_request_id' => $req->id]);

            return $req;
        });
    }

    /** Called by the approval handler. */
    public function apply(LandTransfer $t, int $userId): void
    {
        DB::transaction(function () use ($t, $userId) {
            $t = LandTransfer::lockForUpdate()->findOrFail($t->id);
            if ($t->status === 'approved') {
                return;
            }
            $owners = $this->newOwners($t->land, $t->from_farmer_id, $t->to_farmer_id, $t->share_percent);
            $remarks = trim($t->transfer_no.' · '.__(LandTransfer::REASONS[$t->reason] ?? $t->reason).($t->remarks ? ' · '.$t->remarks : ''));
            $this->lands->transferOwnership($t->land, $owners, $t->transfer_date->toDateString(), mb_substr($remarks, 0, 500), $userId);
            $t->update(['status' => 'approved']);
        });
    }
}
