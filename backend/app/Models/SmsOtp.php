<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SmsOtp extends Model
{
    protected $fillable = ['user_id', 'purpose', 'code_hash', 'attempts', 'expires_at', 'used_at'];

    protected $hidden = ['code_hash'];

    protected $casts = ['expires_at' => 'datetime', 'used_at' => 'datetime'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
