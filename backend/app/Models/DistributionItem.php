<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DistributionItem extends Model
{
    protected $fillable = ['run_id', 'member_id', 'basis', 'amount', 'transaction_id'];

    protected $casts = ['basis' => 'decimal:2', 'amount' => 'decimal:2'];

    public function run()
    {
        return $this->belongsTo(DistributionRun::class, 'run_id');
    }

    public function member()
    {
        return $this->belongsTo(Member::class);
    }

    public function transaction()
    {
        return $this->belongsTo(MemberTransaction::class, 'transaction_id');
    }
}
