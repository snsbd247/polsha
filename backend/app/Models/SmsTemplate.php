<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class SmsTemplate extends Model
{
    use Auditable;

    protected string $auditModule = 'sms';

    protected $fillable = ['key', 'name_bn', 'name_en', 'body', 'variables', 'is_active'];

    protected $casts = ['variables' => 'array', 'is_active' => 'boolean'];
}
