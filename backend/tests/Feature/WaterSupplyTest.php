<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\BankAccount;
use App\Models\CombinedPaymentPart;
use App\Models\ImportBatch;
use App\Models\SmsLog;
use App\Models\PublicPaymentRequest;
use App\Models\Receipt;
use App\Models\User;
use App\Models\WaterBill;
use App\Models\WaterConnection;
use App\Models\WaterConnectionType;
use App\Services\LedgerService;
use App\Services\SettingService;
use App\Services\SmsService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class WaterSupplyTest extends Phase2TestCase
{
    private User $waterUser;

    private WaterConnectionType $home;

    protected function setUp(): void
    {
        parent::setUp();
        $this->waterUser = $this->userWithRole('water_officer');
        $this->home = WaterConnectionType::where('code', 'RES')->firstOrFail();
        // the society sets its tariff first
        $this->actingAs($this->manager)->putJson("/api/water/types/{$this->home->id}", [
            'code' => 'RES', 'name_bn' => 'আবাসিক', 'name_en' => 'Residential', 'monthly_fee' => 200, 'connection_fee' => 1000, 'is_active' => true,
        ])->assertOk();
    }

    private function balance(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    private function approve(int $requestId): void
    {
        $this->actingAs($this->manager)->postJson("/api/approvals/{$requestId}/decide", ['decision' => 'approve'])->assertOk();
    }

    private function connect(array $overrides = []): WaterConnection
    {
        $r = $this->actingAs($this->waterUser)->postJson('/api/water/connections', $overrides + [
            'type_id' => $this->home->id, 'name_bn' => 'রহিম উদ্দিন', 'father_name' => 'করিম উদ্দিন', 'mobile' => '০১৭১১০০০০০১',
            'village_id' => $this->village->id, 'address' => 'উত্তর পাড়া', 'connected_on' => now()->subMonths(2)->toDateString(),
        ])->assertCreated();

        return WaterConnection::findOrFail($r->json('id'));
    }

    public function test_tariff_is_changed_only_by_water_admins(): void
    {
        $this->actingAs($this->waterUser)->putJson("/api/water/types/{$this->home->id}", [
            'code' => 'RES', 'name_bn' => 'আবাসিক', 'monthly_fee' => 1, 'connection_fee' => 0,
        ])->assertForbidden();
        $this->actingAs($this->userWithRole('loan_officer'))->getJson('/api/water/connections')->assertForbidden();
    }

    public function test_connection_with_fee_then_monthly_bills_for_everyone_billable(): void
    {
        $c = $this->connect(['connection_fee' => 1000]);
        $this->assertSame('01711000001', $c->mobile);
        $this->assertMatchesRegularExpression('/^WC-\d{6}$/', $c->connection_no);
        // the connection fee is a bill of its own, income straight away
        $this->assertSame(1000.0, $this->balance('water_receivable'));
        $this->assertSame(-1000.0, $this->balance('water_connection_fee_income'));

        // a special fee for one connection; another type without a fee yet is listed apart
        $shop = WaterConnectionType::where('code', 'COM')->firstOrFail();
        $this->connect(['name_bn' => 'দোকান', 'mobile' => null, 'monthly_fee' => 350]);
        $this->connect(['name_bn' => 'মাদ্রাসা', 'mobile' => null, 'type_id' => $shop->id]);
        // connected after the month → not billed for it
        $this->connect(['name_bn' => 'নতুন', 'mobile' => null, 'connected_on' => now()->toDateString()]);

        $period = now()->subMonth()->format('Y-m');
        $this->actingAs($this->waterUser)->getJson("/api/water/billing/preview?period=$period")->assertOk()
            ->assertJsonPath('count', 2)->assertJsonPath('total', 550)->assertJsonCount(1, 'no_fee');
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => $period, 'bill_date' => now()->toDateString()])
            ->assertCreated()->assertJsonPath('count', 2);
        // twice for the same month is not possible
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => $period, 'bill_date' => now()->toDateString()])->assertStatus(422);

        $this->assertSame(1550.0, $this->balance('water_receivable'));
        $this->assertSame(-550.0, $this->balance('water_income'));
        $this->actingAs($this->waterUser)->getJson("/api/water/bills?period=$period")->assertOk()
            ->assertJsonPath('totals.count', 2)->assertJsonPath('totals.due', 550);

        // the list's summary cards: connections that owe, and what was billed this month
        $this->actingAs($this->waterUser)->getJson('/api/water/connections-summary')->assertOk()
            ->assertJsonPath('total', 4)->assertJsonPath('owing', 2)
            ->assertJsonPath('billed_this_month', 550)->assertJsonPath('billed_last_month', 0);
        // ticked rows only, and search by address
        $this->actingAs($this->waterUser)->getJson("/api/water/connections?ids={$c->id}")->assertOk()->assertJsonPath('total', 1);
        $this->actingAs($this->waterUser)->getJson('/api/water/connections?search=উত্তর')->assertOk()->assertJsonPath('total', 4);

        // the monthly bills page: cards count the whole month, the status filter narrows the list
        $this->actingAs($this->waterUser)->getJson("/api/water/bills?period=$period&kind=monthly")->assertOk()
            ->assertJsonPath('cards.total', 2)->assertJsonPath('cards.paid', 0)->assertJsonPath('cards.pending', 2)
            ->assertJsonPath('cards.overdue', 0)->assertJsonPath('cards.amount', 550);
        WaterBill::where('period', $period)->update(['due_date' => now()->subDay()->toDateString()]);
        $this->actingAs($this->waterUser)->getJson("/api/water/bills?period=$period&kind=monthly&status=overdue")->assertOk()
            ->assertJsonPath('total', 2)->assertJsonPath('cards.overdue', 2)->assertJsonPath('cards.pending', 0);
        $this->actingAs($this->waterUser)->getJson("/api/water/bills?period=$period&kind=monthly&status=pending")->assertOk()->assertJsonPath('total', 0);
    }

    public function test_collection_with_penalty_lands_in_water_cash_and_cancel_undoes_it(): void
    {
        $c = $this->connect();
        $period = now()->subMonth()->format('Y-m');
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => $period, 'bill_date' => now()->toDateString()])->assertCreated();
        $bill = WaterBill::where('connection_id', $c->id)->firstOrFail();

        $dues = $this->actingAs($this->waterUser)->getJson("/api/water/connections/{$c->id}/dues")->assertOk()->assertJsonPath('total_due', 200)
            // the type's fee, not 0 (the type used to come without it)
            ->assertJsonPath('connection.fee', 200);
        $this->actingAs($this->waterUser)->getJson('/api/water/dues')->assertOk()->assertJsonPath('totals.connections', 1)->assertJsonPath('totals.long_due', 0);
        $r = $this->actingAs($this->waterUser)->postJson('/api/water/collect', [
            'connection_id' => $c->id, 'date' => now()->toDateString(), 'method' => 'cash', 'penalty' => 20,
            'items' => [['bill_id' => $dues->json('bills.0.id'), 'amount' => 200]],
        ])->assertCreated()->assertJsonPath('amount', 220);

        $this->assertSame('paid', $bill->fresh()->status);
        $this->assertEquals(20, $bill->fresh()->penalty);
        $this->assertSame(220.0, $this->balance('cash_water'));
        $this->assertSame(0.0, $this->balance('water_receivable'));
        $this->assertSame(-20.0, $this->balance('water_penalty_income'));
        // not mixed into the irrigation receipt screens
        $this->actingAs($this->manager)->getJson('/api/receipts')->assertOk()->assertJsonPath('total', 0);
        $this->actingAs($this->waterUser)->getJson('/api/water/receipts')->assertOk()
            ->assertJsonPath('cards.count', 1)->assertJsonPath('cards.amount', 220)->assertJsonPath('cards.today', 220)->assertJsonPath('cards.cancelled', 0);
        $this->actingAs($this->waterUser)->get('/api/water/receipts?export=csv&ids='.$r->json('id'))->assertOk();
        $this->actingAs($this->waterUser)->getJson("/api/water/receipts/{$r->json('id')}")->assertOk()
            ->assertJsonPath('penalty', 20)->assertJsonPath('connection.connection_no', $c->connection_no);

        // more than is due is refused
        $this->actingAs($this->waterUser)->postJson('/api/water/collect', [
            'connection_id' => $c->id, 'date' => now()->toDateString(), 'method' => 'cash', 'items' => [['bill_id' => $bill->id, 'amount' => 1]],
        ])->assertStatus(422);

        // cancelling the receipt gives back the bill and takes the penalty off again
        $req = $this->actingAs($this->waterUser)->postJson("/api/water/receipts/{$r->json('id')}/cancel", ['reason' => 'ভুল গ্রাহক'])->assertCreated();
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', Receipt::find($r->json('id'))->status);
        $bill->refresh();
        $this->assertSame('unpaid', $bill->status);
        $this->assertEquals(0, $bill->penalty);
        $this->assertSame(0.0, $this->balance('cash_water'));
        $this->assertSame(0.0, $this->balance('water_penalty_income'));
        $this->assertSame(200.0, $this->balance('water_receivable'));
    }

    public function test_unpaid_bill_is_cancelled_after_approval_and_close_needs_no_dues(): void
    {
        $c = $this->connect();
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => now()->subMonth()->format('Y-m'), 'bill_date' => now()->toDateString()])->assertCreated();
        $bill = WaterBill::where('connection_id', $c->id)->firstOrFail();

        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'close', 'date' => now()->toDateString(), 'reason' => 'বাড়ি বিক্রি'])
            ->assertStatus(422);

        $req = $this->actingAs($this->waterUser)->postJson("/api/water/bills/{$bill->id}/cancel", ['reason' => 'ভুল বিল'])->assertCreated();
        $this->assertSame('unpaid', $bill->fresh()->status);
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', $bill->fresh()->status);
        $this->assertSame(0.0, $this->balance('water_receivable'));
        $this->assertSame(0.0, $this->balance('water_income'));

        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'close', 'date' => now()->toDateString(), 'reason' => 'বাড়ি বিক্রি'])
            ->assertOk()->assertJsonPath('status', 'closed');
    }

    public function test_a_farmers_water_bills_are_taken_in_the_combined_payment(): void
    {
        $farmer = $this->makeFarmer(['name_bn' => 'রহিম উদ্দিন']);
        $c = $this->connect(['farmer_id' => $farmer->id]);
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => now()->subMonth()->format('Y-m'), 'bill_date' => now()->toDateString()])->assertCreated();

        $cashier = $this->userWithRole('cashier');
        $this->actingAs($cashier)->getJson("/api/combined-payments/quote?farmer_id={$farmer->id}&amount=200")->assertOk()
            ->assertJsonPath('water.due', 200)->assertJsonPath('allocation.parts.water', 200);
        // a non-member pays only dues: more than the water bill is refused
        $this->actingAs($cashier)->postJson('/api/combined-payments', ['farmer_id' => $farmer->id, 'date' => now()->toDateString(), 'amount' => 250, 'method' => 'cash'])
            ->assertUnprocessable();
        $this->actingAs($cashier)->postJson('/api/combined-payments', ['farmer_id' => $farmer->id, 'date' => now()->toDateString(), 'amount' => 200, 'method' => 'cash'])
            ->assertCreated();
        $this->assertSame(['water'], CombinedPaymentPart::pluck('module')->all());
        $this->assertSame('paid', WaterBill::where('connection_id', $c->id)->first()->status);
        $this->assertSame(200.0, $this->balance('cash_water'));
        $this->assertSame(1, Receipt::where('module', 'water')->where('farmer_id', $farmer->id)->count());
    }

    public function test_a_water_bill_paid_online_with_the_connection_number(): void
    {
        $c = $this->connect(['mobile' => '01711000002']);
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => now()->subMonth()->format('Y-m'), 'bill_date' => now()->toDateString()])->assertCreated();
        SettingService::setMany(['public_payment_enabled' => true, 'public_payment_bkash' => '01700000000']);

        $this->getJson("/api/public/payments/farmer?code={$c->connection_no}")->assertOk()->assertJsonPath('kind', 'water');
        $no = $this->postJson('/api/public/payments', ['farmer_code' => $c->connection_no, 'payer_name' => 'রহিম', 'mobile' => '01711000002',
            'method' => 'bkash', 'sender_number' => '01811000000', 'trx_id' => 'WTR12345', 'amount' => 200, 'paid_on' => now()->toDateString()])
            ->assertCreated()->json('request_no');
        $req = PublicPaymentRequest::where('request_no', $no)->firstOrFail();
        $this->assertSame($c->id, $req->water_connection_id);

        $bank = BankAccount::findOrFail($this->actingAs($this->manager)->postJson('/api/bank-accounts', [
            'bank_name' => 'বিকাশ মার্চেন্ট', 'account_no' => '01700000000', 'account_type' => 'current',
        ])->assertCreated()->json('id'));
        $cashier = $this->userWithRole('cashier');
        $this->actingAs($cashier)->getJson("/api/public-payments/{$req->id}")->assertOk()->assertJsonPath('water_dues.due', 200);
        $this->actingAs($cashier)->postJson("/api/public-payments/{$req->id}/verify", ['fund_account_id' => $bank->account_id, 'amount' => 300])->assertUnprocessable();
        $this->actingAs($cashier)->postJson("/api/public-payments/{$req->id}/verify", ['fund_account_id' => $bank->account_id])->assertOk();

        $req->refresh();
        $this->assertSame('verified', $req->status);
        $this->assertSame('paid', WaterBill::where('connection_id', $c->id)->first()->status);
        $this->assertEquals(200, app(LedgerService::class)->balance($bank->account_id));
        $this->getJson("/api/public/payments/status?request_no={$no}&mobile=01711000002")->assertJsonPath('receipt_no', $req->receipt->receipt_no);
    }

    public function test_field_collector_takes_water_and_the_office_deposit_puts_it_in_water_cash(): void
    {
        $farmer = $this->makeFarmer();
        $this->connect(['farmer_id' => $farmer->id]);
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => now()->subMonth()->format('Y-m'), 'bill_date' => now()->toDateString()])->assertCreated();
        $collector = $this->userWithRole('field_collector');
        $this->actingAs($collector)->postJson('/api/field/collect', ['farmer_id' => $farmer->id, 'amount' => 200])->assertCreated();
        $this->assertSame(200.0, $this->balance('cash_field'));
        $this->assertSame(0.0, $this->balance('cash_water'));

        $this->actingAs($this->userWithRole('cashier'))->postJson('/api/field/deposits', ['collector_id' => $collector->id, 'date' => now()->toDateString()])->assertCreated();
        $this->assertSame(0.0, $this->balance('cash_field'));
        $this->assertSame(200.0, $this->balance('cash_water'));
    }

    public function test_water_shows_in_reports_fund_statement_cash_book_and_ledger_checks(): void
    {
        $c = $this->connect();
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', ['period' => now()->subMonth()->format('Y-m'), 'bill_date' => now()->toDateString()])->assertCreated();
        $bill = WaterBill::where('connection_id', $c->id)->firstOrFail();
        $this->actingAs($this->waterUser)->postJson('/api/water/collect', [
            'connection_id' => $c->id, 'date' => now()->toDateString(), 'method' => 'cash', 'penalty' => 20, 'items' => [['bill_id' => $bill->id, 'amount' => 200]],
        ])->assertCreated();
        $range = '?from='.now()->startOfMonth()->toDateString().'&to='.now()->toDateString();

        $this->actingAs($this->manager)->getJson('/api/reports/water_billing'.$range)->assertOk()->assertJsonCount(1, 'rows')->assertJsonPath('rows.0.penalty', 20);
        $this->actingAs($this->manager)->getJson('/api/reports/water_collection'.$range)->assertOk()->assertJsonPath('rows.0.amount', 220);
        $this->actingAs($this->manager)->getJson('/api/reports/water_monthly')->assertOk()->assertJsonPath('rows.0.rate', 100);

        // the water fund's own statement: the collection is its income
        $s = $this->actingAs($this->manager)->getJson('/api/cashbook/water-statement'.$range)->assertOk()->json();
        $this->assertSame('water', $s['stream']);
        $this->assertEquals(220, collect($s['income'])->firstWhere('label', 'পানির বিল আদায় (বকেয়াসহ)')['amount']);
        $this->actingAs($this->manager)->getJson('/api/cashbook/income-expense-book'.$range.'&stream=water')->assertOk();

        // module and ledger agree; the water head is in the payment reconciliation
        $ledger = $this->actingAs($this->manager)->getJson('/api/ledger-integrity')->assertOk()->json('source_vs_ledger');
        $water = collect($ledger)->firstWhere('item', 'পানির বিল বকেয়া (অপরিশোধিত বিল, জরিমানাসহ)');
        $this->assertEquals(0, $water['difference']);

        $kpis = collect($this->actingAs($this->manager)->getJson('/api/dashboard?refresh=1')->assertOk()->json('kpis'))->keyBy('key');
        $this->assertEquals(220, $kpis['water_collection']['value']);
    }

    public function test_customers_and_old_dues_come_in_through_import_and_roll_back(): void
    {
        $csv = "\xEF\xBB\xBF".implode("\n", [
            'গ্রাহকের নাম,পিতা/স্বামী,মোবাইল,গ্রাম,পাড়া/বাড়ি,সংযোগের ধরন,সংযোগের তারিখ,পুরনো বকেয়া',
            'রহিম উদ্দিন,করিম উদ্দিন,1711223344,পলাশবাড়ী,উত্তর পাড়া,আবাসিক,০১/০৩/২০২২,"৬০০"',
            'ভুল সারি,,,,,ট্যাংকি,01/03/2022,0',
        ])."\n";
        $up = $this->actingAs($this->manager)->post('/api/imports/water_connections/upload', ['file' => UploadedFile::fake()->createWithContent('water.csv', $csv)], ['Accept' => 'application/json'])->assertOk();
        $preview = $this->actingAs($this->manager)->postJson('/api/imports/validate', ['upload_token' => $up->json('upload_token'), 'mapping' => $up->json('mapping')])
            ->assertOk()->assertJsonPath('valid', 1);
        $batch = ImportBatch::findOrFail($this->actingAs($this->manager)->postJson('/api/imports/commit', ['token' => $preview->json('token')])->assertOk()->json('id'));

        $c = WaterConnection::where('import_batch_id', $batch->id)->firstOrFail();
        $this->assertSame('01711223344', $c->mobile);
        $this->assertSame($this->village->id, $c->village_id);
        $this->assertSame('2022-03-01', $c->connected_on->toDateString());
        $this->assertSame(600.0, $this->balance('water_receivable'));
        $this->assertSame(-600.0, $this->balance('opening_balance_equity'));

        $admin = $this->userWithRole('admin');
        $r = $this->actingAs($admin)->postJson("/api/imports/{$batch->id}/rollback", ['reason' => 'ভুল ফাইল'])->assertOk();
        $this->actingAs($this->userWithRole('admin'))->postJson('/api/approvals/'.$r->json('approval.id').'/decide', ['decision' => 'approve'])->assertOk();
        $this->assertSame('closed', $c->fresh()->status);
        $this->assertSame(0.0, $this->balance('water_receivable'));
    }

    public function test_bill_sms_payment_sms_reminder_and_penalty_waiver(): void
    {
        $c = $this->connect();
        $this->actingAs($this->waterUser)->postJson('/api/water/billing', [
            'period' => now()->format('Y-m'), 'bill_date' => now()->toDateString(), 'due_date' => now()->addDays(3)->toDateString(),
        ])->assertCreated();
        $this->assertSame(1, SmsLog::where('template_key', 'water_bill')->where('mobile', '01711000001')->count());

        // three days before the due date the reminder goes out
        app(SmsService::class)->queueReminders(now()->toDateString());
        $this->assertSame(1, SmsLog::where('template_key', 'water_due')->count());

        // part of the bill and a penalty: the penalty stays partly owed, and the manager lets it off
        $bill = WaterBill::where('connection_id', $c->id)->firstOrFail();
        $this->actingAs($this->waterUser)->postJson('/api/water/collect', [
            'connection_id' => $c->id, 'date' => now()->toDateString(), 'method' => 'cash', 'penalty' => 50, 'items' => [['bill_id' => $bill->id, 'amount' => 100]],
        ])->assertCreated();
        $this->assertSame(1, SmsLog::where('template_key', 'payment')->count());
        $this->assertEquals(100, $bill->fresh()->dueAmount());

        $this->actingAs($this->waterUser)->postJson("/api/water/bills/{$bill->id}/waive-penalty", ['reason' => 'বয়স্ক গ্রাহক'])->assertForbidden();
        $this->actingAs($this->manager)->postJson("/api/water/bills/{$bill->id}/waive-penalty", ['reason' => 'বয়স্ক গ্রাহক'])->assertOk()->assertJsonPath('due', 50);
        $this->assertSame(0.0, $this->balance('water_penalty_income'));
        $this->assertSame(50.0, $this->balance('water_receivable'));
        $this->actingAs($this->manager)->postJson("/api/water/bills/{$bill->id}/waive-penalty", ['reason' => 'আবার'])->assertUnprocessable();
    }

    public function test_disconnected_connections_are_not_billed_and_reconnection_fee_is_a_bill(): void
    {
        $c = $this->connect();
        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'disconnect', 'date' => now()->toDateString(), 'reason' => 'বকেয়া'])
            ->assertOk()->assertJsonPath('status', 'disconnected');
        $this->actingAs($this->waterUser)->getJson('/api/water/billing/preview?period='.now()->subMonth()->format('Y-m'))->assertJsonPath('count', 0);

        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/status", ['action' => 'reconnect', 'date' => now()->toDateString(), 'fee' => 300])
            ->assertOk()->assertJsonPath('status', 'active');
        $this->assertSame(1, WaterBill::where('connection_id', $c->id)->where('kind', 'reconnection')->where('amount', 300)->count());

        $this->actingAs($this->waterUser)->getJson('/api/water/dues')->assertOk()
            ->assertJsonPath('totals.connections', 1)->assertJsonPath('totals.due', 300);
    }

    public function test_detail_fields_photo_documents_and_activity(): void
    {
        Storage::fake('local');
        $c = $this->connect(['alt_mobile' => '০১৮২৩৪৫৬৭৮৯', 'meter_no' => 'MTR-001', 'pipe_size' => '20 mm', 'latitude' => 24.5987, 'longitude' => 88.2765]);
        $this->assertSame('01823456789', $c->alt_mobile);
        $this->actingAs($this->waterUser)->getJson("/api/water/connections/{$c->id}")->assertOk()
            ->assertJsonPath('meter_no', 'MTR-001')->assertJsonPath('latitude', 24.5987)->assertJsonPath('documents', []);
        // a place needs both numbers
        $this->actingAs($this->waterUser)->putJson("/api/water/connections/{$c->id}", ['type_id' => $this->home->id, 'name_bn' => 'রহিম উদ্দিন', 'latitude' => 24.6])
            ->assertStatus(422)->assertJsonValidationErrors(['longitude']);

        $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/photo", ['image' => UploadedFile::fake()->image('tap.jpg', 900, 700)])->assertOk();
        $photo = $c->fresh()->photo;
        Storage::disk('local')->assertExists($photo);
        $this->actingAs($this->waterUser)->get("/api/water/connections/{$c->id}/photo")->assertOk();

        $doc = $this->actingAs($this->waterUser)->postJson("/api/water/connections/{$c->id}/documents", [
            'title' => 'NID কপি', 'file' => UploadedFile::fake()->create('nid.pdf', 120, 'application/pdf'),
        ])->assertCreated()->assertJsonMissingPath('path')->json('id');
        $this->actingAs($this->waterUser)->get("/api/water/connections/{$c->id}/documents/$doc")->assertOk();
        // another connection's document is not reachable through this one
        $other = $this->connect(['name_bn' => 'অন্য', 'mobile' => null]);
        $this->actingAs($this->waterUser)->get("/api/water/connections/{$other->id}/documents/$doc")->assertNotFound();
        // a reader can look but not upload
        $reader = $this->userWithRole('auditor');
        if ($reader->can('water.view') && ! $reader->can('water.edit')) {
            $this->actingAs($reader)->postJson("/api/water/connections/{$c->id}/documents", ['title' => 'x', 'file' => UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')])->assertForbidden();
        }

        $log = $this->actingAs($this->waterUser)->getJson("/api/water/connections/{$c->id}/activity")->assertOk()->json('data');
        $this->assertNotEmpty($log);
        $this->assertSame([], array_values(array_filter($log, fn ($l) => $l['auditable_id'] === $other->id && str_ends_with($l['auditable_type'], 'WaterConnection'))));

        $this->actingAs($this->waterUser)->deleteJson("/api/water/connections/{$c->id}/documents/$doc")->assertOk();
        $this->actingAs($this->waterUser)->deleteJson("/api/water/connections/{$c->id}/photo")->assertOk();
        Storage::disk('local')->assertMissing($photo);
    }
}
