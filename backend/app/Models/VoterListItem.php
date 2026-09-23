<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VoterListItem extends Model
{
    public $timestamps = false;

    protected $fillable = ['voter_list_id', 'member_id', 'serial', 'member_no', 'name', 'father_name', 'village', 'eligible', 'reason'];

    protected $casts = ['eligible' => 'boolean'];
}
