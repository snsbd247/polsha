<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\BankAccount;
use App\Models\IrrigationRate;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Season;
use App\Models\StatementHead;
use App\Services\LedgerService;

/** Receipts & payments statements (জমা-খরচ বিবরণী): heads in order, month beside year, opening and cash in hand. */
class ReceiptPaymentStatementTest extends Phase2TestCase
{
    private function book(string $type, string $date, array $lines, string $module = 'accounting')
    {
        return app(LedgerService::class)->postNow($type, $date, 'পরীক্ষা', array_map(fn ($l) => ['account_id' => is_int($l[0]) ? $l[0] : Account::byKey($l[0])->id, 'debit' => $l[1], 'credit' => $l[2]], $lines), $module);
    }

    private function row(array $rows, string $label): ?array
    {
        return collect($rows)->firstWhere('label', $label);
    }

    public function test_society_statement_has_every_head_month_beside_year_and_balances(): void
    {
        $user = $this->userWithRole('accountant');
        $bank = Account::create(['code' => '1298', 'name_bn' => 'ব্যাংক', 'type' => 'asset', 'is_postable' => true, 'is_active' => true]);
        BankAccount::create(['account_id' => $bank->id, 'bank_name' => 'রূপালী', 'account_no' => '3665', 'account_type' => 'savings']);
        $sherestha = Account::where('name_bn', 'সেরেস্তা খরচ')->value('id');
        $this->assertNotNull($sherestha, 'heads from the paper statement have accounts');

        $this->book('opening', '2026-06-01', [['cash_society', 2000, 0], ['opening_balance_equity', 0, 2000]]);
        // July (earlier in the financial year)
        $this->book('receipt', '2026-07-03', [['cash_society', 800, 0], ['savings_deposits', 0, 800]], 'savings');
        $this->book('receipt', '2026-07-04', [['cash_society', 500, 0], ['share_capital', 0, 500]], 'share');
        $this->book('payment', '2026-07-05', [['office_expense', 300, 0], ['cash_society', 0, 300]], 'cash');
        $this->book('contra', '2026-07-06', [[$bank->id, 1000, 0], ['cash_society', 0, 1000]], 'bank');
        $this->book('payment', '2026-07-07', [[$sherestha, 50, 0], ['cash_society', 0, 50]], 'cash');
        // August (the month shown)
        $this->book('receipt', '2026-08-02', [['cash_society', 200, 0], ['savings_deposits', 0, 200]], 'savings');
        $this->book('payment', '2026-08-03', [['savings_deposits', 100, 0], ['cash_society', 0, 100]], 'savings');
        $share = $this->book('receipt', '2026-08-04', [['cash_society', 500, 0], ['share_capital', 0, 500]], 'share');
        app(LedgerService::class)->reverse($share, 'ভুল');
        // money moved between the society's own cash accounts is not a line
        $this->book('contra', '2026-08-05', [['cash_misc', 70, 0], ['cash_society', 0, 70]], 'cash');

        $r = $this->actingAs($user)->getJson('/api/cashbook/receipt-payment?fund=society&month=2026-08')->assertOk();
        $this->assertSame('2026-2027', $r->json('fiscal_year'));
        $this->assertSame('2026-07-01', $r->json('year_from'));
        $receipts = $r->json('receipts');
        $payments = $r->json('payments');
        // every head prints, in the paper's order, money or not
        $this->assertSame('শেয়ার আদায়', $receipts[0]['label']);
        $this->assertSame('সঞ্চয় আদায়', $receipts[1]['label']);
        $this->assertGreaterThanOrEqual(StatementHead::where('fund', 'society')->where('side', 'receipt')->count(), count($receipts));

        $this->assertEquals(200, $this->row($receipts, 'সঞ্চয় আদায়')['month']);
        $this->assertEquals(1000, $this->row($receipts, 'সঞ্চয় আদায়')['year']);
        $this->assertEquals(500, $this->row($receipts, 'শেয়ার আদায়')['month']);  // cancelled later, so still here in August
        $this->assertEquals(1000, $this->row($receipts, 'শেয়ার আদায়')['year']);
        $this->assertEquals(100, $this->row($payments, 'সঞ্চয় ফেরত')['month']);
        $this->assertEquals(50, $this->row($payments, 'সেরেস্তা খরচ')['year']);
        $this->assertEquals(300, $this->row($payments, 'অফিস খরচ')['year']);
        $this->assertEquals(1000, $this->row($payments, 'ব্যাংক জমা/3665')['year']); // a bank with no head of its own
        $this->assertNull($this->row($payments, 'বিবিধ নগদ'));

        $t = $r->json('totals');
        $this->assertEquals(2000, $t['year']['opening']);
        $this->assertEquals(1950, $t['month']['opening']);
        $this->assertEquals(2550, $t['year']['closing']);
        $this->assertEquals(2550, $t['month']['closing']);   // cash in hand is the same at the end of either column
        $this->assertEquals($t['year']['grand'], $t['year']['payments'] + $t['year']['closing']);

        // the cancellation takes the share collection back off in the month it happened
        $now = $this->actingAs($user)->getJson('/api/cashbook/receipt-payment?fund=society&month='.now()->format('Y-m'))->assertOk();
        $this->assertEquals(-500, $this->row($now->json('receipts'), 'শেয়ার আদায়')['month']);
        $this->assertNull($this->row($now->json('payments'), 'শেয়ার ফেরত')['month'] ?: null);
    }

    public function test_heads_can_be_renamed_mapped_reordered_and_an_account_belongs_to_one_head(): void
    {
        $accountant = $this->userWithRole('accountant');
        $admin = $accountant; // heads are kept by whoever keeps the accounts
        $heads = $this->actingAs($accountant)->getJson('/api/statement-heads?fund=water')->assertOk()->json('heads');
        $this->assertNotEmpty($heads);

        $income = Account::byKey('other_income')->id;
        $id = $this->actingAs($admin)->postJson('/api/statement-heads', ['fund' => 'water', 'side' => 'receipt', 'name_bn' => 'নতুন খাত', 'account_ids' => [$income]])
            ->assertCreated()->json('id');
        // the same account can't be under a second head of the same side
        $this->actingAs($admin)->postJson('/api/statement-heads', ['fund' => 'water', 'side' => 'receipt', 'name_bn' => 'আরেক খাত', 'account_ids' => [$income]])
            ->assertUnprocessable();
        $this->actingAs($admin)->putJson("/api/statement-heads/{$id}", ['name_bn' => 'বিবিধ আয়', 'account_ids' => [$income]])->assertOk();

        $ids = StatementHead::where('fund', 'water')->where('side', 'receipt')->orderBy('sort_order')->pluck('id')->all();
        $this->actingAs($admin)->postJson('/api/statement-heads/reorder', ['ids' => array_merge([$id], array_diff($ids, [$id]))])->assertOk();

        $this->book('receipt', '2026-08-02', [['cash_water', 75, 0], ['other_income', 0, 75]], 'water');
        $receipts = $this->actingAs($accountant)->getJson('/api/cashbook/receipt-payment?fund=water&month=2026-08')->assertOk()->json('receipts');
        $this->assertSame('বিবিধ আয়', $receipts[0]['label']);
        $this->assertEquals(75, $receipts[0]['month']);
    }

    public function test_at_a_glance_counts_members_by_gender_and_keeps_the_hand_entered_facts(): void
    {
        $admin = $this->userWithRole('admin');
        $this->actingAs($admin)->putJson('/api/reports-at-a-glance/info', ['project_name' => 'পলশা মহেষপুর সেচ উপ-প্রকল্প', 'sp_no' => '২৫২৪১', 'command_area' => '৫৩৩'])
            ->assertOk()->assertJsonPath('info.sp_no', '২৫২৪১');
        $this->actingAs($this->userWithRole('accountant'))->putJson('/api/reports-at-a-glance/info', ['sp_no' => '১'])->assertForbidden();

        $men = $this->makeFarmer(['gender' => 'male']);
        $woman = $this->makeFarmer(['gender' => 'female']);
        \App\Models\Member::create(['farmer_id' => $men->id, 'member_no' => 9001, 'admitted_on' => now()->subYear()->toDateString(), 'status' => 'active']);
        \App\Models\Member::create(['farmer_id' => $woman->id, 'member_no' => 9002, 'admitted_on' => now()->toDateString(), 'status' => 'active']);
        $bank = Account::create(['code' => '1297', 'name_bn' => 'রূপালী ব্যাংক', 'type' => 'asset', 'is_postable' => true, 'is_active' => true]);
        BankAccount::create(['account_id' => $bank->id, 'bank_name' => 'রূপালী ব্যাংক', 'branch_name' => 'নয়াগোলা', 'account_no' => '4401', 'account_type' => 'savings']);
        $this->book('opening', now()->subMonth()->toDateString(), [[$bank->id, 8470308, 0], ['opening_balance_equity', 0, 8470308]]);

        $r = $this->actingAs($admin)->getJson('/api/reports-at-a-glance?date='.now()->toDateString())->assertOk();
        $this->assertSame('পলশা মহেষপুর সেচ উপ-প্রকল্প', $r->json('info.project_name'));
        $this->assertEquals(['male' => 1, 'female' => 1, 'total' => 2], $r->json('members'));
        $this->assertEquals(['male' => 0, 'female' => 1, 'total' => 1], $r->json('new_members'));
        $this->assertSame('রূপালী ব্যাংক, নয়াগোলা', $r->json('banks.0.bank'));
        $this->assertEquals(8470308, $r->json('banks.0.accounts.0.balance'));
        $this->assertEquals(0, $r->json('loans.outstanding'));
    }

    public function test_irrigation_collections_split_by_season(): void
    {
        $officer = $this->userWithRole('irrigation_officer');
        $deep = IrrigationType::where('name_bn', 'গভীর নলকূপ')->firstOrFail();
        $farmer = $this->makeFarmer();
        $land = function (string $dag) use ($officer, $deep, $farmer) {
            return Land::findOrFail($this->actingAs($officer)->postJson('/api/lands', [
                'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '১', 'dag_no' => $dag, 'area' => 10, 'area_unit' => 'decimal',
                'land_type_id' => LandType::first()->id, 'status' => 'cultivated', 'irrigation_type_id' => $deep->id,
                'owners' => [['farmer_id' => $farmer->id, 'share_percent' => 100]], 'owned_since' => '2015-01-01',
                'cultivation' => ['farmer_id' => $farmer->id, 'type' => 'own', 'start_date' => '2024-01-01'],
            ])->assertCreated()->json('id'));
        };
        $season = function (string $name, string $code) use ($officer, $deep) {
            $s = Season::findOrFail($this->actingAs($officer)->postJson('/api/seasons', [
                'name_bn' => $name, 'code' => $code, 'type' => 'rabi', 'crop' => 'ধান', 'start_date' => now()->subMonths(2)->toDateString(),
                'end_date' => now()->addMonth()->toDateString(), 'status' => 'open',
            ])->assertCreated()->json('id'));
            $rate = IrrigationRate::findOrFail($this->actingAs($officer)->postJson('/api/irrigation-rates', [
                'season_id' => $s->id, 'irrigation_type_id' => $deep->id, 'rate' => 10, 'effective_from' => now()->subMonths(2)->toDateString(),
            ])->assertCreated()->json('id'));
            $this->actingAs($this->manager)->postJson("/api/approvals/{$rate->approval_request_id}/decide", ['decision' => 'approve'])->assertOk();

            return $s;
        };
        $boro = $season('বোরো ২০২৬', 'B26');
        $aman = $season('আমন ২০২৬', 'A26');
        $inv = fn (Season $s, Land $l) => $this->actingAs($officer)->postJson('/api/invoices', ['season_id' => $s->id, 'land_id' => $l->id, 'invoice_date' => now()->toDateString()])->assertCreated()->json('id');
        $a = $inv($boro, $land('১'));
        $b = $inv($aman, $land('২'));

        // one receipt paying both seasons' bills
        $this->actingAs($officer)->postJson('/api/receipts', [
            'farmer_id' => $farmer->id, 'date' => now()->toDateString(), 'method' => 'cash',
            'items' => [['invoice_id' => $a, 'amount' => 100], ['invoice_id' => $b, 'amount' => 60]],
        ])->assertCreated();

        $receipts = $this->actingAs($this->userWithRole('accountant'))->getJson('/api/cashbook/receipt-payment?fund=irrigation&month='.now()->format('Y-m'))->assertOk()->json('receipts');
        $this->assertEquals(100, $this->row($receipts, 'বোরো ২০২৬')['month']);
        $this->assertEquals(60, $this->row($receipts, 'আমন ২০২৬')['month']);
        $this->assertNull($this->row($receipts, 'সেচ চার্জ আদায় (মৌসুম অনুযায়ী)'));
        $this->assertSame('অনুদান আদায়', $receipts[0]['label']);
    }
}
