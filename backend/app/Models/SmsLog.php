<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SmsLog extends Model
{
    /** logged = kept in the outbox only, because no gateway is configured. */
    public const STATUSES = ['pending' => 'অপেক্ষমাণ', 'sent' => 'পাঠানো হয়েছে', 'failed' => 'ব্যর্থ', 'logged' => 'শুধু লগ (গেটওয়ে নেই)'];

    protected $fillable = ['template_key', 'mobile', 'message', 'status', 'attempts', 'response', 'related_type', 'related_id', 'created_by', 'sent_at'];

    protected $casts = ['sent_at' => 'datetime'];

    public function related()
    {
        return $this->morphTo();
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
