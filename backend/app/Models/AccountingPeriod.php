<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class AccountingPeriod extends Model
{
    use Auditable;

    protected string $auditModule = 'accounting';

    protected $fillable = ['period_key', 'fiscal_year', 'start_date', 'end_date', 'status', 'closed_by', 'closed_at'];

    protected $casts = ['start_date' => 'date:Y-m-d', 'end_date' => 'date:Y-m-d', 'closed_at' => 'datetime'];

    public function closer()
    {
        return $this->belongsTo(User::class, 'closed_by')->withTrashed();
    }

    public function journals()
    {
        return $this->hasMany(Journal::class, 'period_id');
    }
}
