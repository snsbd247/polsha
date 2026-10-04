<?php

namespace Tests\Feature;

use App\Services\BdLocationImporter;
use Illuminate\Support\Facades\DB;

/** The country's places come in without disturbing those already there, and only once. */
class BdLocationImportTest extends Phase2TestCase
{
    public function test_import_keeps_existing_places_and_adds_only_what_is_missing(): void
    {
        $before = ['districts' => DB::table('districts')->count(), 'unions' => DB::table('unions')->count()];
        // already there: the division, and the district spelt with য় as two letters
        $dv = DB::table('divisions')->insertGetId(['name_bn' => 'খুলনা', 'name_en' => 'Khulna', 'is_active' => true]);
        $di = DB::table('districts')->insertGetId(['division_id' => $dv, 'name_bn' => "কুষ্টি\u{09AF}\u{09BC}া", 'name_en' => null, 'is_active' => true]);

        $file = tempnam(sys_get_temp_dir(), 'bd');
        file_put_contents($file, json_encode(['divisions' => [[
            'id' => 4, 'bn' => 'খুলনা', 'en' => 'Khulna', 'districts' => [[
                'id' => 25, 'bn' => "কুষ্টি\u{09DF}া", 'en' => 'Kushtia', 'upazilas' => [[
                    'id' => 1, 'bn' => 'কুমারখালী', 'en' => 'Kumarkhali', 'unions' => [[1, 'চাঁদপুর', 'Chadpur'], [2, 'পান্টি', 'Panti']],
                ]],
            ]],
        ]]], JSON_UNESCAPED_UNICODE));

        $added = app(BdLocationImporter::class)->run($file);
        $this->assertSame(['divisions' => 0, 'districts' => 0, 'upazilas' => 1, 'unions' => 2], $added);
        $this->assertSame($before['districts'] + 1, DB::table('districts')->count()); // only the one inserted above
        $this->assertSame('Kushtia', DB::table('districts')->where('id', $di)->value('name_en')); // an empty English name is filled in
        $this->assertSame($di, (int) DB::table('upazilas')->where('name_bn', 'কুমারখালী')->value('district_id'));

        // a second run finds everything already there
        $this->assertSame(['divisions' => 0, 'districts' => 0, 'upazilas' => 0, 'unions' => 0], app(BdLocationImporter::class)->run($file));
        $this->assertSame($before['unions'] + 2, DB::table('unions')->count());
        @unlink($file);
    }

    public function test_a_new_village_takes_a_mouza_of_its_union_when_a_farmer_is_saved(): void
    {
        $fresh = \App\Models\Village::create(['union_id' => $this->village->union_id, 'name_bn' => 'নতুনপাড়া']);
        $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload(['village_id' => $fresh->id]))->assertCreated();
        $this->assertTrue($this->mouza->villages()->where('villages.id', $fresh->id)->exists());

        // a mouza of another union still does not fit
        $otherUnion = \App\Models\Union::create(['upazila_id' => $this->mouza->upazila_id, 'name_bn' => 'অন্য ইউনিয়ন']);
        $far = \App\Models\Village::create(['union_id' => $otherUnion->id, 'name_bn' => 'দূরের গ্রাম']);
        $this->actingAs($this->officer)->postJson('/api/farmers', $this->farmerPayload(['village_id' => $far->id, 'name_bn' => 'অন্য কৃষক']))
            ->assertStatus(422)->assertJsonValidationErrors('mouza_id');
    }
}
