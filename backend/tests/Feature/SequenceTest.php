<?php

namespace Tests\Feature;

use App\Models\Sequence;
use App\Services\SequenceService;
use Database\Seeders\SystemSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SequenceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(SystemSeeder::class);
    }

    public function test_formats_and_increments(): void
    {
        $this->assertSame('F-000001', SequenceService::next('farmer'));
        $this->assertSame('F-000002', SequenceService::next('farmer'));
        $this->assertSame('MA-'.date('Y').'-0001', SequenceService::next('membership_application'));
    }

    public function test_member_number_continues_after_legacy_numbers(): void
    {
        Sequence::where('key', 'member')->update(['next_value' => 10002]);

        $this->assertSame('10002', SequenceService::next('member'));
    }

    public function test_yearly_reset(): void
    {
        Sequence::where('key', 'membership_application')->update(['next_value' => 57, 'current_year' => (int) date('Y') - 1]);

        $this->assertSame('MA-'.date('Y').'-0001', SequenceService::next('membership_application'));
    }
}
