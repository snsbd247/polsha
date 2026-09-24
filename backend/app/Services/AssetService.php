<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\Asset;
use App\Models\AssetCategory;
use App\Models\AssetDepreciation;
use App\Models\AssetMaintenance;
use App\Models\AssetMovement;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Fixed-asset register. Cost sits in "fixed_assets", straight-line
 * depreciation piles up in "accumulated_depreciation" (one voucher per
 * month for all assets), repairs are expensed and a sale or write-off
 * waits for approval before the asset leaves the books.
 */
class AssetService
{
    public function __construct(private LedgerService $ledger, private ApprovalService $approvals, private ReceiptService $receipts) {}

    /**
     * @param  array<string, mixed>  $data  asset fields + acquisition (purchase|opening|donation), method, fund_account_id, reference, opening_depreciation
     */
    public function create(array $data): Asset
    {
        $category = AssetCategory::findOrFail($data['category_id']);
        $cost = round((float) $data['cost'], 2);
        $salvage = round((float) ($data['salvage_value'] ?? ($cost * (float) $category->salvage_percent / 100)), 2);
        $life = (int) ($data['life_months'] ?? $category->life_months);
        $acq = $data['acquisition'] ?? 'purchase';
        $openingDep = $acq === 'opening' ? round((float) ($data['opening_depreciation'] ?? 0), 2) : 0.0;
        if ($salvage > $cost) {
            throw ValidationException::withMessages(['salvage_value' => __('অবশিষ্ট মূল্য ক্রয়মূল্যের বেশি হতে পারে না।')]);
        }
        if ($openingDep > $cost - $salvage) {
            throw ValidationException::withMessages(['opening_depreciation' => __('পূর্বের অবচয় (ক্রয়মূল্য − অবশিষ্ট মূল্য) এর বেশি হতে পারে না।')]);
        }
        $date = $data['purchase_date'];
        // Opening assets are brought in as of the entry date; their earlier depreciation is given as a lump sum.
        $bookDate = $acq === 'opening' ? ($data['opening_date'] ?? now()->toDateString()) : $date;
        $fund = null;
        if ($acq === 'purchase' && ($data['method'] ?? 'cash') !== 'credit') {
            if (($data['method'] ?? 'cash') !== 'cash' && empty($data['reference'])) {
                throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
            }
            $fund = ($data['method'] ?? 'cash') === 'cash' ? Account::byKey('cash_society') : $this->receipts->fund('asset', $data['method'], $data['fund_account_id'] ?? null);
        }

        return DB::transaction(function () use ($data, $category, $cost, $salvage, $life, $acq, $openingDep, $date, $bookDate, $fund) {
            $from = $acq === 'opening' ? Carbon::parse($bookDate)->addMonthNoOverflow()->startOfMonth() : Carbon::parse($date)->startOfMonth();
            $asset = Asset::create([
                'asset_code' => SequenceService::next('asset'), 'name_bn' => $data['name_bn'], 'name_en' => $data['name_en'] ?? null,
                'category_id' => $category->id, 'brand_model' => $data['brand_model'] ?? null, 'serial_no' => $data['serial_no'] ?? null,
                'supplier' => $data['supplier'] ?? null, 'purchase_date' => $date, 'cost' => $cost, 'salvage_value' => $salvage,
                'life_months' => $life, 'depreciation_from' => $from->toDateString(), 'accumulated_depreciation' => $openingDep,
                'acquisition' => $acq, 'location' => $data['location'] ?? null, 'mouza_id' => $data['mouza_id'] ?? null,
                'custodian' => $data['custodian'] ?? null, 'condition' => $data['condition'] ?? 'good', 'status' => 'in_stock',
                'method' => $acq === 'purchase' ? ($data['method'] ?? 'cash') : null, 'fund_account_id' => $fund?->id,
                'reference' => $data['reference'] ?? null, 'remarks' => $data['remarks'] ?? null, 'created_by' => auth()->id(),
            ]);

            $fixed = Account::byKey('fixed_assets')->id;
            $lines = [['account_id' => $fixed, 'debit' => $cost]];
            if ($acq === 'purchase') {
                $lines[] = ['account_id' => $fund?->id ?? Account::byKey('accounts_payable')->id, 'credit' => $cost, 'remarks' => $data['reference'] ?? null];
            } else {
                if ($openingDep > 0) {
                    $lines[] = ['account_id' => Account::byKey('accumulated_depreciation')->id, 'credit' => $openingDep];
                }
                if ($cost - $openingDep > 0) {
                    $lines[] = ['account_id' => Account::byKey($acq === 'donation' ? 'general_fund' : 'opening_balance_equity')->id, 'credit' => round($cost - $openingDep, 2)];
                }
            }
            $journal = $this->ledger->postNow($fund ? 'payment' : 'journal', $bookDate,
                __('সম্পদ অর্জন :code — :name', ['code' => $asset->asset_code, 'name' => $asset->name_bn]), $lines, 'asset', $asset);
            $asset->update(['journal_id' => $journal->id]);
            $this->move($asset, 'acquire', $bookDate, ['to_location' => $asset->location, 'custodian' => $asset->custodian, 'amount' => $cost,
                'journal_id' => $journal->id, 'note' => __(Asset::ACQUISITIONS[$acq])]);

            return $asset->fresh();
        });
    }

    /** Transfer / install / return to stock / condition change / send to repair / repaired. */
    public function movement(Asset $asset, string $type, array $data): Asset
    {
        if (in_array($asset->status, [...Asset::GONE, 'disposal_pending'], true)) {
            throw ValidationException::withMessages(['type' => __('এই সম্পদের আর কোনো পরিবর্তন করা যায় না।')]);
        }
        $allowed = [
            'transfer' => ['in_stock', 'installed', 'in_repair'],
            'install' => ['in_stock'],
            'uninstall' => ['installed'],
            'condition' => ['in_stock', 'installed', 'in_repair'],
            'repair' => ['in_stock', 'installed'],
            'repaired' => ['in_repair'],
        ];
        if (! in_array($asset->status, $allowed[$type] ?? [], true)) {
            throw ValidationException::withMessages(['type' => __('সম্পদের বর্তমান অবস্থায় এই কাজ করা যায় না।')]);
        }

        return DB::transaction(function () use ($asset, $type, $data) {
            $update = [];
            $to = $data['to_location'] ?? null;
            if (in_array($type, ['transfer', 'install', 'uninstall'], true) && $to) {
                $update['location'] = $to;
            }
            if (array_key_exists('custodian', $data) && $data['custodian'] !== null) {
                $update['custodian'] = $data['custodian'];
            }
            if (! empty($data['condition'])) {
                $update['condition'] = $data['condition'];
            }
            $update += match ($type) {
                'install' => ['status' => 'installed', 'installed_on' => $data['date']],
                'uninstall' => ['status' => 'in_stock'],
                'repair' => ['status' => 'in_repair'],
                'repaired' => ['status' => $asset->installed_on ? 'installed' : 'in_stock'],
                default => [],
            };
            $this->move($asset, $type, $data['date'], [
                'from_location' => $asset->location, 'to_location' => $update['location'] ?? null, 'custodian' => $data['custodian'] ?? null,
                'condition' => $data['condition'] ?? null, 'note' => $data['note'] ?? null,
            ]);
            $asset->update($update);

            return $asset->fresh();
        });
    }

    public function schedule(Asset $asset, array $data): AssetMaintenance
    {
        if (in_array($asset->status, Asset::GONE, true)) {
            throw ValidationException::withMessages(['asset' => __('এই সম্পদ আর হিসাবে নেই।')]);
        }

        return AssetMaintenance::create([
            'asset_id' => $asset->id, 'kind' => $data['kind'] ?? 'service', 'title' => $data['title'], 'due_on' => $data['due_on'] ?? null,
            'repeat_months' => $data['repeat_months'] ?? null, 'note' => $data['note'] ?? null, 'status' => 'scheduled', 'created_by' => auth()->id(),
        ]);
    }

    /** Record the work as done; a cost is expensed from the chosen fund and a repeating job books its next date. */
    public function complete(AssetMaintenance $job, array $data): AssetMaintenance
    {
        if ($job->status !== 'scheduled') {
            throw ValidationException::withMessages(['status' => __('শুধু নির্ধারিত কাজ সম্পন্ন করা যায়।')]);
        }
        $cost = round((float) ($data['cost'] ?? 0), 2);
        $method = $data['method'] ?? 'cash';
        $fund = null;
        if ($cost > 0) {
            if ($method !== 'cash' && $method !== 'credit' && empty($data['reference'])) {
                throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
            }
            $fund = match ($method) {
                'cash' => Account::byKey('cash_society'),
                'credit' => Account::byKey('accounts_payable'),
                default => $this->receipts->fund('asset', $method, $data['fund_account_id'] ?? null),
            };
        }

        return DB::transaction(function () use ($job, $data, $cost, $method, $fund) {
            $journal = null;
            if ($cost > 0) {
                $asset = $job->asset;
                $journal = $this->ledger->postNow($method === 'credit' ? 'journal' : 'payment', $data['done_on'],
                    __('সম্পদ রক্ষণাবেক্ষণ :code — :title', ['code' => $asset->asset_code, 'title' => $job->title]),
                    [['account_id' => Account::byKey('asset_repair_expense')->id, 'debit' => $cost], ['account_id' => $fund->id, 'credit' => $cost, 'remarks' => $data['reference'] ?? null]],
                    'asset', $job);
            }
            $job->update([
                'status' => 'done', 'done_on' => $data['done_on'], 'cost' => $cost, 'vendor' => $data['vendor'] ?? $job->vendor,
                'method' => $cost > 0 ? $method : null, 'fund_account_id' => $fund?->id, 'reference' => $data['reference'] ?? null,
                'journal_id' => $journal?->id, 'note' => $data['note'] ?? $job->note,
            ]);
            if ($job->repeat_months) {
                AssetMaintenance::create([
                    'asset_id' => $job->asset_id, 'kind' => $job->kind, 'title' => $job->title, 'repeat_months' => $job->repeat_months,
                    'due_on' => Carbon::parse($job->due_on ?? $data['done_on'])->addMonthsNoOverflow($job->repeat_months)->toDateString(),
                    'status' => 'scheduled', 'created_by' => auth()->id(),
                ]);
            }

            return $job->fresh();
        });
    }

    // ---- depreciation ----

    /** What a run for a month would charge (nothing saved). */
    public function depreciationPreview(string $period): array
    {
        $end = Carbon::parse($period.'-01')->endOfMonth()->toDateString();
        $rows = [];
        $assets = Asset::with('category:id,code,name_bn,name_en')->whereNotIn('status', Asset::GONE)
            ->where('depreciation_from', '<=', $end)->orderBy('asset_code')->get();
        $done = AssetDepreciation::where('period', $period)->pluck('asset_id')->flip();
        foreach ($assets as $a) {
            if (isset($done[$a->id]) || $a->depreciable() <= 0) {
                continue;
            }
            $amount = min($a->monthlyCharge(), $a->depreciable());
            if ($amount <= 0) {
                continue;
            }
            $rows[] = ['asset' => $a->only(['id', 'asset_code', 'name_bn', 'name_en', 'cost', 'accumulated_depreciation', 'book_value']) + ['category' => $a->category],
                'amount' => $amount];
        }

        return ['period' => $period, 'rows' => $rows, 'total' => round(array_sum(array_column($rows, 'amount')), 2),
            'posted' => AssetDepreciation::where('period', $period)->sum('amount') + 0.0];
    }

    /**
     * Post one month's depreciation for every asset not yet charged for it.
     * Months must go in order, so earlier missing months are caught up first.
     *
     * @return array<string, array{count:int, total:float, voucher:?string}>
     */
    public function depreciate(string $period): array
    {
        $target = Carbon::parse($period.'-01');
        if ($target->copy()->startOfMonth()->gt(now()->startOfMonth())) {
            throw ValidationException::withMessages(['period' => __('ভবিষ্যতের মাসের অবচয় চালানো যায় না।')]);
        }
        $first = Asset::whereNotIn('status', Asset::GONE)->min('depreciation_from');
        if (! $first) {
            return [];
        }
        $cursor = Carbon::parse($first)->startOfMonth();
        $result = [];
        while ($cursor->lte($target)) {
            $key = $cursor->format('Y-m');
            $preview = $this->depreciationPreview($key);
            if ($preview['rows']) {
                try {
                    $this->ledger->openPeriodFor($cursor->copy()->endOfMonth()->toDateString());
                } catch (ValidationException) {
                    // a closed accounting month stays unposted; it shows up again in the preview
                    $result[$key] = ['count' => 0, 'total' => 0.0, 'voucher' => null, 'skipped' => true];
                    $cursor->addMonthNoOverflow();

                    continue;
                }
                $result[$key] = $this->postMonth($key, $preview['rows']);
            }
            $cursor->addMonthNoOverflow();
        }

        return $result;
    }

    private function postMonth(string $period, array $rows): array
    {
        return DB::transaction(function () use ($period, $rows) {
            $total = round(array_sum(array_column($rows, 'amount')), 2);
            $date = Carbon::parse($period.'-01')->endOfMonth()->toDateString();
            $journal = $this->ledger->postNow('journal', $date, __(':period মাসের সম্পদের অবচয় (:n টি সম্পদ)', ['period' => $period, 'n' => count($rows)]), [
                ['account_id' => Account::byKey('depreciation_expense')->id, 'debit' => $total],
                ['account_id' => Account::byKey('accumulated_depreciation')->id, 'credit' => $total],
            ], 'asset');
            foreach ($rows as $r) {
                $asset = Asset::whereKey($r['asset']['id'])->lockForUpdate()->first();
                $acc = round((float) $asset->accumulated_depreciation + $r['amount'], 2);
                $asset->update(['accumulated_depreciation' => $acc]);
                AssetDepreciation::create([
                    'asset_id' => $asset->id, 'period' => $period, 'amount' => $r['amount'], 'accumulated_after' => $acc,
                    'book_value_after' => round((float) $asset->cost - $acc, 2), 'journal_id' => $journal->id,
                ]);
            }

            return ['count' => count($rows), 'total' => $total, 'voucher' => $journal->voucher_no];
        });
    }

    // ---- sale / write-off ----

    /** @param  array{type:string, date:string, price?:float, method?:string, fund_account_id?:?int, reference?:?string, reason:string}  $data */
    public function requestDisposal(Asset $asset, array $data): ApprovalRequest
    {
        if (in_array($asset->status, [...Asset::GONE, 'disposal_pending'], true)) {
            throw ValidationException::withMessages(['type' => $asset->status === 'disposal_pending'
                ? __('এই সম্পদের বিক্রয়/বাতিল অনুমোদনের অপেক্ষায় আছে।') : __('সম্পদটি আগেই বিক্রয়/বাতিল হয়েছে।')]);
        }
        $price = $data['type'] === 'sale' ? round((float) ($data['price'] ?? 0), 2) : 0.0;
        if ($data['type'] === 'sale') {
            if ($price <= 0) {
                throw ValidationException::withMessages(['price' => __('বিক্রয়মূল্য দিন।')]);
            }
            if (($data['method'] ?? 'cash') !== 'cash' && empty($data['reference'])) {
                throw ValidationException::withMessages(['reference' => __('ব্যাংক/অন্যান্য মাধ্যমে রেফারেন্স (চেক বা লেনদেন নম্বর) দিন।')]);
            }
            if (($data['method'] ?? 'cash') !== 'cash') {
                $this->receipts->fund('asset', $data['method'], $data['fund_account_id'] ?? null);
            }
        }
        $this->ledger->openPeriodFor($data['date']);

        return DB::transaction(function () use ($asset, $data, $price) {
            $disposal = ['type' => $data['type'], 'date' => $data['date'], 'price' => $price, 'method' => $data['type'] === 'sale' ? ($data['method'] ?? 'cash') : null,
                'fund_account_id' => $data['fund_account_id'] ?? null, 'reference' => $data['reference'] ?? null, 'reason' => $data['reason'],
                'previous_status' => $asset->status, 'buyer' => $data['buyer'] ?? null];
            $asset->update(['status' => 'disposal_pending', 'disposal' => $disposal]);
            $this->move($asset, 'dispose_request', $data['date'], ['amount' => $price ?: null, 'note' => $data['reason']]);

            return $this->approvals->submit(
                'asset.disposal',
                ($data['type'] === 'sale' ? __('সম্পদ বিক্রয়') : __('সম্পদ বাতিল (অকেজো)')).': '.$asset->asset_code.' — '.$asset->name_bn,
                $asset,
                ['সম্পদ' => $asset->asset_code.' — '.$asset->name_bn, 'ধরন' => $data['type'] === 'sale' ? 'বিক্রয়' : 'বাতিল (অকেজো)',
                    'তারিখ' => Carbon::parse($data['date'])->format('d/m/Y'), 'ক্রয়মূল্য' => (float) $asset->cost,
                    'পুঞ্জীভূত অবচয়' => (float) $asset->accumulated_depreciation, 'বর্তমান মূল্য' => $asset->book_value,
                    'বিক্রয়মূল্য' => $price, 'কারণ' => $data['reason']],
                null,
                max($price, $asset->book_value),
            );
        });
    }

    /** Approval handler: take cost and depreciation off the books, book the sale money and the gain or loss. */
    public function dispose(Asset $asset): void
    {
        DB::transaction(function () use ($asset) {
            $asset = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
            if ($asset->status !== 'disposal_pending') {
                return;
            }
            $d = $asset->disposal;
            $cost = (float) $asset->cost;
            $acc = (float) $asset->accumulated_depreciation;
            $price = (float) $d['price'];
            $gain = round($price - ($cost - $acc), 2);
            $lines = [];
            if ($acc > 0) {
                $lines[] = ['account_id' => Account::byKey('accumulated_depreciation')->id, 'debit' => $acc];
            }
            if ($price > 0) {
                $fund = ($d['method'] ?? 'cash') === 'cash' ? Account::byKey('cash_society') : $this->receipts->fund('asset', $d['method'], $d['fund_account_id'] ?? null);
                $lines[] = ['account_id' => $fund->id, 'debit' => $price, 'remarks' => $d['reference'] ?? null];
            }
            if ($gain < 0) {
                $lines[] = ['account_id' => Account::byKey('asset_disposal_loss')->id, 'debit' => -$gain];
            }
            $lines[] = ['account_id' => Account::byKey('fixed_assets')->id, 'credit' => $cost];
            if ($gain > 0) {
                $lines[] = ['account_id' => Account::byKey('asset_sale_gain')->id, 'credit' => $gain];
            }
            $journal = $this->ledger->postNow($price > 0 ? 'receipt' : 'journal', $d['date'],
                ($d['type'] === 'sale' ? __('সম্পদ বিক্রয়') : __('সম্পদ বাতিল (অকেজো)')).' '.$asset->asset_code.' — '.$asset->name_bn, $lines, 'asset', $asset);
            $status = $d['type'] === 'sale' ? 'sold' : 'disposed';
            $asset->update(['status' => $status, 'disposal' => $d + ['gain' => $gain, 'journal_id' => $journal->id, 'book_value' => round($cost - $acc, 2)]]);
            $this->move($asset, $status, $d['date'], ['amount' => $price ?: null, 'journal_id' => $journal->id, 'note' => $d['reason'] ?? null]);
            AssetMaintenance::where('asset_id', $asset->id)->where('status', 'scheduled')->update(['status' => 'cancelled']);
        });
    }

    public function keep(Asset $asset): void
    {
        DB::transaction(function () use ($asset) {
            $asset = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
            if ($asset->status !== 'disposal_pending') {
                return;
            }
            $prev = $asset->disposal['previous_status'] ?? 'in_stock';
            $asset->update(['status' => $prev, 'disposal' => null]);
            $this->move($asset, 'dispose_rejected', now()->toDateString(), []);
        });
    }

    private function move(Asset $asset, string $type, string $date, array $data): void
    {
        AssetMovement::create(['asset_id' => $asset->id, 'type' => $type, 'date' => $date, 'created_by' => auth()->id()] + $data);
    }
}
