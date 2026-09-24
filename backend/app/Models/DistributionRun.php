<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** Profit on savings (amounts typed per member) or dividend on share capital (pro-rata). */
class DistributionRun extends Model
{
    use Auditable;

    public const KINDS = ['profit' => 'সঞ্চয়ের মুনাফা', 'dividend' => 'শেয়ারের লভ্যাংশ'];

    public const STATUSES = ['pending' => 'অনুমোদনের অপেক্ষায়', 'posted' => 'পোস্টেড', 'rejected' => 'প্রত্যাখ্যাত'];

    protected string $auditModule = 'savings';

    protected $fillable = [
        'run_no', 'kind', 'title', 'date', 'basis_date', 'pool_amount', 'total_amount', 'status', 'remarks',
        'approval_request_id', 'journal_id', 'created_by', 'posted_at',
    ];

    protected $casts = [
        'date' => 'date:Y-m-d', 'basis_date' => 'date:Y-m-d', 'pool_amount' => 'decimal:2', 'total_amount' => 'decimal:2', 'posted_at' => 'datetime',
    ];

    public function items()
    {
        return $this->hasMany(DistributionItem::class, 'run_id');
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
