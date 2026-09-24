<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class AssetMaintenance extends Model
{
    use Auditable;

    public const KINDS = ['service' => 'নিয়মিত রক্ষণাবেক্ষণ', 'repair' => 'মেরামত'];

    public const STATUSES = ['scheduled' => 'নির্ধারিত', 'done' => 'সম্পন্ন', 'cancelled' => 'বাতিল'];

    protected string $auditModule = 'asset';

    protected $fillable = [
        'asset_id', 'kind', 'title', 'due_on', 'repeat_months', 'done_on', 'cost', 'vendor', 'status', 'method', 'fund_account_id',
        'reference', 'journal_id', 'note', 'created_by',
    ];

    protected $casts = ['due_on' => 'date:Y-m-d', 'done_on' => 'date:Y-m-d', 'cost' => 'decimal:2', 'repeat_months' => 'integer'];

    public function asset()
    {
        return $this->belongsTo(Asset::class);
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
