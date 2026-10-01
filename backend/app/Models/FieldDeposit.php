<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** A field collector handing the cash they collected in to the office. */
class FieldDeposit extends Model
{
    use Auditable;

    protected string $auditModule = 'field';

    protected $fillable = ['deposit_no', 'collector_id', 'date', 'amount', 'payments_count', 'parts', 'journal_id', 'note', 'received_by'];

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'parts' => 'array', 'payments_count' => 'integer'];

    public function collector()
    {
        return $this->belongsTo(User::class, 'collector_id')->withTrashed();
    }

    public function receiver()
    {
        return $this->belongsTo(User::class, 'received_by')->withTrashed();
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function payments()
    {
        return $this->hasMany(CombinedPayment::class);
    }
}
