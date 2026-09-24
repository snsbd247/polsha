<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AssetMovement extends Model
{
    public const TYPES = [
        'acquire' => 'অর্জন', 'transfer' => 'স্থানান্তর', 'install' => 'স্থাপন', 'uninstall' => 'স্টকে ফেরত', 'condition' => 'অবস্থা পরিবর্তন',
        'repair' => 'মেরামতে পাঠানো', 'repaired' => 'মেরামত শেষ', 'dispose_request' => 'বিক্রয়/বাতিলের আবেদন',
        'dispose_rejected' => 'বিক্রয়/বাতিল নামঞ্জুর', 'disposed' => 'বাতিল', 'sold' => 'বিক্রয়',
    ];

    protected $fillable = ['asset_id', 'type', 'date', 'from_location', 'to_location', 'custodian', 'condition', 'amount', 'note', 'journal_id', 'created_by'];

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2'];

    public function asset()
    {
        return $this->belongsTo(Asset::class);
    }

    public function journal()
    {
        return $this->belongsTo(Journal::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }
}
