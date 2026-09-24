<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class DayClose extends Model
{
    use Auditable;

    public const STATUSES = ['closed' => 'বন্ধ', 'reopen_pending' => 'খোলার অপেক্ষায়', 'reopened' => 'পুনরায় খোলা'];

    protected string $auditModule = 'cash';

    protected $fillable = [
        'date', 'opening', 'collections', 'payments', 'expected', 'actual', 'difference', 'breakdown', 'denominations', 'note',
        'status', 'closed_by', 'closed_at', 'reopen_reason', 'reopened_by', 'reopened_at',
    ];

    protected $casts = [
        'date' => 'date:Y-m-d', 'opening' => 'decimal:2', 'collections' => 'decimal:2', 'payments' => 'decimal:2', 'expected' => 'decimal:2',
        'actual' => 'decimal:2', 'difference' => 'decimal:2', 'breakdown' => 'array', 'denominations' => 'array',
        'closed_at' => 'datetime', 'reopened_at' => 'datetime',
    ];

    /**
     * The latest closed day. Cash may not be booked on it or any day
     * before it (a later entry would change a counted day's opening).
     */
    public static function lastClosed(): ?self
    {
        return static::whereIn('status', ['closed', 'reopen_pending'])->orderByDesc('date')->first();
    }

    public static function lockedOn(string $date): ?self
    {
        $last = static::lastClosed();

        return $last && Carbon::parse($date)->toDateString() <= $last->date->toDateString() ? $last : null;
    }

    public function closer()
    {
        return $this->belongsTo(User::class, 'closed_by')->withTrashed();
    }

    public function reopener()
    {
        return $this->belongsTo(User::class, 'reopened_by')->withTrashed();
    }
}
