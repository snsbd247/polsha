<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Asset extends Model
{
    use Auditable;

    public const STATUSES = [
        'in_stock' => 'স্টকে', 'installed' => 'স্থাপিত', 'in_repair' => 'মেরামতে', 'disposal_pending' => 'বিক্রয়/বাতিলের অপেক্ষায়',
        'disposed' => 'বাতিলকৃত', 'sold' => 'বিক্রীত',
    ];

    public const CONDITIONS = ['good' => 'ভালো', 'fair' => 'চলনসই', 'poor' => 'খারাপ', 'damaged' => 'অকেজো'];

    public const ACQUISITIONS = ['purchase' => 'ক্রয়', 'opening' => 'পূর্বের সম্পদ (প্রারম্ভিক)', 'donation' => 'অনুদান'];

    /** No longer on the books. */
    public const GONE = ['disposed', 'sold'];

    protected string $auditModule = 'asset';

    protected $fillable = [
        'asset_code', 'name_bn', 'name_en', 'category_id', 'brand_model', 'serial_no', 'supplier', 'purchase_date', 'cost', 'salvage_value',
        'life_months', 'depreciation_from', 'accumulated_depreciation', 'acquisition', 'location', 'mouza_id', 'custodian', 'condition',
        'status', 'installed_on', 'method', 'fund_account_id', 'reference', 'journal_id', 'disposal', 'remarks', 'created_by',
    ];

    protected $casts = [
        'purchase_date' => 'date:Y-m-d', 'depreciation_from' => 'date:Y-m-d', 'installed_on' => 'date:Y-m-d', 'cost' => 'decimal:2',
        'salvage_value' => 'decimal:2', 'accumulated_depreciation' => 'decimal:2', 'life_months' => 'integer', 'disposal' => 'array',
    ];

    protected $appends = ['book_value'];

    public function getBookValueAttribute(): float
    {
        return round((float) $this->cost - (float) $this->accumulated_depreciation, 2);
    }

    /** Straight-line monthly charge: (cost − salvage) ÷ life. */
    public function monthlyCharge(): float
    {
        return $this->life_months > 0 ? round(((float) $this->cost - (float) $this->salvage_value) / $this->life_months, 2) : 0.0;
    }

    /** What is still left to depreciate. */
    public function depreciable(): float
    {
        return max(0.0, round((float) $this->cost - (float) $this->salvage_value - (float) $this->accumulated_depreciation, 2));
    }

    public function category()
    {
        return $this->belongsTo(AssetCategory::class, 'category_id');
    }

    public function mouza()
    {
        return $this->belongsTo(Mouza::class);
    }

    public function movements()
    {
        return $this->hasMany(AssetMovement::class);
    }

    public function maintenances()
    {
        return $this->hasMany(AssetMaintenance::class);
    }

    public function depreciations()
    {
        return $this->hasMany(AssetDepreciation::class);
    }

    public function fund()
    {
        return $this->belongsTo(Account::class, 'fund_account_id');
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
