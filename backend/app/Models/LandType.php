<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class LandType extends Model
{
    use Auditable;

    protected string $auditModule = 'land';

    public const CATEGORIES = [
        'agricultural' => 'কৃষি',
        'residential' => 'আবাসিক',
        'waterbody' => 'জলাশয়',
        'non_agricultural' => 'অকৃষি',
        'other' => 'অন্যান্য',
    ];

    protected $fillable = ['name_bn', 'code', 'category', 'description', 'default_rate', 'is_active', 'sort_order'];

    protected $casts = ['is_active' => 'boolean', 'default_rate' => 'float'];

    public function lands()
    {
        return $this->hasMany(Land::class);
    }
}
