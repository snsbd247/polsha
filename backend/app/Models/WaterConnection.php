<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** One water connection = one customer account (like a WASA account number). */
class WaterConnection extends Model
{
    use Auditable;

    public const STATUSES = ['active' => 'চালু', 'disconnected' => 'বিচ্ছিন্ন', 'closed' => 'বন্ধ'];

    protected string $auditModule = 'water';

    protected $fillable = [
        'connection_no', 'type_id', 'farmer_id', 'name_bn', 'name_en', 'father_name', 'mobile', 'nid', 'village_id', 'address',
        'monthly_fee', 'connected_on', 'status', 'status_date', 'status_reason', 'remarks', 'created_by', 'import_batch_id',
    ];

    protected $casts = ['monthly_fee' => 'decimal:2', 'connected_on' => 'date:Y-m-d', 'status_date' => 'date:Y-m-d'];

    public function type()
    {
        return $this->belongsTo(WaterConnectionType::class, 'type_id');
    }

    /** When the customer is a registered farmer: the counter and field collection take this tap's bills with the farmer's other dues. */
    public function farmer()
    {
        return $this->belongsTo(Farmer::class)->withTrashed();
    }

    public function village()
    {
        return $this->belongsTo(Village::class);
    }

    public function bills()
    {
        return $this->hasMany(WaterBill::class, 'connection_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    /** This connection's own fee if set, else its type's. */
    public function fee(): float
    {
        return round((float) ($this->monthly_fee ?? $this->type?->monthly_fee ?? 0), 2);
    }

    /** What every bill copies, so later edits to the connection never change an old bill. */
    public function snapshot(): array
    {
        $this->loadMissing(['type', 'village']);

        return [
            'connection_no' => $this->connection_no, 'name_bn' => $this->name_bn, 'name_en' => $this->name_en,
            'father_name' => $this->father_name, 'mobile' => $this->mobile, 'address' => $this->address,
            'village' => $this->village?->name_bn, 'village_en' => $this->village?->name_en,
            'type' => $this->type?->name_bn, 'type_en' => $this->type?->name_en,
        ];
    }
}
