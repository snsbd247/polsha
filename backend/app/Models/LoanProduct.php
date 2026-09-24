<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** A kind of loan: limit, interest, schedule and penalty terms. */
class LoanProduct extends Model
{
    use Auditable;

    public const CATEGORIES = ['agriculture' => 'কৃষি ঋণ', 'business' => 'ব্যবসায়িক ঋণ', 'general' => 'সাধারণ ঋণ', 'emergency' => 'জরুরি ঋণ'];

    public const METHODS = ['flat' => 'ফ্ল্যাট (Flat)', 'declining' => 'ক্রমহ্রাসমান (Declining)'];

    public const FREQUENCIES = ['monthly' => 'মাসিক', 'weekly' => 'সাপ্তাহিক', 'quarterly' => 'ত্রৈমাসিক/মৌসুমি', 'one_time' => 'এককালীন (ফসল ওঠার পর)'];

    protected string $auditModule = 'loan';

    protected $fillable = [
        'code', 'name_bn', 'name_en', 'category', 'max_amount', 'savings_multiplier', 'interest_rate', 'interest_method',
        'frequency', 'installments', 'term_months', 'penalty_rate', 'grace_days', 'guarantors_required', 'is_active', 'description',
    ];

    protected $casts = [
        'max_amount' => 'decimal:2', 'savings_multiplier' => 'decimal:2', 'interest_rate' => 'decimal:2', 'penalty_rate' => 'decimal:2',
        'installments' => 'integer', 'term_months' => 'integer', 'grace_days' => 'integer', 'guarantors_required' => 'integer', 'is_active' => 'boolean',
    ];

    public function loans()
    {
        return $this->hasMany(Loan::class, 'product_id');
    }
}
