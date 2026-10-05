<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** A scanned paper of a water connection (NID, application form, agreement…), kept on the private disk. */
class WaterConnectionDocument extends Model
{
    use Auditable;

    protected string $auditModule = 'water';

    protected $fillable = ['connection_id', 'title', 'path', 'original_name', 'mime', 'size', 'uploaded_by'];

    protected $hidden = ['path'];

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by')->withTrashed();
    }
}
