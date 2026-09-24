<?php

namespace App\Models;

use App\Contracts\Payable;
use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;

class Invoice extends Model implements Payable
{
    use Auditable;

    public const STATUSES = ['unpaid' => 'অপরিশোধিত', 'partial' => 'আংশিক পরিশোধিত', 'paid' => 'পরিশোধিত', 'cancelled' => 'বাতিল'];

    protected string $auditModule = 'irrigation';

    protected $auditExclude = ['snapshot'];

    protected $fillable = [
        'invoice_no', 'season_id', 'land_id', 'farmer_id', 'cultivation_type', 'land_type_id', 'irrigation_type_id', 'rate_id',
        'invoice_date', 'due_date', 'area_decimal', 'rate', 'amount', 'paid_amount', 'status', 'snapshot', 'remarks',
        'batch_id', 'journal_id', 'created_by', 'cancelled_at', 'cancelled_by', 'cancel_reason',
    ];

    protected $casts = [
        'invoice_date' => 'date:Y-m-d', 'due_date' => 'date:Y-m-d', 'area_decimal' => 'decimal:4', 'rate' => 'decimal:4',
        'amount' => 'decimal:2', 'paid_amount' => 'decimal:2', 'snapshot' => 'array', 'cancelled_at' => 'datetime',
    ];

    public function season()
    {
        return $this->belongsTo(Season::class);
    }

    public function land()
    {
        return $this->belongsTo(Land::class)->withTrashed();
    }

    public function farmer()
    {
        return $this->belongsTo(Farmer::class)->withTrashed();
    }

    public function irrigationType()
    {
        return $this->belongsTo(IrrigationType::class);
    }

    public function landType()
    {
        return $this->belongsTo(LandType::class);
    }

    public function rateRow()
    {
        return $this->belongsTo(IrrigationRate::class, 'rate_id');
    }

    public function batch()
    {
        return $this->belongsTo(InvoiceBatch::class, 'batch_id');
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function receiptItems()
    {
        return $this->morphMany(ReceiptItem::class, 'payable');
    }

    public function dueAmount(): float
    {
        return $this->status === 'cancelled' ? 0.0 : round((float) $this->amount - (float) $this->paid_amount, 2);
    }

    public function creditAccountId(): int
    {
        return Account::byKey('irrigation_receivable')->id;
    }

    public function payableLabel(): string
    {
        $s = $this->snapshot ?? [];

        return __('সেচ চার্জ :season — দাগ :dag (:invoice)', ['season' => $s['season'] ?? '', 'dag' => $s['dag_no'] ?? '', 'invoice' => $this->invoice_no]);
    }

    public function applyPayment(float $amount): void
    {
        $fresh = self::whereKey($this->id)->lockForUpdate()->firstOrFail();
        if ($fresh->status === 'cancelled') {
            throw ValidationException::withMessages(['items' => __('ইনভয়েস :no বাতিল করা হয়েছে।', ['no' => $fresh->invoice_no])]);
        }
        if (round($amount, 2) > $fresh->dueAmount()) {
            throw ValidationException::withMessages(['items' => __('ইনভয়েস :no-এর বকেয়ার চেয়ে বেশি টাকা নেওয়া যাবে না (বকেয়া :due)।', [
                'no' => $fresh->invoice_no, 'due' => number_format($fresh->dueAmount(), 2),
            ])]);
        }
        $fresh->setPaid(round((float) $fresh->paid_amount + $amount, 2));
    }

    public function revertPayment(float $amount): void
    {
        $fresh = self::whereKey($this->id)->lockForUpdate()->firstOrFail();
        $fresh->setPaid(max(0, round((float) $fresh->paid_amount - $amount, 2)));
    }

    private function setPaid(float $paid): void
    {
        $status = $this->status === 'cancelled' ? 'cancelled'
            : ($paid <= 0 ? 'unpaid' : ($paid >= (float) $this->amount ? 'paid' : 'partial'));
        $this->update(['paid_amount' => $paid, 'status' => $status]);
    }
}
