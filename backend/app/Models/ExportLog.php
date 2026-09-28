<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExportLog extends Model
{
    public const UPDATED_AT = null;

    public const FORMATS = ['xlsx' => 'Excel', 'csv' => 'CSV', 'print' => 'প্রিন্ট / PDF'];

    protected $fillable = ['user_id', 'report_key', 'title', 'format', 'filters', 'row_count', 'ip', 'dismissed_at'];

    protected $casts = ['filters' => 'array', 'created_at' => 'datetime', 'dismissed_at' => 'datetime'];

    public function user()
    {
        return $this->belongsTo(User::class)->withTrashed();
    }
}
