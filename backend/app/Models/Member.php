<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Member extends Model
{
    use Auditable;

    public const ACTIVE = 'active';

    public const INACTIVE = 'inactive';

    public const CANCELLED = 'cancelled';

    protected string $auditModule = 'member';

    protected $fillable = ['farmer_id', 'member_no', 'admitted_on', 'status', 'is_legacy', 'application_id', 'status_changed_on'];

    protected $casts = [
        'admitted_on' => 'date:Y-m-d',
        'status_changed_on' => 'date:Y-m-d',
        'is_legacy' => 'boolean',
        'member_no' => 'integer',
    ];

    public function farmer()
    {
        return $this->belongsTo(Farmer::class);
    }

    public function application()
    {
        return $this->belongsTo(MembershipApplication::class, 'application_id');
    }

    public function nominees()
    {
        return $this->hasMany(MembershipNominee::class);
    }

    public function history()
    {
        return $this->hasMany(MembershipStatusHistory::class)->latest('id');
    }
}
