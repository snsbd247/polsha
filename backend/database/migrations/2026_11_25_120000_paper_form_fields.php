<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fields the society's printed forms ask for that the software did not keep:
 * a farmer's marital status and secondary occupation (membership form),
 * the applicant's wetland and family income (membership form), a family
 * guarantor who need not be a member and the loan form fee (loan forms).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('farmers', function (Blueprint $table) {
            $table->string('marital_status', 20)->nullable()->after('spouse_name');
            $table->string('secondary_occupation', 50)->nullable()->after('occupation');
        });
        Schema::table('membership_applications', function (Blueprint $table) {
            $table->decimal('wetland_own_decimal', 12, 4)->nullable()->after('initial_shares');
            $table->decimal('wetland_used_decimal', 12, 4)->nullable()->after('wetland_own_decimal');
            $table->decimal('annual_income', 15, 2)->nullable()->after('wetland_used_decimal');
        });
        Schema::table('loans', function (Blueprint $table) {
            $table->json('family_guarantor')->nullable()->after('purpose');
            $table->decimal('form_fee', 12, 2)->default(0)->after('family_guarantor');
            $table->foreignId('form_fee_journal_id')->nullable()->after('form_fee')->constrained('journals')->nullOnDelete();
        });

        // the loan form fee goes to the "ঋণ ফরম বিক্রয়" income the statement heads seeded
        if (! DB::table('chart_of_accounts')->where('key', 'loan_form_income')->exists()) {
            $id = DB::table('chart_of_accounts')->where('name_bn', 'ঋণ ফরম বিক্রয়')->whereNull('key')->value('id');
            if ($id) {
                DB::table('chart_of_accounts')->where('id', $id)->update(['key' => 'loan_form_income', 'updated_at' => now()]);
            } else {
                $code = 4731;
                while (DB::table('chart_of_accounts')->where('code', (string) $code)->exists()) {
                    $code++;
                }
                DB::table('chart_of_accounts')->insert([
                    'key' => 'loan_form_income', 'code' => (string) $code, 'name_bn' => 'ঋণ ফরম বিক্রয়', 'name_en' => 'Loan form sale',
                    'type' => 'income', 'parent_id' => DB::table('chart_of_accounts')->where('code', '4000')->value('id'),
                    'is_postable' => true, 'is_system' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('loans', function (Blueprint $table) {
            $table->dropConstrainedForeignId('form_fee_journal_id');
            $table->dropColumn(['family_guarantor', 'form_fee']);
        });
        Schema::table('membership_applications', fn (Blueprint $table) => $table->dropColumn(['wetland_own_decimal', 'wetland_used_decimal', 'annual_income']));
        Schema::table('farmers', fn (Blueprint $table) => $table->dropColumn(['marital_status', 'secondary_occupation']));
        DB::table('chart_of_accounts')->where('key', 'loan_form_income')->update(['key' => null]);
    }
};
