<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\ImportBatch;
use App\Models\Invoice;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\LandType;
use App\Models\Loan;
use App\Models\LoanProduct;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\Receipt;
use App\Models\Season;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\SequenceService;
use App\Support\Spreadsheet;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use ZipArchive;

class Phase10Test extends Phase2TestCase
{
    private User $admin;

    private User $admin2;

    private int $memberNo = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-06-30 10:00:00');
        $this->admin = $this->userWithRole('admin');
        $this->admin2 = $this->userWithRole('admin');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function member(string $name): Member
    {
        return Member::create([
            'farmer_id' => $this->makeFarmer(['name_bn' => $name])->id, 'member_no' => ++$this->memberNo,
            'admitted_on' => '2020-01-01', 'status' => Member::ACTIVE,
        ]);
    }

    private function ledger(string $key): float
    {
        return app(LedgerService::class)->balance(Account::byKey($key)->id);
    }

    /** upload → automatic mapping → validate → commit, as the wizard does. */
    private function import(string $type, UploadedFile $file, int $expectValid, ?User $as = null): ImportBatch
    {
        $as ??= $this->manager;
        $up = $this->actingAs($as)->post("/api/imports/{$type}/upload", ['file' => $file], ['Accept' => 'application/json'])->assertOk();
        $preview = $this->actingAs($as)->postJson('/api/imports/validate', ['upload_token' => $up->json('upload_token'), 'mapping' => $up->json('mapping')])
            ->assertOk()->assertJsonPath('valid', $expectValid);
        $r = $this->actingAs($as)->postJson('/api/imports/commit', ['token' => $preview->json('token')])->assertOk();

        return ImportBatch::findOrFail($r->json('id'));
    }

    private function csv(array $rows): UploadedFile
    {
        $out = "\xEF\xBB\xBF";
        foreach ($rows as $r) {
            $out .= implode(',', array_map(fn ($c) => '"'.str_replace('"', '""', (string) $c).'"', $r))."\n";
        }

        return UploadedFile::fake()->createWithContent('data.csv', $out);
    }

    /** A real (minimal) xlsx: shared strings, a number, and a date-formatted serial. */
    private function xlsx(array $rows): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'xl').'.xlsx';
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
        $rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
        $zip->addFromString('xl/workbook.xml', "<?xml version=\"1.0\"?><workbook {$ns} {$rel}><sheets><sheet name=\"S\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
        $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
        $zip->addFromString('xl/styles.xml', "<?xml version=\"1.0\"?><styleSheet {$ns}><cellXfs count=\"2\"><xf numFmtId=\"0\"/><xf numFmtId=\"14\"/></cellXfs></styleSheet>");
        $strings = [];
        $xmlRows = '';
        foreach ($rows as $i => $cells) {
            $xmlRows .= '<row r="'.($i + 1).'">';
            foreach (array_values($cells) as $j => $c) {
                $ref = chr(65 + $j).($i + 1);
                if (is_array($c)) { // ['date' => serial]
                    $xmlRows .= "<c r=\"{$ref}\" s=\"1\"><v>{$c['date']}</v></c>";
                } elseif (is_int($c) || is_float($c)) {
                    $xmlRows .= "<c r=\"{$ref}\"><v>{$c}</v></c>";
                } elseif ($c !== '') {
                    $strings[] = htmlspecialchars($c);
                    $xmlRows .= "<c r=\"{$ref}\" t=\"s\"><v>".(count($strings) - 1).'</v></c>';
                }
            }
            $xmlRows .= '</row>';
        }
        $zip->addFromString('xl/sharedStrings.xml', "<?xml version=\"1.0\"?><sst {$ns}>".implode('', array_map(fn ($s) => "<si><t>{$s}</t></si>", $strings)).'</sst>');
        $zip->addFromString('xl/worksheets/sheet1.xml', "<?xml version=\"1.0\"?><worksheet {$ns}><sheetData>{$xmlRows}</sheetData></worksheet>");
        $zip->close();

        return new UploadedFile($path, 'data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);
    }

    private function rollback(ImportBatch $batch): void
    {
        $r = $this->actingAs($this->admin)->postJson("/api/imports/{$batch->id}/rollback", ['reason' => 'ভুল ফাইল'])->assertOk()
            ->assertJsonPath('batch.status', 'rollback_pending');
        $this->actingAs($this->admin2)->postJson('/api/approvals/'.$r->json('approval.id').'/decide', ['decision' => 'approve'])->assertOk();
        $this->assertSame('rolled_back', $batch->fresh()->status);
    }

    public function test_xlsx_reader_handles_shared_strings_numbers_and_dates(): void
    {
        $file = $this->xlsx([['নাম', 'টাকা', 'তারিখ'], ['করিম', 12500.5, ['date' => 46023]], ['', '', ''], ['রহিম', 10000000000, '']]);
        $rows = Spreadsheet::read($file->getRealPath(), 'xlsx');

        $this->assertSame([1, 2, 4], array_keys($rows));
        $this->assertSame(['করিম', '12500.5', '01/01/2026'], $rows[2]);
        $this->assertSame('10000000000', $rows[4][1]);
    }

    public function test_savings_opening_from_excel_posts_against_opening_equity_and_rolls_back(): void
    {
        $karim = $this->member('করিম');
        $this->member('রহিম');
        $file = $this->xlsx([
            ['সদস্য নং', 'জের', 'তারিখ', 'মন্তব্য'],
            ['1', '১২,৫০০', ['date' => 46023], 'খাতা ৩'],
            ['2', 5000, '', ''],
            ['1', 100, '', ''],   // same member twice → error
            ['99', 100, '', ''],  // unknown member
        ]);
        $batch = $this->import('savings_opening', $file, 2);

        $this->assertSame(2, $batch->imported_rows);
        $this->assertEquals(17500, (float) $batch->total_amount);
        $acc = MemberAccount::where('member_id', $karim->id)->where('kind', 'savings')->firstOrFail();
        $this->assertEquals(12500, (float) $acc->balance);
        $this->assertSame('2026-01-01', $acc->transactions()->first()->date->toDateString());
        // debit − credit: the deposits liability is credited, Opening Balance Equity debited.
        $this->assertEquals(-17500, $this->ledger('savings_deposits'));
        $this->assertEquals(17500, $this->ledger('opening_balance_equity'));

        // A second opening for the same account is refused.
        $up = $this->actingAs($this->manager)->post('/api/imports/savings_opening/upload', ['file' => $this->csv([['সদস্য নং', 'জের'], ['1', '10']])], ['Accept' => 'application/json']);
        $this->actingAs($this->manager)->postJson('/api/imports/validate', ['upload_token' => $up->json('upload_token'), 'mapping' => $up->json('mapping')])
            ->assertOk()->assertJsonPath('valid', 0);

        $this->actingAs($this->manager)->postJson("/api/imports/{$batch->id}/rollback", ['reason' => 'x'])->assertForbidden();
        $this->rollback($batch);
        $this->assertEquals(0, (float) $acc->fresh()->balance);
        $this->assertEquals(0, $this->ledger('savings_deposits'));
        $this->assertEquals(0, $this->ledger('opening_balance_equity'));
    }

    public function test_rollback_is_blocked_once_later_transactions_exist(): void
    {
        $this->member('করিম');
        $batch = $this->import('savings_opening', $this->csv([['সদস্য নং', 'টাকা'], ['1', '5000']]), 1);
        $acc = MemberAccount::where('kind', 'savings')->firstOrFail();
        $this->actingAs($this->admin)->getJson("/api/imports/{$batch->id}")->assertOk()->assertJsonCount(0, 'blockers');

        $this->actingAs($this->userWithRole('cashier'))->postJson("/api/funds/savings/accounts/{$acc->id}/transactions", [
            'type' => 'deposit', 'date' => '2026-06-30', 'amount' => 1000, 'method' => 'cash', 'fund_account_id' => null, 'counter_account_id' => null,
        ])->assertCreated();

        $this->actingAs($this->admin)->getJson("/api/imports/{$batch->id}")->assertOk()->assertJsonCount(1, 'blockers');
        $this->actingAs($this->admin)->postJson("/api/imports/{$batch->id}/rollback", ['reason' => 'x'])->assertUnprocessable();
        $this->assertSame('completed', $batch->fresh()->status);
    }

    public function test_running_loan_import_applies_past_repayments(): void
    {
        $this->member('করিম');
        LoanProduct::create([
            'code' => 'AG-1', 'name_bn' => 'কৃষি ঋণ', 'category' => 'agriculture', 'max_amount' => 100000, 'savings_multiplier' => 0,
            'interest_rate' => 12, 'interest_method' => 'flat', 'frequency' => 'monthly', 'installments' => 12,
            'penalty_rate' => 3, 'grace_days' => 5, 'guarantors_required' => 0, 'is_active' => true,
        ]);
        $batch = $this->import('loan_opening', $this->csv([
            ['সদস্য নং', 'ঋণের ধরন', 'মূল ঋণ', 'বিতরণের তারিখ', 'প্রথম কিস্তির তারিখ', 'বকেয়া আসল', 'বকেয়া সুদ', 'পুরনো ঋণ নং'],
            ['1', 'AG-1', '12000', '01/01/2026', '01/02/2026', '7000', '', 'খাতা-৯'],
            ['1', 'AG-1', '12000', '01/01/2026', '', '13000', '', ''], // duplicate member + outstanding > amount
        ]), 1);

        $loan = Loan::where('import_batch_id', $batch->id)->firstOrFail();
        $this->assertSame('active', $loan->status);
        $this->assertCount(12, $loan->schedule);
        $this->assertEquals(5000, $loan->schedule->sum('principal_paid'));
        $this->assertSame(5, $loan->schedule->whereNotNull('paid_on')->count());
        $this->assertEquals(7000, $this->ledger('loans_receivable'));

        $this->rollback($batch);
        $this->assertSame('cancelled', $loan->fresh()->status);
        $this->assertEquals(0, $this->ledger('loans_receivable'));
    }

    public function test_legacy_irrigation_dues_and_old_receipts(): void
    {
        $owner = $this->makeFarmer(['name_bn' => 'মালিক']);
        $land = Land::create([
            'land_code' => SequenceService::next('land'), 'mouza_id' => $this->mouza->id, 'survey' => 'RS', 'khatian_no' => '145', 'dag_no' => '1023',
            'area_decimal' => 33, 'land_type_id' => LandType::first()->id, 'irrigation_type_id' => IrrigationType::first()->id, 'status' => 'cultivated',
        ]);
        $land->ownerHistory()->create(['farmer_id' => $owner->id, 'share_percent' => 100, 'start_date' => '2015-01-01']);
        $land->cultivationHistory()->create(['farmer_id' => $owner->id, 'type' => 'own', 'start_date' => '2015-01-01']);
        Season::create(['name_bn' => 'বোরো ২০২৫', 'start_date' => '2025-01-01', 'end_date' => '2025-05-31', 'status' => 'closed']);
        $irrigationOfficer = $this->userWithRole('irrigation_officer');
        $irrigationOfficer->givePermissionTo(['import.view', 'import.create']);

        $dues = $this->import('legacy_irrigation', $this->csv([
            ['উপজেলা', 'মৌজা JL', 'খতিয়ান', 'দাগ', 'মৌসুম', 'বিলের টাকা', 'আদায়', 'বিলের তারিখ'],
            ['সাভার', '১২', '১৪৫', '১০২৩', 'বোরো ২০২৫', '3300', '1000', '15/03/2025'],
            ['সাভার', '12', '145', '1023', 'বোরো ২০২৫', '3300', '', ''], // same land + season
        ]), 1, $irrigationOfficer);
        $invoice = Invoice::where('import_batch_id', $dues->id)->firstOrFail();
        $this->assertSame('partial', $invoice->status);
        $this->assertEquals(2300, $invoice->dueAmount());
        $this->assertEquals(2300, $this->ledger('irrigation_receivable'));

        $payments = $this->import('payments', $this->csv([
            ['পুরনো রশিদ নং', 'তারিখ', 'ইনভয়েস নং', 'টাকা'],
            ['৫০১', '20/04/2026', $invoice->invoice_no, '1500'],
            ['৫০২', '21/04/2026', $invoice->invoice_no, '1000'], // more than what is still due
        ]), 1, $irrigationOfficer);
        $this->assertEquals(800, $invoice->fresh()->dueAmount());
        $this->assertTrue(Receipt::where('legacy_no', '501')->firstOrFail()->is_legacy);

        // The dues can't go while a receipt stands on them.
        $this->actingAs($this->admin)->postJson("/api/imports/{$dues->id}/rollback", ['reason' => 'x'])->assertUnprocessable();
        $this->rollback($payments);
        $this->rollback($dues);
        $this->assertSame('cancelled', $invoice->fresh()->status);
        $this->assertEquals(0, $this->ledger('irrigation_receivable'));
    }

    public function test_money_imports_need_the_module_permission(): void
    {
        $dataEntry = $this->userWithRole('data_entry');
        $this->actingAs($dataEntry)->post('/api/imports/savings_opening/upload', ['file' => $this->csv([['সদস্য নং', 'জের'], ['1', '10']])], ['Accept' => 'application/json'])
            ->assertForbidden();
        $this->actingAs($dataEntry)->getJson('/api/imports/types')->assertOk()
            ->assertJsonPath('types.0.allowed', true)->assertJsonPath('types.2.allowed', false);
    }
}
