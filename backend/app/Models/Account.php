<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Account extends Model
{
    use Auditable;

    public const TYPES = ['asset' => 'সম্পদ', 'liability' => 'দায়', 'equity' => 'মূলধন ও তহবিল', 'income' => 'আয়', 'expense' => 'ব্যয়'];

    /** Cash streams kept apart so irrigation money never mixes with society money. */
    public const CASH_STREAMS = ['cash_irrigation', 'cash_society', 'cash_misc'];

    protected $table = 'chart_of_accounts';

    protected string $auditModule = 'accounting';

    protected $fillable = ['key', 'code', 'name_bn', 'name_en', 'type', 'parent_id', 'is_postable', 'is_system', 'is_active', 'description'];

    protected $casts = ['is_postable' => 'boolean', 'is_system' => 'boolean', 'is_active' => 'boolean'];

    public static function byKey(string $key): self
    {
        return static::where('key', $key)->firstOrFail();
    }

    /** Assets and expenses grow on the debit side. */
    public function isDebitNature(): bool
    {
        return in_array($this->type, ['asset', 'expense'], true);
    }

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function lines()
    {
        return $this->hasMany(JournalLine::class, 'account_id');
    }

    public function bankAccount()
    {
        return $this->hasOne(BankAccount::class, 'account_id');
    }
}
