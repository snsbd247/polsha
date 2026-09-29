<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Asset;
use App\Models\AssetCategory;
use App\Models\BankAccount;
use App\Models\BankReconciliation;
use App\Models\CombinedPayment;
use App\Models\DayClose;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\IrrigationType;
use App\Models\JournalLine;
use App\Models\LandType;
use App\Models\Loan;
use App\Models\LoanPayment;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\QrScan;
use App\Models\Receipt;
use App\Models\Season;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\SettingService;
use Illuminate\Support\Carbon;

class Phase8Test extends Phase2TestCase
{
    private User $cashier;

    private User $accountant;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-06-30 10:00:00');
        $this->cashier = $this->userWithRole('cashier');
        $this->accountant = $this->userWithRole('accountant');
        app(LedgerService::class)->postNow('opening', '2025-12-01', 'প্রারম্ভিক নগদ', [
            ['account_id' => Account::byKey('cash_society')->id, 'debit' => 50000],
            ['account_id' => Account::byKey('opening_balance_equity')->id, 'credit' => 50000],
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function ledger(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    private function approve(?int $requestId): void
    {
        $this->assertNotNull($requestId);
        $this->actingAs($this->manager)->postJson("/api/approvals/{$requestId}/decide", ['decision' => 'approve'])->assertOk();
    }

    /**
     * A member with a running loan (instalment 1,120), one irrigation bill
     * (330) and no share yet, with the share minimum set to 1,000.
     */
    private function payer(): Farmer
    {
        $farmer = $this->makeFarmer(['name_bn' => 'করিম']);
        $member = Member::create(['farmer_id' => $farmer->id, 'member_no' => 1, 'admitted_on' => '2020-01-01', 'status' => Member::ACTIVE]);
        MemberAccount::create(['kind' => 'savings', 'member_id' => $member->id, 'account_no' => 'SAV-T1', 'opened_on' => '2020-01-01', 'balance' => 5000]);
        $guarantor = Member::create(['farmer_id' => $this->makeFarmer(['name_bn' => 'রহিম'])->id, 'member_no' => 2, 'admitted_on' => '2020-01-01', 'status' => Member::ACTIVE]);
        SettingService::setMany(['share_min_amount' => 1000]);

        // loan: 12,000 flat 12% over 12 months, disbursed 1 May → first instalment 1 June
        $loanOfficer = $this->userWithRole('loan_officer');
        $p = $this->actingAs($this->manager)->postJson('/api/loan-products', [
            'code' => 'AG-1', 'name_bn' => 'কৃষি ঋণ', 'category' => 'agriculture', 'max_amount' => 50000, 'savings_multiplier' => 3,
            'interest_rate' => 12, 'interest_method' => 'flat', 'frequency' => 'monthly', 'installments' => 12,
            'penalty_rate' => 0, 'grace_days' => 5, 'guarantors_required' => 1, 'is_active' => true,
        ])->assertCreated();
        $r = $this->actingAs($loanOfficer)->postJson('/api/loans', [
            'member_id' => $member->id, 'product_id' => $p->json('id'), 'applied_on' => '2026-04-20', 'amount' => 12000,
            'guarantors' => [['member_id' => $guarantor->id]],
        ])->assertCreated();
        $loan = Loan::findOrFail($r->json('id'));
        $this->approve($loan->approval_request_id);
        $this->actingAs($loanOfficer)->postJson("/api/loans/{$loan->id}/disburse", ['date' => '2026-05-01', 'method' => 'cash'])->assertOk();

        // irrigation: one bigha (33 decimals) at 10 Tk = 330
        $irr = $this->userWithRole('irrigation_officer');
        $deep = IrrigationType::where('name_bn', 'গভীর নলকূপ')->firstOrFail();
        $season = Season::findOrFail($this->actingAs($irr)->postJson('/api/seasons', [
            'name_bn' => 'বোরো ২০২৬', 'code' => 'BORO26', 'type' => 'rabi', 'crop' => 'ধান', 'start_date' => '2026-05-01', 'end_date' => '2026-09-30', 'status' => 'open',
        ])->assertCreated()->json('id'));
        $rate = $this->actingAs($irr)->postJson('/api/irrigation-rates', [
            'season_id' => $season->id, 'irrigation_type_id' => $deep->id, 'rate' => 10, 'effective_from' => '2026-05-01',
        ])->assertCreated();
        $this->approve($rate->json('approval_request_id'));
        $land = $this->actingAs($irr)->postJson('/api/lands', [
            'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '১৪৫', 'dag_no' => '101',
            'area' => 1, 'area_unit' => 'bigha', 'land_type_id' => LandType::first()->id, 'status' => 'cultivated', 'irrigation_type_id' => $deep->id,
            'owners' => [['farmer_id' => $farmer->id, 'share_percent' => 100]], 'owned_since' => '2015-01-01',
            'cultivation' => ['farmer_id' => $farmer->id, 'type' => 'own', 'start_date' => '2024-01-01'],
        ])->assertCreated();
        $this->actingAs($irr)->postJson('/api/invoices', ['season_id' => $season->id, 'land_id' => $land->json('id'), 'invoice_date' => '2026-06-01'])->assertCreated();

        return $farmer;
    }

    public function test_one_payment_splits_across_loan_irrigation_share_and_savings(): void
    {
        $farmer = $this->payer();
        $q = $this->actingAs($this->cashier)->getJson("/api/combined-payments/quote?farmer_id={$farmer->id}&amount=3000")->assertOk();
        $this->assertSame(['loan', 'irrigation', 'share'], $q->json('order'));
        $this->assertEquals(1120, $q->json('loan.due_now'));
        $this->assertEquals(330, $q->json('irrigation.due'));
        $this->assertEquals(1000, $q->json('share.due'));
        $this->assertEquals(['loan' => 1120, 'irrigation' => 330, 'share' => 1000, 'savings' => 550], $q->json('allocation.parts'));

        // the configured order decides who gets paid when money is short
        SettingService::setMany(['combined_payment_order' => ['irrigation', 'share', 'loan']]);
        $short = $this->actingAs($this->cashier)->getJson("/api/combined-payments/quote?farmer_id={$farmer->id}&amount=1000")->json('allocation.parts');
        $this->assertEquals(['loan' => 0, 'irrigation' => 330, 'share' => 670, 'savings' => 0], $short);
        SettingService::setMany(['combined_payment_order' => ['loan', 'irrigation', 'share']]);

        // a manual split must add up and respect each module's limit
        $base = ['farmer_id' => $farmer->id, 'date' => '2026-06-30', 'amount' => 3000, 'method' => 'cash'];
        $this->actingAs($this->cashier)->postJson('/api/combined-payments', $base + ['parts' => ['loan' => 1000, 'irrigation' => 330, 'share' => 1000, 'savings' => 500]])
            ->assertStatus(422)->assertJsonValidationErrors('parts');
        $this->actingAs($this->cashier)->postJson('/api/combined-payments', $base + ['parts' => ['loan' => 0, 'irrigation' => 400, 'share' => 1000, 'savings' => 1600]])
            ->assertStatus(422)->assertJsonValidationErrors('parts.irrigation');

        $cashSociety = $this->ledger('cash_society');
        $cashIrrigation = $this->ledger('cash_irrigation');
        $r = $this->actingAs($this->cashier)->postJson('/api/combined-payments', $base)->assertCreated();
        $this->assertStringStartsWith('CP-2026-', $r->json('payment_no'));
        $cp = CombinedPayment::with('parts')->findOrFail($r->json('id'));
        $this->assertEquals(['loan' => 1120, 'irrigation' => 330, 'share' => 1000, 'savings' => 550], $cp->parts->pluck('amount', 'module')->map(fn ($v) => (float) $v)->all());

        // each module booked its own part
        $this->assertSame(1, LoanPayment::where('status', 'posted')->count());
        $this->assertSame('paid', Invoice::first()->status);
        $member = Member::where('farmer_id', $farmer->id)->first();
        $this->assertEquals(1000, MemberAccount::where('member_id', $member->id)->where('kind', 'share')->value('balance'));
        $this->assertEquals(5550, MemberAccount::where('member_id', $member->id)->where('kind', 'savings')->value('balance'));
        $this->assertEquals($cashSociety + 2670, $this->ledger('cash_society'));
        $this->assertEquals($cashIrrigation + 330, $this->ledger('cash_irrigation'));

        // a part cannot be cancelled on its own
        $receipt = Receipt::where('farmer_id', $farmer->id)->firstOrFail();
        $this->actingAs($this->cashier)->postJson("/api/receipts/{$receipt->id}/cancel", ['reason' => 'ভুল'])->assertStatus(422);

        $show = $this->actingAs($this->cashier)->getJson("/api/combined-payments/{$cp->id}")->assertOk();
        $this->assertCount(4, $show->json('parts'));
        $this->getJson('/api/public/combined-receipts/'.$show->json('verify_token'))->assertOk()->assertJsonPath('amount', 3000);

        // cancelling the whole receipt reverses every part after approval
        $req = $this->actingAs($this->cashier)->postJson("/api/combined-payments/{$cp->id}/cancel", ['reason' => 'ভুল চাষি'])->assertCreated();
        $this->assertSame('cancel_pending', $cp->fresh()->status);
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', $cp->fresh()->status);
        $this->assertSame('cancelled', $receipt->fresh()->status);
        $this->assertSame(0, LoanPayment::where('status', 'posted')->count());
        $this->assertEquals(5000, MemberAccount::where('member_id', $member->id)->where('kind', 'savings')->value('balance'));
        $this->assertEquals($cashSociety, $this->ledger('cash_society'));
        $this->assertEquals($cashIrrigation, $this->ledger('cash_irrigation'));
    }

    public function test_non_member_surplus_is_rejected(): void
    {
        $farmer = $this->makeFarmer(['name_bn' => 'অসদস্য']);
        $this->actingAs($this->cashier)->postJson('/api/combined-payments', [
            'farmer_id' => $farmer->id, 'date' => '2026-06-30', 'amount' => 100, 'method' => 'cash',
        ])->assertStatus(422)->assertJsonValidationErrors('amount');
    }

    public function test_day_close_reconciles_cash_and_freezes_the_day_until_reopened(): void
    {
        $farmer = $this->payer();
        $this->actingAs($this->cashier)->postJson('/api/combined-payments', [
            'farmer_id' => $farmer->id, 'date' => '2026-06-30', 'amount' => 1450, 'method' => 'cash',
        ])->assertCreated();

        $s = $this->actingAs($this->cashier)->getJson('/api/day-closes/summary?date=2026-06-30')->assertOk();
        $streams = collect($s->json('streams'))->keyBy('key');
        $this->assertEquals(1120, $streams['cash_society']['collections']);
        $this->assertEquals(330, $streams['cash_irrigation']['collections']);
        $this->assertEquals(50000 - 12000, $streams['cash_society']['opening']);
        $this->assertEquals(50000 - 12000 + 1120, $streams['cash_society']['expected']);
        $this->assertSame(['2025-12-01', '2026-05-01'], $s->json('unclosed')); // earlier cash days never counted

        $actual = collect($s->json('streams'))->mapWithKeys(fn ($x) => [$x['account_id'] => $x['expected']])->all();
        $short = $actual;
        $short[Account::byKey('cash_irrigation')->id] = 300;
        $this->actingAs($this->cashier)->postJson('/api/day-closes', ['date' => '2026-06-30', 'actual' => $short])
            ->assertStatus(422)->assertJsonValidationErrors('note');
        $this->actingAs($this->cashier)->postJson('/api/day-closes', ['date' => '2026-06-30', 'actual' => $short, 'note' => '৩০ টাকা কম'])->assertCreated();
        $day = DayClose::firstOrFail();
        $this->assertEquals(-30, $day->difference);
        $this->assertSame('closed', $day->status);
        // the register cards count the short day
        $this->actingAs($this->cashier)->getJson('/api/day-closes')->assertOk()
            ->assertJsonPath('counts.total', 1)->assertJsonPath('counts.with_difference', 1)->assertJsonPath('counts.reopen_pending', 0);

        // the closed day (and every day before it) takes no more cash
        $this->actingAs($this->cashier)->postJson('/api/combined-payments', [
            'farmer_id' => $farmer->id, 'date' => '2026-06-29', 'amount' => 100, 'method' => 'cash',
        ])->assertStatus(422);
        $this->actingAs($this->cashier)->postJson('/api/day-closes', ['date' => '2026-06-29', 'actual' => $actual])->assertStatus(422);

        $req = $this->actingAs($this->cashier)->postJson("/api/day-closes/{$day->id}/reopen", ['reason' => 'একটি রশিদ বাদ পড়েছে'])->assertCreated();
        $this->assertSame('reopen_pending', $day->fresh()->status);
        $this->approve($req->json('id'));
        $this->assertSame('reopened', $day->fresh()->status);
        $this->actingAs($this->cashier)->postJson('/api/combined-payments', [
            'farmer_id' => $farmer->id, 'date' => '2026-06-30', 'amount' => 100, 'method' => 'cash',
        ])->assertCreated();
    }

    public function test_bank_reconciliation_matches_books_and_finalizes(): void
    {
        $bank = BankAccount::findOrFail($this->actingAs($this->accountant)->postJson('/api/bank-accounts', [
            'bank_name' => 'সোনালী ব্যাংক', 'account_no' => '1234', 'account_type' => 'current',
        ])->assertCreated()->json('id'));
        $ledger = app(LedgerService::class);
        $ledger->postNow('receipt', '2026-06-05', 'জমা', [
            ['account_id' => $bank->account_id, 'debit' => 5000], ['account_id' => Account::byKey('general_fund')->id, 'credit' => 5000]]);
        $ledger->postNow('payment', '2026-06-20', 'চেক (এখনো ভাঙানো হয়নি)', [
            ['account_id' => Account::byKey('office_expense')->id, 'debit' => 1000], ['account_id' => $bank->account_id, 'credit' => 1000]]);

        $rec = BankReconciliation::findOrFail($this->actingAs($this->accountant)->postJson('/api/bank-reconciliations', [
            'bank_account_id' => $bank->id, 'period' => '2026-06', 'statement_opening' => 0, 'statement_closing' => 4950,
        ])->assertCreated()->json('id'));
        $this->actingAs($this->accountant)->postJson("/api/bank-reconciliations/{$rec->id}/lines", ['lines' => [
            ['date' => '2026-07-01', 'amount' => 10],
        ]])->assertStatus(422);
        $v = $this->actingAs($this->accountant)->postJson("/api/bank-reconciliations/{$rec->id}/lines", ['lines' => [
            ['date' => '2026-06-07', 'description' => 'Deposit', 'amount' => 5000],
            ['date' => '2026-06-28', 'description' => 'Service charge', 'amount' => -50],
        ]])->assertOk();
        $this->assertEquals(4000, $v->json('totals.book_closing'));

        $m = $this->actingAs($this->accountant)->postJson("/api/bank-reconciliations/{$rec->id}/auto-match")->assertOk();
        $this->assertSame(1, $m->json('matched'));
        $this->assertNotNull(JournalLine::where('account_id', $bank->account_id)->where('debit', 5000)->value('reconciled_at'));
        // the ticked line can no longer be unticked from the old statement screen
        $matched = JournalLine::where('account_id', $bank->account_id)->where('debit', 5000)->firstOrFail();
        $this->actingAs($this->accountant)->postJson("/api/bank-accounts/{$bank->id}/lines/{$matched->id}/reconcile", ['reconciled' => false])->assertStatus(422);

        // book the service charge straight from the statement line
        $charge = collect($m->json('lines'))->firstWhere('amount', '-50.00');
        $v = $this->actingAs($this->accountant)->postJson("/api/bank-reconciliations/{$rec->id}/lines/{$charge['id']}/book", [
            'account_id' => Account::byKey('bank_charges')->id,
        ])->assertOk();
        $this->assertEquals(3950, $v->json('totals.book_closing'));
        $this->assertEquals(-1000, $v->json('totals.unmatched_book')); // cheque not yet presented
        $this->assertEquals(0, $v->json('totals.difference'));
        $this->assertEquals(50, $this->ledger('bank_charges'));

        $this->actingAs($this->accountant)->postJson("/api/bank-reconciliations/{$rec->id}/finalize")->assertOk()
            ->assertJsonPath('reconciliation.status', 'finalized');
        $this->actingAs($this->accountant)->deleteJson("/api/bank-reconciliations/{$rec->id}")->assertStatus(422);
    }

    public function test_asset_purchase_depreciation_and_sale(): void
    {
        $officer = $this->userWithRole('asset_officer');
        $pump = AssetCategory::where('code', 'PUMP')->firstOrFail();
        $r = $this->actingAs($officer)->postJson('/api/assets', [
            'name_bn' => 'সেচ পাম্প', 'category_id' => $pump->id, 'purchase_date' => '2026-01-15', 'cost' => 12000,
            'salvage_value' => 0, 'acquisition' => 'purchase', 'method' => 'cash', 'location' => 'অফিস',
        ])->assertCreated();
        $asset = Asset::findOrFail($r->json('id'));
        $this->assertSame(120, $asset->life_months);
        $this->assertEquals(100, $asset->monthlyCharge());
        $this->assertEquals(12000, $this->ledger('fixed_assets'));

        $this->actingAs($officer)->postJson("/api/assets/{$asset->id}/movements", ['type' => 'install', 'date' => '2026-02-01', 'to_location' => 'মাঠ ১'])->assertOk()
            ->assertJsonPath('status', 'installed');
        $this->actingAs($officer)->postJson('/api/assets/depreciation', ['period' => '2026-07'])->assertStatus(422);
        $runs = $this->actingAs($officer)->postJson('/api/assets/depreciation', ['period' => '2026-05'])->assertOk()->json('runs');
        $this->assertCount(5, $runs); // January to May, caught up in order
        $this->assertEquals(500, $asset->fresh()->accumulated_depreciation);
        $this->assertEquals(500, $this->ledger('depreciation_expense'));
        $this->assertEquals([], $this->actingAs($officer)->postJson('/api/assets/depreciation', ['period' => '2026-05'])->json('runs'));

        // repair expense + next service booked automatically
        $job = $this->actingAs($officer)->postJson("/api/assets/{$asset->id}/maintenances", ['kind' => 'service', 'title' => 'তেল বদল', 'due_on' => '2026-06-10', 'repeat_months' => 6])->assertCreated();
        $this->actingAs($officer)->postJson("/api/assets/maintenances/{$job->json('id')}/complete", ['done_on' => '2026-06-10', 'cost' => 300, 'method' => 'cash'])->assertOk();
        $this->assertEquals(300, $this->ledger('asset_repair_expense'));
        $this->assertSame('2026-12-10', $asset->maintenances()->where('status', 'scheduled')->value('due_on')->toDateString());

        // dashboard + movement log feed the asset menu screens
        $dash = $this->actingAs($officer)->getJson('/api/assets/dashboard')->assertOk();
        $this->assertSame(1, $dash->json('totals.count'));
        $this->assertEquals(11500, $dash->json('totals.book_value'));
        $this->assertSame(1, collect($dash->json('by_status'))->firstWhere('status', 'installed')['count']);
        $this->assertSame('2026-05', $dash->json('last_depreciation'));
        $this->actingAs($officer)->getJson('/api/assets/movements?types=install,uninstall')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.to_location', 'মাঠ ১');

        // sale for 11,000 with book value 11,500 → loss 500, after approval
        $cash = $this->ledger('cash_society');
        $req = $this->actingAs($officer)->postJson("/api/assets/{$asset->id}/dispose", [
            'type' => 'sale', 'date' => '2026-06-30', 'price' => 11000, 'method' => 'cash', 'reason' => 'নতুন পাম্প কেনা হবে',
        ])->assertCreated();
        $this->assertSame('disposal_pending', $asset->fresh()->status);
        $this->actingAs($officer)->postJson("/api/assets/{$asset->id}/movements", ['type' => 'uninstall', 'date' => '2026-06-30'])->assertStatus(422);
        $this->approve($req->json('id'));
        $this->assertSame('sold', $asset->fresh()->status);
        $this->actingAs($officer)->getJson('/api/assets?status=disposal')->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($officer)->getJson('/api/assets?status=active')->assertOk()->assertJsonCount(0, 'data');
        $this->assertEquals(0, $this->ledger('fixed_assets'));
        $this->assertEquals(0, $this->ledger('accumulated_depreciation'));
        $this->assertEquals(500, $this->ledger('asset_disposal_loss'));
        $this->assertEquals($cash + 11000, $this->ledger('cash_society'));
        $this->assertSame(0, $asset->maintenances()->where('status', 'scheduled')->count());
    }

    public function test_qr_codes_resolve_after_login_and_are_logged(): void
    {
        $farmer = $this->makeFarmer();
        $this->postJson('/api/qr/resolve', ['type' => 'farmer', 'code' => $farmer->farmer_code])->assertUnauthorized();
        $this->actingAs($this->cashier)->postJson('/api/qr/resolve', ['type' => 'farmer', 'code' => $farmer->farmer_code, 'source' => 'camera'])
            ->assertOk()->assertJsonPath('path', "/farmers/{$farmer->id}")->assertJsonPath('allowed', true);
        $this->actingAs($this->cashier)->postJson('/api/qr/resolve', ['type' => 'land', 'code' => 'NOPE'])->assertNotFound();
        $this->assertSame(2, QrScan::where('user_id', $this->cashier->id)->count());
        $this->assertFalse(QrScan::latest('id')->first()->found);
        $this->actingAs($this->cashier)->getJson('/api/qr/history')->assertOk()->assertJsonCount(2, 'data');
        $this->actingAs($this->manager)->getJson('/api/qr/history?all=1')->assertOk()->assertJsonCount(2, 'data');
    }
}
