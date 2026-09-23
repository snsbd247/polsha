<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MembershipNominee extends Model
{
    protected $fillable = ['application_id', 'member_id', 'name', 'relation', 'nid', 'mobile', 'share_percent'];

    protected $casts = ['share_percent' => 'decimal:2'];
}
