<?php

namespace Database\Seeders;

use App\Models\ApprovalRule;
use App\Models\Sequence;
use Illuminate\Database\Seeder;

class SystemSeeder extends Seeder
{
    public function run(): void
    {
        $sequences = [
            ['key' => 'farmer', 'label' => 'Farmer ID', 'prefix' => 'F-', 'pad_length' => 6, 'reset_yearly' => false],
            // Continues the legacy register numbering (e.g. 96, 230, 5876, 10001) — no prefix, no padding.
            ['key' => 'member', 'label' => 'Member Number', 'prefix' => '', 'pad_length' => 0, 'reset_yearly' => false],
            ['key' => 'membership_application', 'label' => 'সদস্যপদ আবেদন', 'prefix' => 'MA-{YYYY}-', 'pad_length' => 4, 'reset_yearly' => true],
            ['key' => 'household', 'label' => 'খানা (Household)', 'prefix' => 'H-', 'pad_length' => 5, 'reset_yearly' => false],
        ];
        foreach ($sequences as $s) {
            Sequence::firstOrCreate(['key' => $s['key']], $s + ['next_value' => 1, 'current_year' => (int) date('Y')]);
        }

        $twoStep = [['manager'], ['president']];
        $rules = [
            ['action_key' => 'membership.admit', 'module' => 'membership', 'label' => 'সদস্যপদ অনুমোদন', 'steps' => $twoStep],
            ['action_key' => 'member.deactivate', 'module' => 'member', 'label' => 'সদস্য নিষ্ক্রিয়করণ', 'steps' => $twoStep],
            ['action_key' => 'member.activate', 'module' => 'member', 'label' => 'সদস্য সক্রিয়করণ', 'steps' => $twoStep],
            ['action_key' => 'member.cancel', 'module' => 'member', 'label' => 'সদস্যপদ বাতিল', 'steps' => $twoStep],
            ['action_key' => 'member.reactivate', 'module' => 'member', 'label' => 'সদস্যপদ পুনর্বহাল', 'steps' => $twoStep],
            ['action_key' => 'farmer.merge', 'module' => 'farmer', 'label' => 'কৃষক মার্জ', 'steps' => [['manager']]],
        ];
        foreach ($rules as $r) {
            ApprovalRule::firstOrCreate(['action_key' => $r['action_key']], $r + ['enabled' => true]);
        }
    }
}
