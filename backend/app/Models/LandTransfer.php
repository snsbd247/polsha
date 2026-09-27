<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class LandTransfer extends Model
{
    use Auditable;

    protected string $auditModule = 'land';

    public const TYPES = ['full' => 'পূর্ণ হস্তান্তর', 'partial' => 'আংশিক হস্তান্তর'];

    public const REASONS = ['sale' => 'বিক্রয়', 'inheritance' => 'উত্তরাধিকার', 'gift' => 'দান / হেবা', 'exchange' => 'বিনিময়', 'court' => 'আদালতের আদেশ', 'other' => 'অন্যান্য'];

    protected $fillable = [
        'transfer_no', 'land_id', 'from_farmer_id', 'to_farmer_id', 'type', 'share_percent', 'reason', 'transfer_date',
        'amount', 'remarks', 'status', 'approval_request_id', 'created_by',
    ];

    protected $casts = ['transfer_date' => 'date:Y-m-d', 'share_percent' => 'float', 'amount' => 'float'];

    public function land()
    {
        return $this->belongsTo(Land::class);
    }

    public function fromFarmer()
    {
        return $this->belongsTo(Farmer::class, 'from_farmer_id')->withTrashed();
    }

    public function toFarmer()
    {
        return $this->belongsTo(Farmer::class, 'to_farmer_id')->withTrashed();
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
