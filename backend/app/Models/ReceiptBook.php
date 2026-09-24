<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class ReceiptBook extends Model
{
    use Auditable;

    public const STATUSES = ['stock' => 'মজুদ', 'issued' => 'বিতরণকৃত', 'closed' => 'শেষ/জমা', 'lost' => 'হারানো'];

    protected string $auditModule = 'settings';

    protected $fillable = ['book_no', 'start_no', 'end_no', 'issued_to', 'issued_on', 'status', 'note'];

    protected $casts = ['issued_on' => 'date:Y-m-d', 'start_no' => 'integer', 'end_no' => 'integer'];

    public function holder()
    {
        return $this->belongsTo(User::class, 'issued_to')->withTrashed();
    }
}
