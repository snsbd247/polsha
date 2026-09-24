<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QrScan extends Model
{
    public const UPDATED_AT = null;

    public const TYPES = ['farmer' => 'কৃষক', 'member' => 'সদস্য', 'land' => 'জমি', 'asset' => 'সম্পদ', 'receipt' => 'রশিদ', 'combined' => 'সমন্বিত রশিদ', 'unknown' => 'অজানা'];

    protected $fillable = ['user_id', 'entity_type', 'entity_id', 'code', 'label', 'found', 'source', 'ip', 'user_agent'];

    protected $casts = ['found' => 'boolean', 'created_at' => 'datetime'];

    public function user()
    {
        return $this->belongsTo(User::class)->withTrashed();
    }
}
