<?php

namespace Tests\Feature;

use App\Models\ApprovalRule;
use App\Models\User;
use App\Services\ApprovalService;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Tests\Support\FakeApprovalHandler;
use Tests\TestCase;

class ApprovalTest extends TestCase
{
    use RefreshDatabase;

    private User $maker;

    private User $manager;

    private User $president;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        config(['erp.approval_handlers' => config('erp.approval_handlers') + ['test.action' => FakeApprovalHandler::class]]);
        FakeApprovalHandler::$calls = [];

        ApprovalRule::create([
            'action_key' => 'test.action', 'module' => 'member', 'label' => 'Test',
            'enabled' => true, 'steps' => [['manager'], ['president']],
        ]);

        $this->maker = User::factory()->create();
        $this->maker->assignRole('manager');
        $this->manager = User::factory()->create();
        $this->manager->assignRole('manager');
        $this->president = User::factory()->create();
        $this->president->assignRole('president');
    }

    private function submit()
    {
        $this->actingAs($this->maker);

        return app(ApprovalService::class)->submit('test.action', 'Test request', null, ['x' => 1]);
    }

    public function test_two_step_approval_runs_handler_only_at_the_end(): void
    {
        $req = $this->submit();
        $this->assertSame('pending', $req->status);

        $this->actingAs($this->manager)->postJson("/api/approvals/{$req->id}/decide", ['decision' => 'approve'])->assertOk();
        $this->assertSame(2, $req->fresh()->current_step);
        $this->assertSame([], FakeApprovalHandler::$calls);

        // The manager may not act on the president's step.
        $this->actingAs($this->manager)->postJson("/api/approvals/{$req->id}/decide", ['decision' => 'approve'])->assertStatus(422);

        $this->actingAs($this->president)->postJson("/api/approvals/{$req->id}/decide", ['decision' => 'approve'])->assertOk();
        $this->assertSame('approved', $req->fresh()->status);
        $this->assertSame([['approved', $req->id]], FakeApprovalHandler::$calls);
    }

    public function test_maker_cannot_approve_own_request(): void
    {
        $req = $this->submit();

        $this->expectException(ValidationException::class);
        app(ApprovalService::class)->act($req, $this->maker, 'approve');
    }

    public function test_reject_requires_remarks(): void
    {
        $req = $this->submit();

        $this->actingAs($this->manager)->postJson("/api/approvals/{$req->id}/decide", ['decision' => 'reject'])
            ->assertStatus(422)->assertJsonValidationErrors('remarks');
        $this->actingAs($this->manager)->postJson("/api/approvals/{$req->id}/decide", ['decision' => 'reject', 'remarks' => 'কাগজ অসম্পূর্ণ'])
            ->assertOk();
        $this->assertSame([['rejected', $req->id]], FakeApprovalHandler::$calls);
    }

    public function test_inbox_shows_only_requests_for_my_step(): void
    {
        $this->submit();

        $this->actingAs($this->manager)->getJson('/api/approvals/pending-count')->assertJson(['count' => 1]);
        $this->actingAs($this->president)->getJson('/api/approvals/pending-count')->assertJson(['count' => 0]);
        $this->actingAs($this->maker)->getJson('/api/approvals/pending-count')->assertJson(['count' => 0]);

        // the inbox cards: the manager has one waiting, the maker sent one that is still pending
        $this->actingAs($this->manager)->getJson('/api/approvals')->assertJsonPath('counts.mine', 1)->assertJsonCount(1, 'data');
        $this->actingAs($this->maker)->getJson('/api/approvals?tab=sent')->assertJsonPath('counts.sent_pending', 1)->assertJsonPath('counts.mine', 0);
    }

    public function test_disabled_rule_auto_approves(): void
    {
        ApprovalRule::where('action_key', 'test.action')->update(['enabled' => false]);
        $req = $this->submit();

        $this->assertSame('approved', $req->status);
        $this->assertSame([['approved', $req->id]], FakeApprovalHandler::$calls);
    }
}
