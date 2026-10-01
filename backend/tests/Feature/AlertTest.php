<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\CombinedPayment;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\SettingService;
use Illuminate\Support\Carbon;

/** The bell's alerts: unclosed cash days, cash left with field collectors, approvals waiting too long. */
class AlertTest extends Phase2TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function alerts(User $user): array
    {
        return collect($this->actingAs($user)->getJson('/api/approvals/pending-count')->assertOk()->json('alerts'))->pluck('key')->all();
    }

    public function test_alerts_appear_after_the_set_days_and_only_for_those_who_can_act(): void
    {
        Carbon::setTestNow('2026-06-30 10:00:00');
        $cashier = $this->userWithRole('cashier');
        $member = $this->userWithRole('member_officer');
        $collector = $this->userWithRole('field_collector');

        // cash moved on 06-28: not yet late with the default 3 days
        app(LedgerService::class)->postNow('opening', '2026-06-28', 'প্রারম্ভিক নগদ', [
            ['account_id' => Account::byKey('cash_society')->id, 'debit' => 5000],
            ['account_id' => Account::byKey('opening_balance_equity')->id, 'credit' => 5000],
        ]);
        $this->assertNotContains('day_close', $this->alerts($cashier));
        SettingService::setMany(['alert_day_close_days' => 1]);
        $this->assertContains('day_close', $this->alerts($cashier));
        $this->assertNotContains('day_close', $this->alerts($member)); // no cash permission

        // a field collection two days old, not handed in
        $farmer = $this->makeFarmer();
        $p = CombinedPayment::create([
            'payment_no' => 'CP-T1', 'farmer_id' => $farmer->id, 'payer_name' => 'x', 'date' => '2026-06-28', 'amount' => 500, 'method' => 'cash',
            'status' => 'posted', 'verify_token' => 'tok', 'created_by' => $collector->id, 'field_collector_id' => $collector->id,
        ]);
        $this->assertContains('field_cash_'.$collector->id, $this->alerts($cashier));
        $this->assertNotContains('field_cash_'.$collector->id, $this->alerts($member));
        $p->update(['status' => 'cancelled']);
        $this->assertNotContains('field_cash_'.$collector->id, $this->alerts($cashier)); // cause gone, alert gone

        // an approval waiting four days
        $req = ApprovalRequest::create([
            'action_key' => 'savings.withdrawal', 'module' => 'savings', 'title' => 'উত্তোলন', 'requested_by' => $member->id,
            'status' => ApprovalRequest::PENDING, 'current_step' => 1, 'total_steps' => 1,
        ]);
        $req->steps()->create(['step_no' => 1, 'roles' => ['manager'], 'status' => 'pending']);
        $req->forceFill(['created_at' => now()->subDays(4)])->save();
        $this->assertContains('approvals', $this->alerts($this->manager));
        $this->assertNotContains('approvals', $this->alerts($cashier));
    }
}
