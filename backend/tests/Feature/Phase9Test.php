<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountingPeriod;
use App\Models\BankAccount;
use App\Models\CombinedPayment;
use App\Models\ExportLog;
use App\Models\Farmer;
use App\Models\FiscalYearClose;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\PublicPaymentRequest;
use App\Models\SmsLog;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\SettingService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

class Phase9Test extends Phase2TestCase
{
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-06-30 10:00:00');
        $this->admin = $this->userWithRole('super_admin');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_every_report_runs_and_exports_are_logged(): void
    {
        $catalog = $this->actingAs($this->admin)->getJson('/api/reports')->assertOk()->json('reports');
        $this->assertNotEmpty($catalog);
        foreach ($catalog as $r) {
            $res = $this->actingAs($this->admin)->getJson("/api/reports/{$r['key']}");
            if ($res->status() === 422 && $res->json('errors.filters')) {
                continue; // statement-type report: needs a member/farmer/account picked first
            }
            $this->assertSame(200, $res->status(), "report {$r['key']}: ".$res->getContent());
            $res->assertJsonStructure(['key', 'title', 'columns', 'rows']);
        }

        $this->actingAs($this->admin)->postJson('/api/reports/lands/export-log', ['format' => 'xlsx', 'rows' => 3, 'filters' => ['mouza_id' => 1]])
            ->assertSuccessful();
        $this->assertDatabaseHas('export_logs', ['report_key' => 'lands', 'format' => 'xlsx', 'row_count' => 3, 'user_id' => $this->admin->id]);

        $this->actingAs($this->admin)->getJson('/api/reports/no_such_report')->assertNotFound();
        // A cashier's catalog has no audit reports, and asking directly is refused.
        $cashier = $this->userWithRole('cashier');
        $keys = collect($this->actingAs($cashier)->getJson('/api/reports')->json('reports'))->pluck('key');
        $this->assertNotContains('audit_activity', $keys);
        $this->actingAs($cashier)->getJson('/api/reports/audit_activity')->assertForbidden();
        $this->assertSame(1, ExportLog::count());
    }

    public function test_dashboard_shows_kpis_by_permission(): void
    {
        $this->makeFarmer();
        $kpis = collect($this->actingAs($this->admin)->getJson('/api/dashboard?refresh=1')->assertOk()->json('kpis'))->keyBy('key');
        $this->assertEquals(1, $kpis['farmers']['value']);
        $this->assertTrue($kpis->has('cash'));

        $plain = User::factory()->create();
        $this->assertEmpty($this->actingAs($plain)->getJson('/api/dashboard')->assertOk()->json('kpis'));
    }

    public function test_sms_settings_never_return_the_api_key(): void
    {
        $base = ['sms_enabled' => true, 'sms_gateway_url' => 'https://sms.example.com/send?key={api_key}&to={mobile}&msg={message}', 'sms_http_method' => 'GET',
            'sms_sender_id' => 'POLSHA', 'sms_success_text' => '', 'sms_auto_payment' => true, 'sms_auto_savings' => true, 'sms_reminders' => false, 'sms_reminder_days' => 3];
        $res = $this->actingAs($this->admin)->putJson('/api/sms/settings', $base + ['sms_api_key' => 'SECRET-123'])->assertOk();
        $this->assertStringNotContainsString('SECRET-123', $res->getContent());
        $res->assertJsonPath('sms_api_key_set', true);

        // An empty key keeps the saved one; clearing is explicit.
        $this->actingAs($this->admin)->putJson('/api/sms/settings', $base + ['sms_api_key' => ''])->assertJsonPath('sms_api_key_set', true);
        $this->assertSame('SECRET-123', SettingService::get('sms_api_key'));
        $this->actingAs($this->admin)->putJson('/api/sms/settings', $base + ['clear_api_key' => true])->assertJsonPath('sms_api_key_set', false);
        $this->actingAs($this->admin)->putJson('/api/sms/settings', ['sms_gateway_url' => ''] + $base)->assertUnprocessable();

        // Templates reject variables they do not know.
        $tpl = $this->actingAs($this->admin)->getJson('/api/sms/templates')->json('0');
        $this->actingAs($this->admin)->putJson("/api/sms/templates/{$tpl['id']}", ['body' => 'Hi {nope}', 'is_active' => true])->assertUnprocessable();
        $this->actingAs($this->userWithRole('cashier'))->getJson('/api/sms/settings')->assertForbidden();
    }

    public function test_public_payment_is_verified_into_a_combined_payment(): void
    {
        $farmer = $this->makeFarmer(['name_bn' => 'রহিম উদ্দিন মিয়া', 'mobile' => '01711000000']);
        $member = Member::create(['farmer_id' => $farmer->id, 'member_no' => 1, 'admitted_on' => '2020-01-01', 'status' => Member::ACTIVE]);
        MemberAccount::create(['kind' => 'savings', 'member_id' => $member->id, 'account_no' => 'SAV-T1', 'opened_on' => '2020-01-01', 'balance' => 0]);
        $payload = ['farmer_code' => $farmer->farmer_code, 'payer_name' => 'রহিম', 'mobile' => '০১৭১১০০০০০০', 'method' => 'bkash',
            'sender_number' => '01811000000', 'trx_id' => 'bk7x2m9q1a', 'amount' => 500, 'paid_on' => '2026-06-29'];

        $this->postJson('/api/public/payments', $payload)->assertUnprocessable(); // feature off
        SettingService::setMany(['public_payment_enabled' => true, 'public_payment_bkash' => '01700000000']);
        $this->getJson('/api/public/payment-info')->assertOk()->assertJsonPath('enabled', true);
        $this->getJson("/api/public/payments/farmer?code={$farmer->farmer_code}")->assertOk()->assertJsonPath('name_bn', 'রহিম ***');

        $no = $this->postJson('/api/public/payments', $payload)->assertCreated()->json('request_no');
        $this->postJson('/api/public/payments', $payload)->assertUnprocessable(); // same TrxID twice
        $req = PublicPaymentRequest::where('request_no', $no)->firstOrFail();
        $this->assertSame('BK7X2M9Q1A', $req->trx_id);
        $this->getJson("/api/public/payments/status?request_no={$no}&mobile=01711000000")->assertOk()->assertJsonPath('status', 'pending');
        $this->getJson("/api/public/payments/status?request_no={$no}&mobile=01999999999")->assertNotFound();

        $bank = BankAccount::findOrFail($this->actingAs($this->admin)->postJson('/api/bank-accounts', [
            'bank_name' => 'বিকাশ মার্চেন্ট', 'account_no' => '01700000000', 'account_type' => 'current',
        ])->assertCreated()->json('id'));
        $cashier = $this->userWithRole('cashier');
        $this->actingAs($cashier)->getJson("/api/public-payments/{$req->id}")->assertOk()->assertJsonStructure(['allocation', 'funds']);
        $this->actingAs($cashier)->postJson("/api/public-payments/{$req->id}/verify", ['fund_account_id' => Account::byKey('cash_society')->id])
            ->assertUnprocessable(); // only a bank/mobile-wallet fund
        $this->actingAs($cashier)->postJson("/api/public-payments/{$req->id}/verify", ['fund_account_id' => $bank->account_id])->assertOk();

        $req->refresh();
        $this->assertSame('verified', $req->status);
        $cp = CombinedPayment::findOrFail($req->combined_payment_id);
        $this->assertEquals(500, $cp->amount);
        $this->assertEquals(500, app(LedgerService::class)->balance($bank->account_id));
        $this->assertTrue(SmsLog::where('template_key', 'public_payment_verified')->where('mobile', '01711000000')->exists());
        $this->getJson("/api/public/payments/status?request_no={$no}&mobile=01711000000")->assertJsonPath('receipt_no', $cp->payment_no);
        $this->actingAs($cashier)->postJson("/api/public-payments/{$req->id}/reject", ['reason' => 'x'])->assertUnprocessable();
    }

    public function test_financial_year_close_moves_income_and_expense_to_surplus(): void
    {
        $ledger = app(LedgerService::class);
        $ledger->postNow('receipt', '2025-03-10', 'সেচ আয়', [
            ['account_id' => Account::byKey('cash_society')->id, 'debit' => 1000],
            ['account_id' => Account::byKey('irrigation_income')->id, 'credit' => 1000],
        ]);
        $ledger->postNow('payment', '2025-04-10', 'অফিস খরচ', [
            ['account_id' => Account::byKey('office_expense')->id, 'debit' => 300],
            ['account_id' => Account::byKey('cash_society')->id, 'credit' => 300],
        ]);

        $this->actingAs($this->admin)->getJson('/api/financial-years/2025-26/preview')->assertOk()->assertJsonPath('can_close', false);
        $p = $this->actingAs($this->admin)->getJson('/api/financial-years/2024-25/preview')->assertOk();
        $p->assertJsonPath('can_close', true);
        $this->assertEquals(700, $p->json('surplus'));

        $this->actingAs($this->admin)->postJson('/api/financial-years/2024-25/close', ['note' => 'AGM'])->assertUnprocessable(); // confirm required
        $this->actingAs($this->admin)->postJson('/api/financial-years/2024-25/close', ['note' => 'AGM', 'confirm' => true])->assertCreated();

        $this->assertEquals(0, $ledger->balance(Account::byKey('irrigation_income')->id));
        $this->assertEquals(0, $ledger->balance(Account::byKey('office_expense')->id));
        $this->assertEquals(-700, $ledger->balance(Account::byKey('accumulated_surplus')->id));
        $this->assertSame(1, FiscalYearClose::count());
        $this->assertSame(0, AccountingPeriod::where('fiscal_year', '2024-25')->where('status', 'open')->count());
        $this->actingAs($this->admin)->postJson('/api/financial-years/2024-25/close', ['confirm' => true])->assertUnprocessable();
    }

    public function test_receipt_books_reject_overlaps_and_find_gaps(): void
    {
        $collector = $this->userWithRole('cashier');
        $book = $this->actingAs($this->admin)->postJson('/api/receipt-books', [
            'book_no' => 'B-1', 'start_no' => 1001, 'end_no' => 1100, 'status' => 'issued', 'issued_to' => $collector->id, 'issued_on' => '2026-06-01',
        ])->assertCreated()->json('id');
        $this->actingAs($this->admin)->postJson('/api/receipt-books', ['book_no' => 'B-2', 'start_no' => 1050, 'end_no' => 1150, 'status' => 'stock'])
            ->assertUnprocessable();
        $this->actingAs($this->admin)->postJson('/api/receipt-books', ['book_no' => 'B-3', 'start_no' => 1, 'end_no' => 50, 'status' => 'issued'])
            ->assertUnprocessable(); // issued needs a holder

        $show = $this->actingAs($this->admin)->getJson("/api/receipt-books/{$book}")->assertOk();
        $show->assertJsonPath('total', 100)->assertJsonPath('used', 0);
        $this->actingAs($collector)->getJson('/api/receipt-books')->assertForbidden();
    }

    public function test_deleted_farmers_are_listed_with_reason_and_restored(): void
    {
        $farmer = $this->makeFarmer(['nid' => '1234567890']);
        $this->actingAs($this->admin)->deleteJson("/api/farmers/{$farmer->id}", ['reason' => 'ভুল এন্ট্রি'])->assertSuccessful();

        $row = $this->actingAs($this->admin)->getJson('/api/farmers-deleted')->assertOk()->json('data.0');
        $this->assertSame($farmer->id, $row['id']);
        $this->assertSame('ভুল এন্ট্রি', $row['reason']);

        $this->actingAs($this->admin)->postJson("/api/farmers/{$farmer->id}/restore")->assertOk();
        $this->assertNotNull(Farmer::find($farmer->id));
        $this->assertSame(0, $this->actingAs($this->admin)->getJson('/api/farmers-deleted')->json('total'));
    }

    public function test_password_reset_by_sms_code(): void
    {
        $user = User::factory()->create(['username' => 'rahim', 'mobile' => '01712345678']);
        $this->postJson('/api/auth/forgot-password', ['login' => 'nobody'])->assertOk(); // same answer, nothing sent
        $this->assertSame(0, SmsLog::count());

        $this->postJson('/api/auth/forgot-password', ['login' => 'rahim'])->assertOk();
        $log = SmsLog::where('template_key', 'otp')->firstOrFail();
        $this->assertSame('01712345678', $log->mobile);
        preg_match('/\d{6}/', $log->message, $m);
        $code = $m[0];

        $new = ['login' => 'rahim', 'password' => 'NewPass123', 'password_confirmation' => 'NewPass123'];
        $this->postJson('/api/auth/reset-password', $new + ['code' => $code === '000000' ? '111111' : '000000'])->assertUnprocessable();
        $this->postJson('/api/auth/reset-password', $new + ['code' => $code])->assertOk();
        $this->assertTrue(Hash::check('NewPass123', $user->fresh()->password));
        $this->postJson('/api/auth/reset-password', $new + ['code' => $code])->assertUnprocessable(); // single use
    }

    public function test_integrity_scan_and_ledger_check(): void
    {
        $this->actingAs($this->admin)->postJson('/api/integrity-scans')->assertSuccessful();
        $this->actingAs($this->admin)->getJson('/api/integrity-scans')->assertOk()->assertJsonPath('total', 1);
        $this->actingAs($this->admin)->getJson('/api/ledger-integrity')->assertOk()->assertJsonStructure(['checks', 'source_vs_ledger']);
        $this->actingAs($this->userWithRole('cashier'))->postJson('/api/integrity-scans')->assertForbidden();
    }

    public function test_public_endpoints_have_separate_rate_limits(): void
    {
        // Using up the public status lookups must not lock the same visitor out of login or password reset.
        for ($i = 0; $i < 20; $i++) {
            $this->getJson('/api/public/payments/status?request_no=X&mobile=01700000000');
        }
        $this->getJson('/api/public/payments/status?request_no=X&mobile=01700000000')->assertStatus(429);
        $this->postJson('/api/auth/forgot-password', ['login' => 'nobody'])->assertOk();
        $this->postJson('/api/auth/login', ['login' => 'nobody', 'password' => 'x'])->assertStatus(422);
    }
}
