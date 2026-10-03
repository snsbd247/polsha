<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\BankAccount;
use App\Services\LedgerService;

/** The income-expense cash book: one line per cash voucher, money spread over head columns. */
class IncomeExpenseCashBookTest extends Phase2TestCase
{
    private function book(string $type, string $date, array $lines, string $module = 'accounting'): void
    {
        app(LedgerService::class)->postNow($type, $date, 'পরীক্ষা', array_map(fn ($l) => ['account_id' => is_int($l[0]) ? $l[0] : Account::byKey($l[0])->id, 'debit' => $l[1], 'credit' => $l[2]], $lines), $module);
    }

    public function test_society_book_spreads_each_voucher_over_heads(): void
    {
        $user = $this->userWithRole('accountant');
        $bankAccount = Account::create(['code' => '1297', 'name_bn' => 'ব্যাংক', 'type' => 'asset', 'is_postable' => true, 'is_active' => true]);
        BankAccount::create(['account_id' => $bankAccount->id, 'bank_name' => 'সোনালী', 'account_no' => '77', 'account_type' => 'savings']);

        $this->book('opening', '2026-06-01', [['cash_society', 2000, 0], ['opening_balance_equity', 0, 2000]]);
        // a loan payment: principal and interest in one voucher
        $this->book('receipt', '2026-07-03', [['cash_society', 1100, 0], ['loans_receivable', 0, 1000], ['loan_interest_income', 0, 100]], 'loan');
        $this->book('receipt', '2026-07-03', [['cash_society', 500, 0], ['savings_deposits', 0, 500]], 'savings');
        $this->book('payment', '2026-07-04', [['office_expense', 300, 0], ['cash_society', 0, 300]], 'cash');
        $this->book('contra', '2026-07-05', [[$bankAccount->id, 1000, 0], ['cash_society', 0, 1000]], 'bank');
        // between the society's own cash accounts: not in the book
        $this->book('contra', '2026-07-06', [['cash_misc', 200, 0], ['cash_society', 0, 200]], 'cash');

        $r = $this->actingAs($user)->getJson('/api/cashbook/income-expense-book?stream=society&from=2026-07-01&to=2026-07-31')->assertOk();
        $this->assertEquals(2000, $r->json('opening'));
        $this->assertCount(2, $r->json('income.rows'));
        $this->assertEquals(['loan' => 1000, 'interest' => 100], $r->json('income.rows.0.cells'));
        $this->assertEquals(1600, $r->json('income.total'));
        $this->assertCount(2, $r->json('expense.rows'));
        $this->assertEquals(['bank' => 1000], $r->json('expense.rows.1.cells'));
        $this->assertContains('অফিস খরচ', collect($r->json('expense.columns'))->pluck('label')->all());
        $this->assertEquals(1300, $r->json('expense.total'));
        $this->assertEquals(2300, $r->json('closing'));
    }

    public function test_irrigation_book_shows_collections_under_irrigation_charge(): void
    {
        $user = $this->userWithRole('accountant');
        $this->book('receipt', '2026-07-05', [['cash_irrigation', 3000, 0], ['irrigation_receivable', 0, 3000]], 'irrigation');
        $this->book('payment', '2026-07-10', [['office_expense', 700, 0], ['cash_irrigation', 0, 700]], 'cash');

        $r = $this->actingAs($user)->getJson('/api/cashbook/income-expense-book?stream=irrigation&from=2026-07-01&to=2026-07-31')->assertOk();
        $this->assertEquals(['irrigation' => 3000], $r->json('income.rows.0.cells'));
        $this->assertEquals(700, $r->json('expense.total'));
        $this->assertEquals(2300, $r->json('closing'));
        $this->actingAs($user)->getJson('/api/cashbook/income-expense-book?stream=bad&from=2026-07-01&to=2026-07-31')->assertStatus(422);
    }

    public function test_a_hand_in_split_between_funds_shows_each_funds_share(): void
    {
        $user = $this->userWithRole('accountant');
        $this->book('contra', '2026-07-08', [['cash_irrigation', 300, 0], ['cash_society', 700, 0], ['cash_field', 0, 1000]], 'payment');

        $irr = $this->actingAs($user)->getJson('/api/cashbook/income-expense-book?stream=irrigation&from=2026-07-01&to=2026-07-31')->assertOk();
        $this->assertEquals(['irrigation' => 300], $irr->json('income.rows.0.cells'));
        $soc = $this->actingAs($user)->getJson('/api/cashbook/income-expense-book?stream=society&from=2026-07-01&to=2026-07-31')->assertOk();
        $this->assertEquals(['field' => 700], $soc->json('income.rows.0.cells'));
    }
}
