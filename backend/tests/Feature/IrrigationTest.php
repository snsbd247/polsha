<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Farmer;
use App\Models\Invoice;
use App\Models\IrrigationRate;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Receipt;
use App\Models\Season;
use App\Models\User;
use App\Services\LedgerService;

class IrrigationTest extends Phase2TestCase
{
    private User $irrigation;

    private IrrigationType $deep;

    private Season $season;

    private Farmer $owner;

    private Farmer $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->irrigation = $this->userWithRole('irrigation_officer');
        $this->deep = IrrigationType::where('name_bn', 'গভীর নলকূপ')->firstOrFail();
        $this->owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        $this->tenant = $this->makeFarmer(['name_bn' => 'বর্গাচাষি']);

        $r = $this->actingAs($this->irrigation)->postJson('/api/seasons', [
            'name_bn' => 'বোরো ২০২৬', 'code' => 'BORO26', 'type' => 'rabi', 'crop' => 'ধান', 'start_date' => now()->subMonth()->toDateString(),
            'end_date' => now()->addMonths(3)->toDateString(), 'status' => 'open',
        ])->assertCreated();
        $this->season = Season::findOrFail($r->json('id'));
    }

    private function balance(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    private function approve(int $requestId): void
    {
        $this->actingAs($this->manager)->postJson("/api/approvals/{$requestId}/decide", ['decision' => 'approve'])->assertOk();
    }

    /** 10 Tk per decimal for deep tube well, any land type. */
    private function approvedRate(float $rate = 10): IrrigationRate
    {
        $r = $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', [
            'season_id' => $this->season->id, 'irrigation_type_id' => $this->deep->id,
            'rate' => $rate, 'effective_from' => now()->subMonth()->toDateString(),
        ])->assertCreated();
        $rate = IrrigationRate::findOrFail($r->json('id'));
        $this->assertSame('pending', $rate->status);
        $this->approve($rate->approval_request_id);

        return $rate->fresh();
    }

    /** One bigha (33 decimals); borga when a tenant is given. */
    private function land(string $dag, ?Farmer $tenant = null, bool $withType = true): Land
    {
        $r = $this->actingAs($this->irrigation)->postJson('/api/lands', [
            'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '১৪৫', 'dag_no' => $dag,
            'area' => 1, 'area_unit' => 'bigha', 'land_type_id' => LandType::first()->id, 'status' => 'cultivated',
            'irrigation_type_id' => $withType ? $this->deep->id : null,
            'owners' => [['farmer_id' => $this->owner->id, 'share_percent' => 100]], 'owned_since' => '2015-01-01',
            'cultivation' => $tenant
                ? ['farmer_id' => $tenant->id, 'type' => 'borga', 'start_date' => '2024-01-01']
                : ['farmer_id' => $this->owner->id, 'type' => 'own', 'start_date' => '2024-01-01'],
        ])->assertCreated();

        return Land::findOrFail($r->json('id'));
    }

    private function invoice(Land $land): Invoice
    {
        $r = $this->actingAs($this->irrigation)->postJson('/api/invoices', [
            'season_id' => $this->season->id, 'land_id' => $land->id, 'invoice_date' => now()->toDateString(),
        ])->assertCreated();

        return Invoice::findOrFail($r->json('id'));
    }

    private function collect(Farmer $farmer, array $items, array $extra = []): Receipt
    {
        $r = $this->actingAs($this->irrigation)->postJson('/api/receipts', array_merge([
            'farmer_id' => $farmer->id, 'date' => now()->toDateString(), 'method' => 'cash', 'items' => $items,
        ], $extra))->assertCreated();

        return Receipt::findOrFail($r->json('id'));
    }

    private function assertNoMismatch(): void
    {
        $this->actingAs($this->irrigation)->getJson('/api/irrigation/mismatch')->assertOk()
            ->assertJsonPath('difference', 0)->assertJsonCount(0, 'issues');
    }

    public function test_season_code_type_details_and_delete(): void
    {
        $this->actingAs($this->irrigation)->postJson('/api/seasons', ['name_bn' => 'আমন ২০২৬', 'code' => 'boro26', 'type' => 'kharif',
            'start_date' => '2026-07-01', 'end_date' => '2026-11-30', 'status' => 'planned'])->assertStatus(422)->assertJsonValidationErrors('code');
        $new = $this->actingAs($this->irrigation)->postJson('/api/seasons', ['name_bn' => 'আমন ২০২৬', 'code' => 'aman26', 'type' => 'kharif',
            'start_date' => '2026-07-01', 'end_date' => '2026-11-30', 'status' => 'planned'])->assertCreated()->assertJsonPath('code', 'AMAN26')->json('id');

        $this->actingAs($this->irrigation)->getJson('/api/seasons')->assertOk()
            ->assertJsonPath('current.id', $this->season->id)->assertJsonPath('types.kharif', 'খরিফ');

        $this->approvedRate();
        $this->invoice($this->land('701'));
        $this->actingAs($this->irrigation)->getJson("/api/seasons/{$this->season->id}")->assertOk()
            ->assertJsonPath('invoice_count', 1)->assertJsonPath('lands', 1)->assertJsonPath('farmers', 1)->assertJsonPath('can_delete', false);

        // a season with bills stays; an unused one can go
        $this->actingAs($this->irrigation)->deleteJson("/api/seasons/{$this->season->id}")->assertStatus(422);
        $this->actingAs($this->irrigation)->deleteJson("/api/seasons/$new")->assertOk();
        $this->assertNull(Season::find($new));
    }

    public function test_invoice_extra_charges_and_discount_reach_the_ledger(): void
    {
        $this->approvedRate();
        $land = $this->land('702');
        $base = ['season_id' => $this->season->id, 'land_id' => $land->id, 'invoice_date' => now()->toDateString()];

        // 33 decimals × 10 = 330, + service charge 1 × 50, − 30 discount = 350
        $this->actingAs($this->irrigation)->postJson('/api/invoices', $base + ['discount' => 1000])->assertStatus(422)->assertJsonValidationErrors('discount');
        $id = $this->actingAs($this->irrigation)->postJson('/api/invoices', $base + [
            'charges' => [['description' => 'সার্ভিস চার্জ', 'qty' => 1, 'rate' => 50]], 'discount' => 30,
        ])->assertCreated()->json('id');

        $inv = Invoice::findOrFail($id);
        $this->assertSame(350.0, (float) $inv->amount);
        $this->assertSame(350.0, $inv->expectedAmount());
        $this->assertSame(350.0, $this->balance('irrigation_receivable'));
        $this->actingAs($this->irrigation)->getJson("/api/invoices/$id")->assertJsonPath('discount', 30)->assertJsonPath('charges.0.amount', 50);
        $this->actingAs($this->irrigation)->getJson('/api/invoices/summary')->assertJsonPath('total', 1)->assertJsonPath('pending', 1);
        // the rate audit accepts the extra lines
        $this->actingAs($this->irrigation)->getJson("/api/irrigation/rate-audit?season_id={$this->season->id}")->assertOk()->assertJsonCount(0, 'invoice_issues');
    }

    public function test_rate_history_states_and_irrigation_type_codes(): void
    {
        $first = $this->approvedRate(10);
        $r = $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', [
            'season_id' => $this->season->id, 'irrigation_type_id' => $this->deep->id, 'rate' => 12, 'effective_from' => now()->toDateString(),
        ])->assertCreated();
        $this->approve(IrrigationRate::find($r->json('id'))->approval_request_id);

        $all = $this->actingAs($this->irrigation)->getJson("/api/irrigation-rates/all?season_id={$this->season->id}&sort=history")->assertOk()
            ->assertJsonPath('total', 2)->assertJsonPath('summary.updated', 1)->assertJsonPath('summary.active', 1);
        $newest = $all->json('data.0');
        $this->assertSame(['updated', 10, 'active'], [$newest['change'], (int) $newest['old_rate'], $newest['state']]);
        $old = collect($all->json('data'))->firstWhere('id', $first->id);
        $this->assertSame('expired', $old['state']);
        $this->assertSame(now()->subDay()->toDateString(), $old['effective_to']);
        $this->actingAs($this->irrigation)->getJson('/api/irrigation-rates/all?state=active')->assertJsonPath('total', 1);

        // irrigation types: a code is needed; one in use cannot be removed
        $admin = $this->userWithRole('super_admin');
        $this->actingAs($admin)->postJson('/api/irrigation-types', ['name_bn' => 'সোলার পাম্প'])->assertStatus(422)->assertJsonValidationErrors('code');
        $id = $this->actingAs($admin)->postJson('/api/irrigation-types', ['name_bn' => 'সোলার পাম্প', 'code' => 'solar'])->assertCreated()->assertJsonPath('code', 'SOLAR')->json('id');
        $this->actingAs($admin)->deleteJson("/api/irrigation-types/{$this->deep->id}")->assertStatus(422);
        $this->actingAs($admin)->deleteJson("/api/irrigation-types/$id")->assertOk();
    }

    public function test_collection_check_marks_under_and_matched_bills(): void
    {
        $this->approvedRate();
        $a = $this->invoice($this->land('961'));
        $b = $this->invoice($this->land('962'));
        $this->collect($this->owner, [['invoice_id' => $a->id, 'amount' => 330], ['invoice_id' => $b->id, 'amount' => 100]]);

        $this->actingAs($this->irrigation)->getJson('/api/irrigation/collection-check')->assertOk()
            ->assertJsonPath('summary.matched', 1)->assertJsonPath('summary.under', 1)->assertJsonPath('summary.under_amount', 230)
            ->assertJsonPath('data.0.id', $b->id)->assertJsonPath('data.0.difference', -230);
        $this->actingAs($this->irrigation)->getJson('/api/irrigation/collection-check?state=matched')->assertJsonPath('total', 1);
        $this->actingAs($this->irrigation)->getJson("/api/irrigation/invoices/{$b->id}/receipts")->assertOk()->assertJsonPath('0.amount', 100);
    }

    public function test_old_receipt_list_filters_and_summary(): void
    {
        $this->approvedRate();
        $inv = $this->invoice($this->land('951'));
        $this->collect($this->owner, [['invoice_id' => $inv->id, 'amount' => 100]], ['is_legacy' => true, 'legacy_no' => 'OLD-77']);
        $this->collect($this->owner, [['invoice_id' => $inv->id, 'amount' => 50]]);

        $this->actingAs($this->irrigation)->getJson('/api/receipts/legacy-summary')->assertOk()
            ->assertJsonPath('count', 1)->assertJsonPath('amount', 100)->assertJsonPath('farmers', 1);
        $this->actingAs($this->irrigation)->getJson("/api/receipts?is_legacy=1&with_invoices=1&season_id={$this->season->id}&mouza_id={$this->mouza->id}")
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.legacy_no', 'OLD-77')->assertJsonPath('data.0.invoices.0.id', $inv->id);
        $this->actingAs($this->irrigation)->getJson('/api/receipts?is_legacy=1&season_id=999999')->assertJsonPath('total', 0);

        // the receipt list cards count every live receipt, old and new
        $this->actingAs($this->irrigation)->getJson('/api/receipts/summary')->assertOk()
            ->assertJsonPath('count', 2)->assertJsonPath('amount', 150)->assertJsonPath('cancelled', 0);
    }

    public function test_batch_collection_makes_one_receipt_per_farmer(): void
    {
        $this->approvedRate();
        $a = $this->invoice($this->land('901'));              // owner, 330
        $b = $this->invoice($this->land('902', $this->tenant)); // tenant, 330
        $c = $this->invoice($this->land('903'));              // owner, 330

        $r = $this->actingAs($this->irrigation)->postJson('/api/receipts/batch', [
            'date' => now()->toDateString(), 'method' => 'cash',
            'items' => [['invoice_id' => $a->id, 'amount' => 330], ['invoice_id' => $b->id, 'amount' => 100], ['invoice_id' => $c->id, 'amount' => 30]],
        ])->assertCreated()->assertJsonCount(2, 'receipts')->assertJsonPath('total', 460);

        $this->assertSame('paid', $a->fresh()->status);
        $this->assertSame('partial', $b->fresh()->status);
        $this->assertSame(360.0, (float) Receipt::find(collect($r->json('receipts'))->firstWhere('farmer_id', $this->owner->id)['id'])->amount);
        $this->assertSame(530.0, $this->balance('irrigation_receivable'));
        $this->assertNoMismatch();

        // more than is due fails as a whole: nothing is saved
        $this->actingAs($this->irrigation)->postJson('/api/receipts/batch', [
            'date' => now()->toDateString(), 'method' => 'cash',
            'items' => [['invoice_id' => $c->id, 'amount' => 10], ['invoice_id' => $b->id, 'amount' => 9999]],
        ])->assertStatus(422);
        $this->assertSame(30.0, (float) $c->fresh()->paid_amount);
    }

    public function test_bulk_can_be_narrowed_to_a_source_and_chosen_plots(): void
    {
        $this->approvedRate();
        $a = $this->land('801');
        $b = $this->land('802');
        $this->land('803', null, false); // no irrigation type
        $body = ['season_id' => $this->season->id, 'invoice_date' => now()->toDateString()];

        $this->actingAs($this->irrigation)->postJson('/api/invoices/bulk/preview', $body + ['irrigation_type_id' => $this->deep->id])
            ->assertOk()->assertJsonPath('summary.lands', 2)->assertJsonPath('summary.invoices', 2);
        $this->actingAs($this->irrigation)->postJson('/api/invoices/bulk', $body + ['irrigation_type_id' => $this->deep->id, 'land_ids' => [$b->id]])
            ->assertCreated()->assertJsonPath('invoice_count', 1);
        $this->assertSame(0, Invoice::where('land_id', $a->id)->count());
        $this->assertSame(1, Invoice::where('land_id', $b->id)->count());
    }

    public function test_rate_needs_approval_before_it_bills(): void
    {
        $land = $this->land('১০১');
        $r = $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', [
            'season_id' => $this->season->id, 'irrigation_type_id' => $this->deep->id, 'rate' => 10,
            'effective_from' => now()->subMonth()->toDateString(),
        ])->assertCreated();

        // Still pending: the land has no billable rate.
        $this->actingAs($this->irrigation)->postJson('/api/invoices/quote', [
            'season_id' => $this->season->id, 'land_id' => $land->id, 'invoice_date' => now()->toDateString(),
        ])->assertOk()->assertJsonPath('ok', false)->assertJsonPath('reason', 'no_rate');

        // A second proposal for the same slot waits for the first.
        $this->actingAs($this->irrigation)->postJson('/api/irrigation-rates', [
            'season_id' => $this->season->id, 'irrigation_type_id' => $this->deep->id, 'rate' => 12,
            'effective_from' => now()->subMonth()->toDateString(),
        ])->assertStatus(422);

        $this->approve(IrrigationRate::find($r->json('id'))->approval_request_id);
        $this->actingAs($this->irrigation)->postJson('/api/invoices/quote', [
            'season_id' => $this->season->id, 'land_id' => $land->id, 'invoice_date' => now()->toDateString(),
        ])->assertOk()->assertJsonPath('ok', true)->assertJsonPath('amount', 330);

        $this->actingAs($this->irrigation)->getJson('/api/irrigation-rates?season_id='.$this->season->id)->assertOk()
            ->assertJsonPath('current.0.rate', 10);
    }

    public function test_invoice_posts_receivable_and_income(): void
    {
        $this->approvedRate();
        $invoice = $this->invoice($this->land('১০১'));

        $this->assertStringStartsWith('INV-', $invoice->invoice_no);
        $this->assertEquals(330, $invoice->amount);
        $this->assertSame('unpaid', $invoice->status);
        $this->assertNotNull($invoice->journal_id);
        $this->assertEquals(330, $this->balance('irrigation_receivable'));
        $this->assertEquals(-330, $this->balance('irrigation_income'));

        // No double billing of the same land in one season.
        $this->actingAs($this->irrigation)->postJson('/api/invoices', [
            'season_id' => $this->season->id, 'land_id' => $invoice->land_id, 'invoice_date' => now()->toDateString(),
        ])->assertStatus(422);
        $this->assertNoMismatch();
    }

    public function test_bulk_preview_splits_and_bills_borga_to_cultivator(): void
    {
        $this->approvedRate();
        $own = $this->land('১০১');
        $borga = $this->land('১০২', $this->tenant);
        $this->land('১০৩', null, false); // no irrigation type → skipped
        $this->invoice($own);

        $p = $this->actingAs($this->irrigation)->postJson('/api/invoices/bulk/preview', [
            'season_id' => $this->season->id, 'mouza_id' => $this->mouza->id, 'invoice_date' => now()->toDateString(),
        ])->assertOk();
        $this->assertEquals(1, $p->json('summary.invoices'));
        $this->assertEquals(330, $p->json('summary.amount'));
        $reasons = collect($p->json('lines'))->pluck('reason')->filter()->sort()->values()->all();
        $this->assertSame(['already_invoiced', 'no_irrigation_type'], $reasons);

        $this->actingAs($this->irrigation)->postJson('/api/invoices/bulk', [
            'season_id' => $this->season->id, 'mouza_id' => $this->mouza->id, 'invoice_date' => now()->toDateString(),
        ])->assertCreated()->assertJsonPath('invoice_count', 1);

        $inv = Invoice::where('land_id', $borga->id)->firstOrFail();
        $this->assertSame($this->tenant->id, $inv->farmer_id);
        $this->assertSame('borga', $inv->cultivation_type);
        $this->assertSame($this->owner->id, $inv->snapshot['owners'][0]['id']);
        $this->assertEquals(660, $this->balance('irrigation_receivable'));
        $this->assertNoMismatch();
    }

    public function test_partial_collection_receipt_and_cancel_reversal(): void
    {
        $this->approvedRate();
        $invoice = $this->invoice($this->land('১০১'));

        // More than the due is refused.
        $this->actingAs($this->irrigation)->postJson('/api/receipts', [
            'farmer_id' => $this->owner->id, 'date' => now()->toDateString(), 'method' => 'cash',
            'items' => [['invoice_id' => $invoice->id, 'amount' => 500]],
        ])->assertStatus(422);

        // Someone else's invoice is refused.
        $this->actingAs($this->irrigation)->postJson('/api/receipts', [
            'farmer_id' => $this->tenant->id, 'date' => now()->toDateString(), 'method' => 'cash',
            'items' => [['invoice_id' => $invoice->id, 'amount' => 10]],
        ])->assertStatus(422);

        $receipt = $this->collect($this->owner, [['invoice_id' => $invoice->id, 'amount' => 100]]);
        $this->assertStringStartsWith('MR-', $receipt->receipt_no);
        $this->assertSame('partial', $invoice->fresh()->status);
        $this->assertEquals(100, $this->balance('cash_irrigation'));
        $this->assertEquals(230, $this->balance('irrigation_receivable'));
        $this->assertNoMismatch();

        $this->actingAs($this->irrigation)->getJson('/api/receipts/dues?farmer_id='.$this->owner->id)->assertOk()
            ->assertJsonPath('total_due', 230);
        $this->actingAs($this->irrigation)->getJson("/api/irrigation/farmers/{$this->owner->id}/statement")->assertOk()
            ->assertJsonPath('totals.due', 230);

        // Paying the rest settles it.
        $second = $this->collect($this->owner, [['invoice_id' => $invoice->id, 'amount' => 230]]);
        $this->assertSame('paid', $invoice->fresh()->status);

        // Each receipt keeps the due as it stood right after that payment.
        $this->actingAs($this->irrigation)->getJson('/api/receipts/'.$receipt->id)->assertOk()->assertJsonPath('items.0.invoice.due_after', 230);
        $this->actingAs($this->irrigation)->getJson('/api/receipts/'.$second->id)->assertOk()->assertJsonPath('items.0.invoice.due_after', 0)
            // what the paper receipt prints: this season's bill, no penalty, no patwari yet, not a member
            ->assertJsonPath('items.0.invoice.is_current', true)->assertJsonPath('items.0.invoice.penalty', 0)
            ->assertJsonPath('items.0.invoice.patwari', null)->assertJsonPath('farmer_is_member', false);

        // A paid invoice can't be cancelled until its receipts are.
        $this->actingAs($this->irrigation)->postJson("/api/invoices/{$invoice->id}/cancel", ['reason' => 'ভুল'])->assertStatus(422);

        // Cancelling a receipt needs approval, then reverses the voucher and restores the due.
        $req = $this->actingAs($this->irrigation)->postJson("/api/receipts/{$second->id}/cancel", ['reason' => 'ভুল এন্ট্রি'])->assertCreated();
        $this->assertSame('cancel_pending', $second->fresh()->status);
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', $second->fresh()->status);
        $this->assertSame('partial', $invoice->fresh()->status);
        $this->assertEquals(100, $this->balance('cash_irrigation'));
        $this->assertEquals(230, $this->balance('irrigation_receivable'));
        $this->assertNoMismatch();
    }

    public function test_rejected_receipt_cancel_keeps_receipt(): void
    {
        $this->approvedRate();
        $invoice = $this->invoice($this->land('১০১'));
        $receipt = $this->collect($this->owner, [['invoice_id' => $invoice->id, 'amount' => 50]]);

        $req = $this->actingAs($this->irrigation)->postJson("/api/receipts/{$receipt->id}/cancel", ['reason' => 'x'])->assertCreated();
        $this->actingAs($this->manager)->postJson("/api/approvals/{$req->json('id')}/decide", ['decision' => 'reject', 'remarks' => 'না'])->assertOk();
        $this->assertSame('active', $receipt->fresh()->status);
        $this->assertEquals(50, $invoice->fresh()->paid_amount);
    }

    public function test_unpaid_invoice_cancel_reverses_voucher(): void
    {
        $this->approvedRate();
        $invoice = $this->invoice($this->land('১০১'));

        $req = $this->actingAs($this->irrigation)->postJson("/api/invoices/{$invoice->id}/cancel", ['reason' => 'ভুল জমি'])->assertCreated();
        $this->approve($req->json('id'));
        $this->assertSame('cancelled', $invoice->fresh()->status);
        $this->assertEquals(0, $this->balance('irrigation_receivable'));
        $this->assertEquals(0, $this->balance('irrigation_income'));
        $this->assertNoMismatch();

        // The land can be billed again after the cancel.
        $this->invoice(Land::find($invoice->land_id));
    }

    public function test_legacy_bank_receipt_and_public_verify(): void
    {
        $this->approvedRate();
        $invoice = $this->invoice($this->land('১০১'));
        $bank = Account::create([
            'code' => '1299', 'name_bn' => 'টেস্ট ব্যাংক', 'type' => 'asset', 'parent_id' => Account::byKey('bank_group')->id, 'is_postable' => true, 'is_active' => true,
        ]);
        $bank->bankAccount()->create(['bank_name' => 'সোনালী', 'account_no' => '123', 'account_type' => 'current', 'is_active' => true]);

        // Bank without a reference is refused.
        $this->actingAs($this->irrigation)->postJson('/api/receipts', [
            'farmer_id' => $this->owner->id, 'date' => now()->toDateString(), 'method' => 'bank', 'fund_account_id' => $bank->id,
            'items' => [['invoice_id' => $invoice->id, 'amount' => 30]],
        ])->assertStatus(422)->assertJsonValidationErrors('reference');

        $receipt = $this->collect($this->owner, [['invoice_id' => $invoice->id, 'amount' => 30]], [
            'method' => 'bank', 'fund_account_id' => $bank->id, 'reference' => 'CHQ-1', 'is_legacy' => true, 'legacy_no' => '৪৫৬',
        ]);
        $this->assertEquals(30, app(LedgerService::class)->balance($bank->id));
        $this->assertTrue($receipt->is_legacy);

        // Legacy numbers are unique.
        $this->actingAs($this->irrigation)->postJson('/api/receipts', [
            'farmer_id' => $this->owner->id, 'date' => now()->toDateString(), 'method' => 'cash', 'is_legacy' => true, 'legacy_no' => '৪৫৬',
            'items' => [['invoice_id' => $invoice->id, 'amount' => 10]],
        ])->assertStatus(422)->assertJsonValidationErrors('legacy_no');

        $this->getJson('/api/public/receipts/'.$receipt->verify_token)->assertOk()
            ->assertJsonPath('receipt_no', $receipt->receipt_no)->assertJsonPath('amount', 30)->assertJsonPath('status', 'active');
        $this->getJson('/api/public/receipts/nope')->assertNotFound();

        $show = $this->actingAs($this->irrigation)->getJson('/api/receipts/'.$receipt->id)->assertOk();
        $this->assertSame($invoice->invoice_no, $show->json('items.0.invoice.invoice_no'));
        $this->assertNoMismatch();
    }

    public function test_rate_audit_and_dues_report(): void
    {
        $this->approvedRate();
        $this->invoice($this->land('১০১'));
        $this->land('১০২', null, false);

        $audit = $this->actingAs($this->irrigation)->getJson('/api/irrigation/rate-audit?season_id='.$this->season->id)->assertOk();
        $this->assertCount(0, $audit->json('invoice_issues'));
        $this->assertEquals(1, $audit->json('lands_without_irrigation_type'));

        $this->actingAs($this->irrigation)->getJson('/api/irrigation/dues')->assertOk()
            ->assertJsonPath('totals.due', 330)->assertJsonPath('data.0.farmer_id', $this->owner->id);
        $this->actingAs($this->irrigation)->getJson('/api/invoices?season_id='.$this->season->id)->assertOk()
            ->assertJsonPath('total', 1);
    }

    public function test_cashier_cannot_create_invoices(): void
    {
        $this->approvedRate();
        $land = $this->land('১০১');
        $this->actingAs($this->userWithRole('cashier'))->postJson('/api/invoices', [
            'season_id' => $this->season->id, 'land_id' => $land->id, 'invoice_date' => now()->toDateString(),
        ])->assertForbidden();
    }
}
