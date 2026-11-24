<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** A line of a fund's receipts & payments statement (জমা-খরচ বিবরণী) and the ledger accounts it gathers. */
class StatementHead extends Model
{
    use Auditable;

    protected string $auditModule = 'accounting';

    protected $fillable = ['fund', 'side', 'name_bn', 'name_en', 'kind', 'sort_order', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function accounts()
    {
        return $this->belongsToMany(Account::class, 'statement_head_accounts', 'statement_head_id', 'account_id')->withPivot(['fund', 'side'])->withTimestamps();
    }
}
