<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class LandNote extends Model
{
    use Auditable;

    protected string $auditModule = 'land';

    protected $fillable = ['land_id', 'note', 'created_by'];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
