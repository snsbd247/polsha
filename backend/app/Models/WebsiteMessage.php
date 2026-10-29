<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** A message from the website's contact page. */
class WebsiteMessage extends Model
{
    use Auditable;

    protected string $auditModule = 'settings';

    protected $fillable = ['name', 'mobile', 'email', 'subject', 'message', 'ip', 'read_at', 'read_by', 'note'];

    protected $casts = ['read_at' => 'datetime'];

    protected $hidden = ['ip'];

    public function reader()
    {
        return $this->belongsTo(User::class, 'read_by')->withTrashed();
    }
}
