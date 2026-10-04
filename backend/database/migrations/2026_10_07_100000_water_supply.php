<?php

use App\Models\Role;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Household water supply (like a WASA account): connections for anyone in the
 * village, a fixed monthly bill by connection type, collection through the
 * money-receipt engine into its own cash stream "পানির নগদ", and a penalty
 * the collector may add at the counter.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('water_connection_types', function (Blueprint $t) {
            $t->id();
            $t->string('code', 20)->unique();
            $t->string('name_bn', 100);
            $t->string('name_en', 100)->nullable();
            $t->decimal('monthly_fee', 15, 2)->default(0);
            $t->decimal('connection_fee', 15, 2)->default(0);
            $t->boolean('is_active')->default(true);
            $t->unsignedSmallInteger('sort_order')->default(0);
            $t->timestamps();
        });

        Schema::create('water_connections', function (Blueprint $t) {
            $t->id();
            $t->string('connection_no', 30)->unique();
            $t->foreignId('type_id')->constrained('water_connection_types');
            // the customer: anyone in the village, not necessarily a farmer or member
            $t->string('name_bn', 150);
            $t->string('name_en', 150)->nullable();
            $t->string('father_name', 150)->nullable();
            $t->string('mobile', 20)->nullable()->index();
            $t->string('nid', 20)->nullable();
            $t->foreignId('village_id')->nullable()->constrained('villages');
            $t->string('address', 250)->nullable(); // para / house
            // a monthly fee for this connection only; empty → the type's fee
            $t->decimal('monthly_fee', 15, 2)->nullable();
            $t->date('connected_on');
            $t->string('status', 20)->default('active')->index(); // active | disconnected | closed
            $t->date('status_date')->nullable();
            $t->string('status_reason', 300)->nullable();
            $t->string('remarks', 500)->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users');
            $t->timestamps();
        });

        Schema::create('water_bills', function (Blueprint $t) {
            $t->id();
            $t->string('bill_no', 30)->unique();
            $t->foreignId('connection_id')->constrained('water_connections');
            $t->string('kind', 20)->default('monthly'); // monthly | connection | reconnection
            $t->char('period', 7)->nullable()->index(); // YYYY-MM for monthly bills
            $t->date('bill_date');
            $t->date('due_date')->nullable();
            $t->decimal('amount', 15, 2);
            $t->decimal('penalty', 15, 2)->default(0);
            $t->decimal('paid_amount', 15, 2)->default(0);
            $t->string('status', 20)->default('unpaid')->index(); // unpaid | partial | paid | cancelled
            $t->json('snapshot')->nullable();
            $t->foreignId('journal_id')->nullable()->constrained('journals');
            $t->foreignId('created_by')->nullable()->constrained('users');
            $t->timestamp('cancelled_at')->nullable();
            $t->foreignId('cancelled_by')->nullable()->constrained('users');
            $t->string('cancel_reason', 300)->nullable();
            $t->timestamps();
            $t->index(['connection_id', 'period']);
        });

        // a penalty added at the counter; undone with the receipt it came with
        Schema::create('water_bill_penalties', function (Blueprint $t) {
            $t->id();
            $t->foreignId('bill_id')->constrained('water_bills');
            $t->foreignId('receipt_id')->nullable()->constrained('receipts');
            $t->date('date');
            $t->decimal('amount', 15, 2);
            $t->foreignId('journal_id')->nullable()->constrained('journals');
            $t->timestamp('reversed_at')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users');
            $t->timestamps();
        });

        // [code, key, name_bn, name_en, type, parent key]
        $accounts = [
            ['1115', 'cash_water', 'পানির নগদ', 'Water Supply Cash', 'asset', 'cash_in_hand'],
            ['1340', 'water_receivable', 'পানির বিল পাওনা', 'Water Bill Receivable', 'asset', null],
            ['4600', 'water_income', 'পানির বিল আয়', 'Water Bill Income', 'income', null],
            ['4610', 'water_penalty_income', 'পানির বিলের জরিমানা আয়', 'Water Bill Penalty Income', 'income', null],
            ['4620', 'water_connection_fee_income', 'পানির সংযোগ ফি আয়', 'Water Connection Fee Income', 'income', null],
        ];
        $parentByCode = ['1340' => '1300', '4600' => '4000', '4610' => '4000', '4620' => '4000'];
        foreach ($accounts as [$code, $key, $bn, $en, $type, $parentKey]) {
            if (DB::table('chart_of_accounts')->where('key', $key)->exists()) {
                continue;
            }
            $parentId = $parentKey
                ? DB::table('chart_of_accounts')->where('key', $parentKey)->value('id')
                : DB::table('chart_of_accounts')->where('code', $parentByCode[$code])->value('id');
            // someone may already have used the code for a hand-made account
            while (DB::table('chart_of_accounts')->where('code', $code)->exists()) {
                $code = (string) ((int) $code + 1);
            }
            DB::table('chart_of_accounts')->insert([
                'key' => $key, 'code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'type' => $type, 'parent_id' => $parentId,
                'is_postable' => true, 'is_system' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        foreach ([['water_connection', 'পানির সংযোগ', 'WC-', 6, false], ['water_bill', 'পানির বিল', 'WB-{YYYY}-', 6, true]] as [$key, $label, $prefix, $pad, $yearly]) {
            if (DB::table('sequences')->where('key', $key)->doesntExist()) {
                DB::table('sequences')->insert([
                    'key' => $key, 'label' => $label, 'prefix' => $prefix, 'pad_length' => $pad, 'next_value' => 1,
                    'reset_yearly' => $yearly, 'current_year' => (int) date('Y'), 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        if (DB::table('approval_rules')->where('action_key', 'water.bill_cancel')->doesntExist()) {
            DB::table('approval_rules')->insert([
                'action_key' => 'water.bill_cancel', 'module' => 'water', 'label' => 'পানির বিল বাতিল',
                'steps' => json_encode([['manager']]), 'enabled' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        // the three usual connection types; the society sets the fees before the first bill
        if (DB::table('water_connection_types')->doesntExist()) {
            foreach ([['RES', 'আবাসিক', 'Residential'], ['COM', 'বাণিজ্যিক', 'Commercial'], ['INS', 'প্রাতিষ্ঠানিক', 'Institutional']] as $i => [$code, $bn, $en]) {
                DB::table('water_connection_types')->insert([
                    'code' => $code, 'name_bn' => $bn, 'name_en' => $en, 'monthly_fee' => 0, 'connection_fee' => 0,
                    'is_active' => true, 'sort_order' => $i + 1, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        // permissions: water.* ; on a fresh install the role seeder does this
        if (DB::table('roles')->exists()) {
            app(PermissionRegistrar::class)->forgetCachedPermissions();
            foreach (array_keys(config('erp.actions')) as $a) {
                Permission::findOrCreate("water.$a", 'web');
            }
            // an earlier migration may have made a role before the seeder made the permissions
            Permission::findOrCreate('report.view', 'web');
            $role = Role::firstOrCreate(['name' => 'water_officer', 'guard_name' => 'web']);
            $role->update(config('erp.roles.water_officer') + ['is_system' => true]);
            $role->givePermissionTo(['water.view', 'water.create', 'water.edit', 'water.export', 'report.view']);
            $grant = [
                'manager' => ['water.view', 'water.create', 'water.edit', 'water.export', 'water.approve', 'water.admin'],
                'president' => ['water.view', 'water.export', 'water.approve'],
                'admin' => ['water.view', 'water.export', 'water.admin'],
                'accountant' => ['water.view', 'water.export'],
                'cashier' => ['water.view', 'water.create'],
                'auditor' => ['water.view', 'water.export'],
            ];
            foreach ($grant as $name => $perms) {
                Role::where('name', $name)->first()?->givePermissionTo($perms);
            }
            app(PermissionRegistrar::class)->forgetCachedPermissions();
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('water_bill_penalties');
        Schema::dropIfExists('water_bills');
        Schema::dropIfExists('water_connections');
        Schema::dropIfExists('water_connection_types');
        DB::table('approval_rules')->where('action_key', 'water.bill_cancel')->delete();
        DB::table('sequences')->whereIn('key', ['water_connection', 'water_bill'])->delete();
    }
};
