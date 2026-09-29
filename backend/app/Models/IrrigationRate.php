<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class IrrigationRate extends Model
{
    use Auditable;

    public const STATUSES = ['pending' => 'অনুমোদনের অপেক্ষায়', 'approved' => 'অনুমোদিত', 'rejected' => 'প্রত্যাখ্যাত'];

    protected string $auditModule = 'irrigation';

    protected $fillable = [
        'season_id', 'land_type_id', 'irrigation_type_id', 'rate', 'effective_from', 'status', 'reason',
        'approval_request_id', 'created_by', 'approved_by', 'approved_at',
    ];

    protected $casts = ['rate' => 'decimal:4', 'effective_from' => 'date:Y-m-d', 'approved_at' => 'datetime'];

    public function invoices()
    {
        return $this->hasMany(Invoice::class, 'rate_id');
    }

    public function season()
    {
        return $this->belongsTo(Season::class);
    }

    public function landType()
    {
        return $this->belongsTo(LandType::class);
    }

    public function irrigationType()
    {
        return $this->belongsTo(IrrigationType::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function approver()
    {
        return $this->belongsTo(User::class, 'approved_by')->withTrashed();
    }
}
