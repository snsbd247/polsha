<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ImportBatch extends Model
{
    protected $fillable = ['type', 'filename', 'total_rows', 'imported_rows', 'skipped_rows', 'errors', 'status', 'created_by'];

    protected $casts = ['errors' => 'array'];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
