<?php

use App\Models\Member;
use App\Services\MemberFundService;
use Illuminate\Database\Migrations\Migration;

/**
 * Savings and share accounts now open with the membership. Active members
 * from before that (old register, imports) get the ones they lack, dated
 * from their admission. Nothing else changes; empty accounts are harmless.
 */
return new class extends Migration
{
    public function up(): void
    {
        $funds = app(MemberFundService::class);
        Member::where('status', Member::ACTIVE)
            ->where(fn ($q) => $q->whereDoesntHave('accounts', fn ($a) => $a->where('kind', 'savings'))
                ->orWhereDoesntHave('accounts', fn ($a) => $a->where('kind', 'share')))
            ->orderBy('id')->each(fn (Member $m) => $funds->ensureAccounts($m, ($m->admitted_on ?? now())->toDateString()));
    }

    // the accounts may have been used since; they are kept
    public function down(): void {}
};
