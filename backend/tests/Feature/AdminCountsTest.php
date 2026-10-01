<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\ImportBatch;
use App\Models\ReceiptBook;
use App\Models\User;

/** The summary counts the admin / audit / import list pages show as cards. */
class AdminCountsTest extends Phase2TestCase
{
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->userWithRole('super_admin');
    }

    public function test_user_list_counts_active_locked_and_todays_logins(): void
    {
        $other = $this->userWithRole('cashier');
        $other->forceFill(['is_active' => false, 'locked_until' => now()->addHour()])->save();
        $this->admin->forceFill(['last_login_at' => now()])->save();

        $c = $this->actingAs($this->admin)->getJson('/api/users')->assertOk()->json('counts');
        $this->assertSame(User::count(), $c['total']);
        $this->assertSame(User::where('is_active', true)->count(), $c['active']);
        $this->assertSame(1, $c['locked']);
        $this->assertGreaterThanOrEqual(1, $c['today']);
    }

    public function test_audit_log_counts_todays_entries_and_deletions(): void
    {
        AuditLog::create(['user_id' => $this->admin->id, 'module' => 'farmer', 'action' => 'delete', 'auditable_type' => 'Farmer', 'auditable_id' => 1]);
        AuditLog::create(['user_id' => $this->admin->id, 'module' => 'farmer', 'action' => 'create', 'auditable_type' => 'Farmer', 'auditable_id' => 2]);

        $c = $this->actingAs($this->admin)->getJson('/api/audit-logs')->assertOk()->json('counts');
        $this->assertSame(AuditLog::count(), $c['total']);
        $this->assertGreaterThanOrEqual(2, $c['today']);
        $this->assertSame(1, $c['deletes_today']);
        $this->assertSame(1, $c['users_today']);
    }

    public function test_scan_import_and_receipt_book_lists_carry_their_cards(): void
    {
        $this->actingAs($this->admin)->postJson('/api/integrity-scans')->assertSuccessful();
        $scans = $this->actingAs($this->admin)->getJson('/api/integrity-scans')->assertOk();
        $this->assertSame(1, $scans->json('counts.total'));
        $this->assertNotNull($scans->json('latest.id'));

        ImportBatch::create(['type' => 'farmers', 'filename' => 'a.csv', 'status' => 'completed', 'total_rows' => 5, 'imported_rows' => 4, 'skipped_rows' => 1, 'created_by' => $this->admin->id]);
        $this->actingAs($this->admin)->getJson('/api/imports')->assertOk()
            ->assertJsonPath('counts.total', 1)->assertJsonPath('counts.imported_rows', 4)->assertJsonPath('counts.skipped_rows', 1)->assertJsonPath('counts.rollback_pending', 0);

        ReceiptBook::create(['book_no' => 'B-1', 'start_no' => 1, 'end_no' => 50, 'status' => 'issued']);
        $this->actingAs($this->admin)->getJson('/api/receipt-books')->assertOk()->assertJsonPath('status_counts.issued', 1);
    }
}
