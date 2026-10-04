<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Water bills in every way money comes in: a connection may belong to a
 * registered farmer (so the counter's combined payment and the field
 * collector take its bills too), and an online payment may be for a water
 * connection instead of a farmer (booked as a water receipt).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('water_connections', function (Blueprint $t) {
            $t->foreignId('farmer_id')->nullable()->after('type_id')->constrained('farmers');
            // customers and their old dues brought in from the paper register (Import), so a batch can be rolled back
            $t->foreignId('import_batch_id')->nullable()->constrained('import_batches');
        });
        Schema::table('water_bills', function (Blueprint $t) {
            $t->foreignId('import_batch_id')->nullable()->constrained('import_batches');
        });
        Schema::table('public_payment_requests', function (Blueprint $t) {
            $t->foreignId('water_connection_id')->nullable()->after('farmer_id')->constrained('water_connections');
            $t->foreignId('receipt_id')->nullable()->after('combined_payment_id')->constrained('receipts');
        });

        // SMS: the month's bill when it is made, and a reminder before the bill is due
        $templates = [
            ['water_bill', 'পানির বিল', 'Water bill',
                '{name}, সংযোগ {connection_no}-এর {month} মাসের পানির বিল {amount} টাকা। মোট বকেয়া {total_due} টাকা, শেষ তারিখ {due_date}। — {society}',
                ['name', 'connection_no', 'month', 'amount', 'total_due', 'due_date', 'society']],
            ['water_due', 'পানির বিল বকেয়া স্মরণ', 'Water bill reminder',
                '{name}, সংযোগ {connection_no}-এ পানির বিল {amount} টাকা বকেয়া, শেষ তারিখ {due_date}। সময়মতো পরিশোধ করুন। — {society}',
                ['name', 'connection_no', 'amount', 'due_date', 'society']],
        ];
        foreach ($templates as [$key, $bn, $en, $body, $vars]) {
            if (DB::table('sms_templates')->where('key', $key)->doesntExist()) {
                DB::table('sms_templates')->insert([
                    'key' => $key, 'name_bn' => $bn, 'name_en' => $en, 'body' => $body, 'variables' => json_encode($vars),
                    'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }

        // water joins the dues a combined payment settles, after the ones already set
        $order = json_decode((string) DB::table('settings')->where('key', 'combined_payment_order')->value('value'), true);
        if (is_array($order) && ! in_array('water', $order, true)) {
            DB::table('settings')->where('key', 'combined_payment_order')->update(['value' => json_encode([...$order, 'water'])]);
        }
    }

    public function down(): void
    {
        Schema::table('public_payment_requests', function (Blueprint $t) {
            $t->dropConstrainedForeignId('receipt_id');
            $t->dropConstrainedForeignId('water_connection_id');
        });
        Schema::table('water_bills', function (Blueprint $t) {
            $t->dropConstrainedForeignId('import_batch_id');
        });
        Schema::table('water_connections', function (Blueprint $t) {
            $t->dropConstrainedForeignId('import_batch_id');
            $t->dropConstrainedForeignId('farmer_id');
        });
    }
};
