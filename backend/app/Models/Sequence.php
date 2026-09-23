<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Sequence extends Model
{
    use Auditable;

    protected string $auditModule = 'settings';

    protected $fillable = ['key', 'label', 'prefix', 'pad_length', 'next_value', 'reset_yearly', 'current_year'];

    protected $casts = ['reset_yearly' => 'boolean'];
}
