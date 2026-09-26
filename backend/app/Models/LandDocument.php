<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class LandDocument extends Model
{
    use Auditable;

    protected string $auditModule = 'land';

    protected $fillable = ['land_id', 'type', 'title', 'path', 'original_name', 'mime', 'size', 'uploaded_by'];

    protected $hidden = ['path'];

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by')->withTrashed();
    }
}
