<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** A member's savings account or share account (never both in one row). */
class MemberAccount extends Model
{
    use Auditable;

    public const KINDS = ['savings' => 'সঞ্চয়', 'share' => 'শেয়ার'];

    /** kind → ledger account key, number sequence, transaction sequence, "money in" type. */
    public const CONFIG = [
        'savings' => ['ledger' => 'savings_deposits', 'seq' => 'savings_account', 'txn_seq' => 'savings_txn', 'in' => 'deposit'],
        'share' => ['ledger' => 'share_capital', 'seq' => 'share_account', 'txn_seq' => 'share_txn', 'in' => 'purchase'],
    ];

    public const STATUSES = ['active' => 'সক্রিয়', 'closed' => 'বন্ধ'];

    protected string $auditModule = 'savings';

    public function auditModule(): string
    {
        return $this->kind === 'share' ? 'share' : 'savings';
    }

    protected $fillable = ['kind', 'member_id', 'account_no', 'opened_on', 'status', 'balance', 'remarks', 'created_by'];

    protected $casts = ['opened_on' => 'date:Y-m-d', 'balance' => 'decimal:2'];

    public function member()
    {
        return $this->belongsTo(Member::class);
    }

    public function transactions()
    {
        return $this->hasMany(MemberTransaction::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function ledgerAccount(): Account
    {
        return Account::byKey(self::CONFIG[$this->kind]['ledger']);
    }

    /** Money already promised out by requests still waiting for approval. */
    public function heldAmount(): float
    {
        return round((float) $this->transactions()->where('status', 'pending')->where('direction', 'out')->sum('amount'), 2);
    }

    public function available(): float
    {
        return round((float) $this->balance - $this->heldAmount(), 2);
    }
}
