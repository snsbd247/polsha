<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Season extends Model
{
    use Auditable;

    public const STATUSES = ['planned' => 'পরিকল্পিত', 'open' => 'চলমান', 'closed' => 'বন্ধ'];

    protected string $auditModule = 'irrigation';

    protected $fillable = ['name_bn', 'crop', 'start_date', 'end_date', 'due_date', 'status', 'remarks', 'created_by'];

    protected $casts = ['start_date' => 'date:Y-m-d', 'end_date' => 'date:Y-m-d', 'due_date' => 'date:Y-m-d'];

    public function rates()
    {
        return $this->hasMany(IrrigationRate::class);
    }

    public function invoices()
    {
        return $this->hasMany(Invoice::class);
    }
}
