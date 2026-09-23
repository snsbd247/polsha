<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class ApprovalRequest extends Model
{
    public const PENDING = 'pending';

    public const APPROVED = 'approved';

    public const REJECTED = 'rejected';

    public const RETURNED = 'returned';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'before' => 'array',
            'amount' => 'decimal:2',
            'decided_at' => 'datetime',
        ];
    }

    public function approvable()
    {
        return $this->morphTo();
    }

    public function requester()
    {
        return $this->belongsTo(User::class, 'requested_by')->withTrashed();
    }

    public function steps()
    {
        return $this->hasMany(ApprovalStep::class)->orderBy('step_no');
    }

    public function comments()
    {
        return $this->hasMany(ApprovalComment::class)->latest();
    }

    public function currentStep()
    {
        return $this->steps->firstWhere('step_no', $this->current_step);
    }

    /** Pending requests whose current step one of the given roles may act on. */
    public function scopeAwaitingRoles(Builder $query, array $roles): Builder
    {
        return $query->where('status', self::PENDING)
            ->whereHas('steps', function (Builder $q) use ($roles) {
                $q->whereColumn('approval_steps.step_no', 'approval_requests.current_step')
                    ->where(function (Builder $q) use ($roles) {
                        foreach ($roles as $role) {
                            $q->orWhereJsonContains('roles', $role);
                        }
                    });
            });
    }
}
