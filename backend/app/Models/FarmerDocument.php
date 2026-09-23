<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class FarmerDocument extends Model
{
    use Auditable;

    protected string $auditModule = 'farmer';

    protected $fillable = ['farmer_id', 'type', 'path', 'original_name', 'mime', 'size', 'remarks', 'uploaded_by'];

    protected $hidden = ['path'];

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by')->withTrashed();
    }
}
