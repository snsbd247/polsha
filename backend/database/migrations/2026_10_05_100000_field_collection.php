<?php

use App\Models\Role;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Field collection: a field collector takes money at the farmer's door on a
 * phone. It is held as "cash with field collectors" until the collector
 * hands it in at the office, when it moves to the society's cash streams.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('field_deposits', function (Blueprint $t) {
            $t->id();
            $t->string('deposit_no', 30)->unique();
            $t->foreignId('collector_id')->constrained('users');
            $t->date('date');
            $t->decimal('amount', 15, 2);
            $t->unsignedInteger('payments_count')->default(0);
            $t->json('parts')->nullable(); // cash account key => amount
            $t->foreignId('journal_id')->nullable()->constrained('journals');
            $t->string('note', 500)->nullable();
            $t->foreignId('received_by')->nullable()->constrained('users');
            $t->timestamps();
        });
        Schema::table('combined_payments', function (Blueprint $t) {
            $t->foreignId('field_collector_id')->nullable()->after('created_by')->constrained('users');
            $t->foreignId('field_deposit_id')->nullable()->after('field_collector_id')->constrained('field_deposits');
        });

        if (DB::table('chart_of_accounts')->where('key', 'cash_field')->doesntExist()) {
            $code = '1114';
            while (DB::table('chart_of_accounts')->where('code', $code)->exists()) {
                $code = (string) ((int) $code + 1);
            }
            DB::table('chart_of_accounts')->insert([
                'key' => 'cash_field', 'code' => $code, 'name_bn' => 'মাঠকর্মীর হাতে নগদ (জমা বাকি)', 'name_en' => 'Cash with field collectors',
                'type' => 'asset', 'parent_id' => DB::table('chart_of_accounts')->where('key', 'cash_in_hand')->value('id'),
                'is_postable' => true, 'is_system' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        if (DB::table('sequences')->where('key', 'field_deposit')->doesntExist()) {
            DB::table('sequences')->insert([
                'key' => 'field_deposit', 'label' => 'মাঠ-আদায় জমা', 'prefix' => 'FD-{YYYY}-', 'pad_length' => 5,
                'next_value' => 1, 'reset_yearly' => true, 'current_year' => (int) date('Y'), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        // permissions: field.* ; the new role collects, the office receives the money
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        foreach (array_keys(config('erp.actions')) as $a) {
            Permission::findOrCreate("field.$a", 'web');
        }
        $role = Role::firstOrCreate(['name' => 'field_collector', 'guard_name' => 'web']);
        $role->update(config('erp.roles.field_collector') + ['is_system' => true]);
        $role->givePermissionTo(['field.view', 'field.create']);
        foreach (['cashier' => ['field.view', 'field.approve'], 'accountant' => ['field.view', 'field.approve'], 'manager' => ['field.view', 'field.approve', 'field.export'],
            'president' => ['field.view'], 'admin' => ['field.view'], 'auditor' => ['field.view']] as $name => $perms) {
            Role::where('name', $name)->first()?->givePermissionTo($perms);
        }
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        Schema::table('combined_payments', function (Blueprint $t) {
            $t->dropConstrainedForeignId('field_deposit_id');
            $t->dropConstrainedForeignId('field_collector_id');
        });
        Schema::dropIfExists('field_deposits');
    }
};
