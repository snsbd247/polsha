<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class AssetCategory extends Model
{
    use Auditable;

    protected string $auditModule = 'asset';

    protected $fillable = ['code', 'name_bn', 'name_en', 'life_months', 'salvage_percent', 'is_active'];

    protected $casts = ['life_months' => 'integer', 'salvage_percent' => 'decimal:2', 'is_active' => 'boolean'];

    public function assets()
    {
        return $this->hasMany(Asset::class, 'category_id');
    }
}
