<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class ApprovalRule extends Model
{
    use Auditable;

    protected string $auditModule = 'approval';

    protected $fillable = ['action_key', 'module', 'label', 'enabled', 'steps', 'min_amount'];

    protected function casts(): array
    {
        return ['enabled' => 'boolean', 'steps' => 'array', 'min_amount' => 'decimal:2'];
    }
}
