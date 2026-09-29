<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One print of a receipt; copy_no 1 is the original, higher numbers are reprints. */
class PrintLog extends Model
{
    public const UPDATED_AT = null;

    /** document type => [model, permission(s) needed to see it]. */
    public const DOCUMENTS = [
        'receipt' => [Receipt::class, ['payment.view']],
        'combined_payment' => [CombinedPayment::class, ['payment.view']],
        'loan_payment' => [LoanPayment::class, ['loan.view']],
        'member_transaction' => [MemberTransaction::class, ['savings.view', 'share.view']],
    ];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function user()
    {
        return $this->belongsTo(User::class)->withTrashed();
    }
}
