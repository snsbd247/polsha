<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Land extends Model
{
    use Auditable, SoftDeletes;

    public const SURVEYS = ['RS' => 'আর.এস', 'BS' => 'বি.এস', 'SA' => 'এস.এ', 'CS' => 'সি.এস', 'other' => 'অন্যান্য'];

    public const STATUSES = ['cultivated' => 'চাষাধীন', 'fallow' => 'পতিত', 'disputed' => 'বিরোধপূর্ণ', 'inactive' => 'নিষ্ক্রিয়'];

    public const CULTIVATION_TYPES = ['own' => 'নিজ চাষ', 'borga' => 'বর্গা', 'lease' => 'লিজ/ইজারা'];

    public const DOCUMENT_TYPES = ['khatian' => 'খতিয়ানের কপি', 'map' => 'দাগের নকশা', 'mutation' => 'নামজারির কাগজ', 'deed' => 'দলিল', 'other' => 'অন্যান্য ডকুমেন্ট'];

    protected string $auditModule = 'land';

    protected $fillable = [
        'land_code', 'mouza_id', 'survey', 'khatian_no', 'dag_no', 'area_decimal', 'land_type_id', 'irrigation_type_id',
        'status', 'remarks', 'created_by', 'import_batch_id', 'village_id', 'latitude', 'longitude', 'location_note', 'irrigable_decimal',
    ];

    protected $casts = ['area_decimal' => 'decimal:4', 'irrigable_decimal' => 'decimal:4', 'latitude' => 'float', 'longitude' => 'float'];

    public function mouza()
    {
        return $this->belongsTo(Mouza::class);
    }

    public function landType()
    {
        return $this->belongsTo(LandType::class);
    }

    public function irrigationType()
    {
        return $this->belongsTo(IrrigationType::class);
    }

    public function invoices()
    {
        return $this->hasMany(Invoice::class);
    }

    public function owners()
    {
        return $this->hasMany(LandOwner::class)->whereNull('end_date');
    }

    public function ownerHistory()
    {
        return $this->hasMany(LandOwner::class)->orderByDesc('start_date')->orderByDesc('id');
    }

    public function cultivation()
    {
        return $this->hasOne(LandCultivation::class)->whereNull('end_date');
    }

    public function cultivationHistory()
    {
        return $this->hasMany(LandCultivation::class)->orderByDesc('start_date')->orderByDesc('id');
    }

    public function documents()
    {
        return $this->hasMany(LandDocument::class)->latest('id');
    }

    public function notes()
    {
        return $this->hasMany(LandNote::class)->latest('id');
    }
}
