<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class VoterList extends Model
{
    use Auditable;

    protected string $auditModule = 'member';

    protected $fillable = ['title', 'cutoff_date', 'min_months', 'eligible_count', 'ineligible_count', 'created_by'];

    protected $casts = ['cutoff_date' => 'date:Y-m-d'];

    public function items()
    {
        return $this->hasMany(VoterListItem::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
