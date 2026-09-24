<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ImportBatch extends Model
{
    public const STATUSES = ['completed', 'rollback_pending', 'rolled_back'];

    protected $fillable = [
        'type', 'filename', 'total_rows', 'imported_rows', 'skipped_rows', 'total_amount', 'errors', 'mapping', 'status',
        'approval_request_id', 'rollback_reason', 'rolled_back_at', 'rolled_back_by', 'created_by',
    ];

    protected $casts = ['errors' => 'array', 'mapping' => 'array', 'total_amount' => 'decimal:2', 'rolled_back_at' => 'datetime'];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function rolledBackBy()
    {
        return $this->belongsTo(User::class, 'rolled_back_by')->withTrashed();
    }

    public function approvalRequest()
    {
        return $this->belongsTo(ApprovalRequest::class);
    }
}
