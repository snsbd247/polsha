<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The water bill receipt of the society's paper book carries the customer's
 * ward and a commitment fee (প্রতিশ্রুতি ফি) taken with a new connection.
 * The fee is set per connection type and billed like the connection fee,
 * into its own income account.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('water_connections', function (Blueprint $table) {
            $table->string('ward_no', 10)->nullable()->after('address');
        });
        Schema::table('water_connection_types', function (Blueprint $table) {
            $table->decimal('commitment_fee', 12, 2)->default(0)->after('connection_fee');
        });

        // the account the statement heads seeded for "প্রতিশ্রুতি ফি", or a new one
        if (! DB::table('chart_of_accounts')->where('key', 'water_commitment_fee_income')->exists()) {
            $id = DB::table('chart_of_accounts')->where('name_bn', 'প্রতিশ্রুতি ফি')->whereNull('key')->value('id');
            if ($id) {
                DB::table('chart_of_accounts')->where('id', $id)->update(['key' => 'water_commitment_fee_income', 'updated_at' => now()]);
            } else {
                $code = 4631;
                while (DB::table('chart_of_accounts')->where('code', (string) $code)->exists()) {
                    $code++;
                }
                DB::table('chart_of_accounts')->insert([
                    'key' => 'water_commitment_fee_income', 'code' => (string) $code, 'name_bn' => 'প্রতিশ্রুতি ফি', 'name_en' => 'Water commitment fee',
                    'type' => 'income', 'parent_id' => DB::table('chart_of_accounts')->where('code', '4000')->value('id'),
                    'is_postable' => true, 'is_system' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('water_connection_types', fn (Blueprint $table) => $table->dropColumn('commitment_fee'));
        Schema::table('water_connections', fn (Blueprint $table) => $table->dropColumn('ward_no'));
        DB::table('chart_of_accounts')->where('key', 'water_commitment_fee_income')->update(['key' => null]);
    }
};
