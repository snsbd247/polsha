<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class MembershipApplication extends Model
{
    use Auditable;

    /** Statuses in which the form may still be edited and (re)submitted. */
    public const EDITABLE = ['draft', 'returned'];

    protected string $auditModule = 'membership';

    protected $fillable = [
        'application_no', 'farmer_id', 'applied_on', 'proposer_member_id', 'seconder_member_id',
        'admission_fee', 'default_fee', 'fee_override_reason', 'fee_status', 'initial_shares',
        'form_scan', 'signature', 'resolution_no', 'resolution_date', 'status', 'approval_request_id',
        'member_id', 'created_by',
    ];

    protected $casts = [
        'applied_on' => 'date:Y-m-d',
        'resolution_date' => 'date:Y-m-d',
        'admission_fee' => 'decimal:2',
        'default_fee' => 'decimal:2',
    ];

    protected $hidden = ['form_scan', 'signature'];

    protected $appends = ['has_form_scan', 'has_signature'];

    public function getHasFormScanAttribute(): bool
    {
        return (bool) $this->form_scan;
    }

    public function getHasSignatureAttribute(): bool
    {
        return (bool) $this->signature;
    }

    public function farmer()
    {
        return $this->belongsTo(Farmer::class);
    }

    public function nominees()
    {
        return $this->hasMany(MembershipNominee::class, 'application_id');
    }

    public function proposer()
    {
        return $this->belongsTo(Member::class, 'proposer_member_id');
    }

    public function seconder()
    {
        return $this->belongsTo(Member::class, 'seconder_member_id');
    }

    public function approvalRequest()
    {
        return $this->belongsTo(ApprovalRequest::class);
    }

    public function member()
    {
        return $this->belongsTo(Member::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
