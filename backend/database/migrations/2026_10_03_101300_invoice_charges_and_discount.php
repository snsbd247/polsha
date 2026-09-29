<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An invoice may carry extra charge lines (service charge…) besides the
 * irrigation charge, and a discount; amount stays the final total.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->json('charges')->nullable()->after('rate');
            $table->decimal('discount', 12, 2)->default(0)->after('charges');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn(['charges', 'discount']);
        });
    }
};
