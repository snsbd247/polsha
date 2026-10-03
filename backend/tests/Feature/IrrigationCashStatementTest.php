<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\BankAccount;
use App\Services\LedgerService;

/** The irrigation cash statement: heads, opening/closing fund and the bank part. */
class IrrigationCashStatementTest extends Phase2TestCase
{
    private function book(string $type, string $date, array $lines, string $module = 'accounting'): void
    {
        app(LedgerService::class)->postNow($type, $date, 'পরীক্ষা', array_map(fn ($l) => ['account_id' => is_int($l[0]) ? $l[0] : Account::byKey($l[0])->id, 'debit' => $l[1], 'credit' => $l[2]], $lines), $module);
    }

    public function test_statement_groups_heads_and_keeps_bank_moves_out_of_income_and_expense(): void
    {
        $user = $this->userWithRole('accountant');
        $bankAccount = Account::create(['code' => '1299', 'name_bn' => 'ব্যাংক', 'type' => 'asset', 'is_postable' => true, 'is_active' => true]);
        BankAccount::create(['account_id' => $bankAccount->id, 'bank_name' => 'ব্যাংক', 'account_no' => '1', 'account_type' => 'savings']);

        // before the period: opening cash 1,000 and a collection of 500
        $this->book('opening', '2026-06-01', [['cash_irrigation', 1000, 0], ['opening_balance_equity', 0, 1000]]);
        $this->book('receipt', '2026-06-15', [['cash_irrigation', 500, 0], ['irrigation_receivable', 0, 500]], 'irrigation');
        // in the period: collections 3,000 + field hand-in 200, two expenses, and 1,500 moved to the bank
        $this->book('receipt', '2026-07-05', [['cash_irrigation', 3000, 0], ['irrigation_receivable', 0, 3000]], 'irrigation');
        $this->book('contra', '2026-07-06', [['cash_irrigation', 200, 0], ['cash_field', 0, 200]], 'payment');
        $this->book('payment', '2026-07-10', [['office_expense', 700, 0], ['cash_irrigation', 0, 700]], 'cash');
        $this->book('payment', '2026-07-11', [['other_expense', 300, 0], ['cash_irrigation', 0, 300]], 'cash');
        $this->book('contra', '2026-07-12', [[$bankAccount->id, 1500, 0], ['cash_irrigation', 0, 1500]], 'bank');

        $r = $this->actingAs($user)->getJson('/api/cashbook/irrigation-statement?from=2026-07-01&to=2027-06-30')->assertOk();
        $this->assertEquals(1500, $r->json('opening'));
        $this->assertEquals(3200, $r->json('total_income'));
        $this->assertSame('সেচ চার্জ আদায় (বকেয়াসহ)', $r->json('income.0.label'));
        $this->assertCount(1, $r->json('income'));
        $this->assertEquals(1000, $r->json('total_expense'));
        $this->assertCount(2, $r->json('expense'));
        $this->assertEquals(1500 + 3200 - 1000, $r->json('closing'));
        $this->assertEquals(1500, $r->json('bank_balance'));

        // a typed opening fund replaces the computed one
        $o = $this->actingAs($user)->getJson('/api/cashbook/irrigation-statement?from=2026-07-01&to=2027-06-30&opening=0')->assertOk();
        $this->assertEquals(0, $o->json('opening'));
        $this->assertEquals(1500, $o->json('opening_computed'));
        $this->assertEquals(2200, $o->json('closing'));
    }

    public function test_society_statement_shows_bank_moves_as_heads_and_lists_the_banks(): void
    {
        $user = $this->userWithRole('accountant');
        $bankAccount = Account::create(['code' => '1298', 'name_bn' => 'ব্যাংক', 'type' => 'asset', 'is_postable' => true, 'is_active' => true]);
        BankAccount::create(['account_id' => $bankAccount->id, 'bank_name' => 'সোনালী', 'account_no' => '3665', 'account_type' => 'savings']);

        $this->book('opening', '2026-06-01', [['cash_society', 2000, 0], [$bankAccount->id, 5000, 0], ['opening_balance_equity', 0, 7000]]);
        $this->book('receipt', '2026-07-03', [['cash_society', 800, 0], ['savings_deposits', 0, 800]], 'savings');
        $this->book('payment', '2026-07-04', [['office_expense', 300, 0], ['cash_society', 0, 300]], 'cash');
        $this->book('contra', '2026-07-05', [[$bankAccount->id, 1000, 0], ['cash_society', 0, 1000]], 'bank');
        $this->book('receipt', '2026-07-31', [[$bankAccount->id, 40, 0], ['other_income', 0, 40]], 'bank');
        $this->book('payment', '2026-07-31', [['bank_charges', 15, 0], [$bankAccount->id, 0, 15]], 'bank');

        $r = $this->actingAs($user)->getJson('/api/cashbook/society-statement?from=2026-07-01&to=2027-06-30')->assertOk();
        $this->assertEquals(2000, $r->json('opening'));
        $this->assertEquals(800, $r->json('total_income'));
        $this->assertEquals(1300, $r->json('total_expense')); // office 300 + taken to the bank 1,000
        $this->assertContains('নগদ ব্যাংকে জমা', collect($r->json('expense'))->pluck('label')->all());
        $this->assertEquals(1500, $r->json('closing'));
        $this->assertNull($r->json('bank_balance'));
        $bank = collect($r->json('banks'))->firstWhere('account_no', '3665');
        $this->assertEquals([5000, 40, 15, 1000, 0, 6025], [$bank['opening'], $bank['interest'], $bank['charges'], $bank['deposits'], $bank['withdrawals'], $bank['closing']]);
    }
}
