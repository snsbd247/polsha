<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MembershipStatusHistory extends Model
{
    protected $table = 'membership_status_history';

    protected $fillable = [
        'member_id', 'action', 'from_status', 'to_status', 'effective_date', 'reason_type', 'reason',
        'resolution_no', 'fee', 'approval_request_id', 'created_by',
    ];

    protected $casts = ['effective_date' => 'date:Y-m-d', 'fee' => 'decimal:2'];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
