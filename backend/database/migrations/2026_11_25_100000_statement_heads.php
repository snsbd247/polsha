<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Heads of the society's receipts & payments statements (জমা-খরচ বিবরণী),
 * one list per fund — society, irrigation, water supply — in the order of
 * the society's own printed statements. Each head gathers the ledger
 * accounts whose money it shows; a head with no account yet (a bank account
 * not entered, say) still prints as an empty line, as on paper.
 *
 * The heads are seeded from the society's 2025-26 statements; every head
 * that no existing account covers gets an account of its own in the chart.
 */
return new class extends Migration
{
    // fund => side => [name, accounts]; accounts: existing keys, or ['new' => type] for an account named after the head; [] = no account yet
    private const HEADS = [
        'society' => [
            'receipt' => [
                ['শেয়ার আদায়', ['share_capital']], ['সঞ্চয় আদায়', ['savings_deposits']], ['ভর্তি ফি আদায়', ['admission_fee_income']],
                ['বিবিধ/স্ট্যাম্প', ['new' => 'income']], ['ঋণ আদায়', ['loans_receivable']], ['সার্ভিস চার্জ', ['loan_interest_income', 'loan_penalty_income']],
                ['ব্যাংক উত্তোলন/৪৪/০১', []], ['ঋণ ফরম বিক্রয়', ['new' => 'income']], ['কন্ট্রিবিউশন ফেরত', ['new' => 'income']],
                ['পাশ বই বিক্রয়', ['new' => 'income']], ['হাওলাত আদায়', ['new' => 'asset']], ['ভর্তি ফরম', ['new' => 'income']],
                ['ব্যাংক কর্তন উত্তোলন/৪৪/১', []], ['কল্যাণ তহবিল', ['new' => 'liability']], ['ব্যাংক উত্তোলন (ucb41)', []],
                ['মনোনয়ন ফরম', ['new' => 'income']], ['আগত তহবিল', ['cash_irrigation', 'cash_water']], ['বিবিধ আদায়', ['other_income']],
                ['ব্যাংক উত্তোলন/২০০', []], ['ব্যাংক উত্তোলন/৭৭', []], ['প্লট বাইনা', ['new' => 'liability']], ['ব্যাংক উত্তোলন/১৩৯', []],
                ['ভিডিও চিত্র', ['new' => 'income']],
            ],
            'payment' => [
                ['দুঃস্থ খাতে ব্যয়', ['new' => 'expense']], ['ব্যাংক জমা/৪৪/০১', []], ['জমি ক্রয়', ['new' => 'fixed']], ['সঞ্চয় ফেরত', ['savings_deposits']],
                ['ঋণ বিতরণ', ['loans_receivable']], ['হিসাবরক্ষকের বেতন', ['new' => 'expense']], ['অডিট সম্মানি', ['new' => 'expense']],
                ['ফটোকপি', ['new' => 'expense']], ['সেরেস্তা খরচ', ['new' => 'expense']], ['যাতায়াত খরচ', ['new' => 'expense']],
                ['সমবায় খরচ', ['new' => 'expense']], ['বৈঠকি ভাতা', ['new' => 'expense']], ['ভ্যাট+চালান', ['new' => 'expense']],
                ['মামলা খরচ', ['new' => 'expense']], ['বিদ্যুৎ বিল', ['new' => 'expense']], ['ঈদ বোনাস', ['new' => 'expense']],
                ['আপ্যায়ন খরচ', ['new' => 'expense']], ['বিজয় দিবস চাঁদা', ['new' => 'expense']], ['শেয়ার ফেরত', ['share_capital']],
                ['ব্যানার তৈরী', ['new' => 'expense']], ['গাছ ক্রয়', ['new' => 'expense']], ['সি.ডি.এফ', ['new' => 'expense']],
                ['অডিট ফি', ['new' => 'expense']], ['অফিস সহকারীর বেতন', ['new' => 'expense']], ['হাওলাত প্রদান', ['@হাওলাত আদায়']],
                ['লভ্যাংশ প্রদান', ['dividend_distribution']], ['সদস্য টি এ ডি এ', ['new' => 'expense']], ['এজিএম খরচ', ['new' => 'expense']],
                ['জলবায়ু টীম আপ্যায়ন', ['new' => 'expense']], ['ওয়াই-ফাই', ['new' => 'expense']], ['লভ্যাংশ প্রদান অবণ্টিত', ['new' => 'liability']],
                ['সেচে দাদন', ['cash_irrigation']], ['ডেকোরেশন', ['new' => 'expense']], ['মোবাইল রিচার্জ', ['new' => 'expense']],
                ['ব্যাংক জমা এনআরবিসি/২০০', []], ['প্রচার খরচ', ['new' => 'expense']], ['কম্পিউটার মেরামত', ['new' => 'expense']],
                ['আদায়কারীর বেতন', ['new' => 'expense']], ['পিএফ জমা (১৭৭৫২)', ['new' => 'expense']], ['পিএফ জমা (১৭৭৫০)', ['new' => 'expense']],
                ['নির্বাচন খরচ', ['new' => 'expense']], ['জমি রেজিস্ট্রি ও জরিপ', ['new' => 'expense']], ['ভিডিও/সাংবাদিক', ['new' => 'expense']],
                ['অফিস খরচ', ['office_expense']], ['ব্যাংক চার্জ', ['bank_charges']], ['সঞ্চয়ের মুনাফা প্রদান', ['savings_profit_expense']], ['বিবিধ খরচ', ['other_expense']],
            ],
        ],
        'irrigation' => [
            'receipt' => [
                ['অনুদান আদায়', ['new' => 'income']], ['সেচ চার্জ আদায় (মৌসুম অনুযায়ী)', ['irrigation_receivable', 'irrigation_income'], 'season'],
                ['আঁখ', ['new' => 'income']], ['ব্যাংক উত্তোলন/৪৮২০', []], ['সবজি হতে আয়', ['new' => 'income']], ['বীজতলা হতে আয়', ['new' => 'income']],
                ['বাগানে পানি বিক্রয়', ['new' => 'income']], ['পুকুরে পানি বিক্রয়', ['new' => 'income']], ['ব্যাংক উত্তোলন/৫০৬০', []],
                ['ব্যাংক উত্তোলন/৫০৫৯', []], ['রক্ষণাবেক্ষণ হতে', ['new' => 'income']], ['ভুট্টা', ['new' => 'income']],
                ['পুরাতন মটর বিক্রয়', ['new' => 'income']], ['পোড়া তার বিক্রয়', ['new' => 'income']], ['পুরাতন পাম্প বিক্রয়', ['new' => 'income']],
                ['ভাংড়ি বিক্রয়', ['new' => 'income']], ['সদস্য অনুদান', ['new' => 'income']], ['হাওলাত সমিতি', ['cash_society', 'cash_misc']],
                ['লেট ফি', ['new' => 'income']], ['ব্যাংক কর্তন উত্তোলন/৪৮২০', []], ['ব্যাংক মুনাফা/৪৮২০', []], ['ব্যাংক মুনাফা/৫০৬০', []],
                ['গমে পানি', ['new' => 'income']], ['ঘাসে পানি', ['new' => 'income']], ['হাওলাত সভাপতি', ['new' => 'liability']],
                ['বিডি ফেরত', ['new' => 'income']], ['পুকুর বিক্রয়', ['new' => 'income']], ['পাইপ খেসারত আদায়', ['new' => 'income']],
                ['কাঁঠাল বিক্রয়', ['new' => 'income']], ['আম+কাঁঠাল বিক্রয়', ['new' => 'income']], ['হাওলাত ওয়াটার', ['cash_water']],
            ],
            'payment' => [
                ['খুচরা যন্ত্রাংশ', ['new' => 'expense']], ['কর্মচারীর বোনাস', ['new' => 'expense']], ['টেকনেশিয়ান খরচ', ['new' => 'expense']],
                ['তাইফুর মিস্ত্রি জিরোপয়েন্ট', ['new' => 'expense']], ['যাতায়াত', ['new' => 'expense']], ['পরিবহন খরচ', ['new' => 'expense']],
                ['আপ্যায়ন খরচ', ['@আপ্যায়ন খরচ']], ['লেবার খরচ', ['new' => 'expense']], ['বকশিস', ['new' => 'expense']],
                ['হাজরা বিদ্যুৎ সংযোগ', ['new' => 'expense']], ['ড্রাইভার ভাতা', ['new' => 'expense']], ['দরজা+জানালা', ['new' => 'expense']],
                ['ব্যাংক জমা/৫০৬০', []], ['প্রচার', ['new' => 'expense']], ['মাঠ ম্যানেজার মোবাইল', ['new' => 'expense']], ['বালি ক্রয়', ['new' => 'expense']],
                ['কম্পিউটার অপারেটরের বেতন', ['new' => 'expense']], ['হাওলাত পরিশোধ সভাপতি', ['@হাওলাত সভাপতি']], ['ডিপ চুক্তি মূল্য', ['new' => 'expense']],
                ['লেবার/মিস্ত্রি খরচ', ['new' => 'expense']], ['রড+সিমেন্ট ক্রয়', ['new' => 'expense']], ['ইট, খোয়া, বালি', ['new' => 'expense']],
                ['আম বকশিস', ['new' => 'expense']], ['ডিপ মিটার রিচার্জ', ['new' => 'expense']], ['ফসল খেসারত', ['new' => 'expense']],
                ['পাইপ ক্রয়', ['new' => 'expense']], ['সাহায্য', ['new' => 'expense']], ['ঘাস মারা বিষ', ['new' => 'expense']], ['মটর বাধা খরচ', ['new' => 'expense']],
                ['চেক গেট', ['new' => 'expense']], ['ফটোকপি', ['@ফটোকপি']], ['মাঠ ম্যানেজারের সম্মানি', ['new' => 'expense']], ['লোড/মিটার ক্রয়', ['new' => 'expense']],
                ['পিএফ জমা (১৭৭৫১)', ['new' => 'expense']], ['ট্রান্সফরমার ক্রয়', ['new' => 'expense']], ['মিটার রিচার্জ', ['new' => 'expense']],
                ['পুকুর লিজ+ডিডি', ['new' => 'expense']], ['সার্ভে খরচ', ['new' => 'expense']], ['তাইফুর মিস্ত্রি', ['new' => 'expense']],
                ['হেডার মিস্ত্রি', ['new' => 'expense']], ['বেড়া বাবদ', ['new' => 'expense']], ['ভেকু বাবদ', ['new' => 'expense']], ['পেঁপে চারা ক্রয়', ['new' => 'expense']],
                ['কুরিয়ার খরচ', ['new' => 'expense']], ['জ্বালানী খরচ', ['new' => 'expense']], ['সমিতিতে হাওলাত ফেরত', ['cash_society', 'cash_misc']],
            ],
        ],
        'water' => [
            'receipt' => [
                ['সংযোগ ফি', ['water_connection_fee_income']], ['মাসিক বিল', ['water_receivable', 'water_income', 'water_penalty_income']],
                ['ব্যাংক উত্তোলন/৯০০৫', []], ['আগত তহবিল', []], ['প্রতিশ্রুতি ফি', ['new' => 'income']], ['সমিতি হতে ধার', ['cash_society', 'cash_misc']],
                ['সেচ হতে আগত', ['cash_irrigation']], ['ব্যাংক কর্তন উত্তোলন', []], ['ব্যাংক মুনাফা', []], ['হাওলাত সমিতি হতে', []],
                ['বিল্ডিং ভিজানো', ['new' => 'income']],
            ],
            'payment' => [
                ['ব্যাংক জমা/৯০০৫', []], ['ড্রাইভারের বেতন', ['new' => 'expense']], ['মিটার রিচার্জ', ['@মিটার রিচার্জ']], ['খুচরা যন্ত্রাংশ', ['@খুচরা যন্ত্রাংশ']],
                ['পাইপ ক্রয়', ['@পাইপ ক্রয়']], ['তার ক্রয়', ['new' => 'expense']], ['প্রভিডেন্ট ফান্ড', ['new' => 'expense']], ['পুকুর লিজ', ['new' => 'expense']],
                ['লেবার খরচ', ['@লেবার খরচ']], ['পাথর+বালি', ['new' => 'expense']], ['সিমেন্ট', ['new' => 'expense']], ['আপ্যায়ন', ['@আপ্যায়ন খরচ']],
                ['নতুন ডিপের খরচ', ['new' => 'expense']], ['টেকনেশিয়ান', ['@টেকনেশিয়ান খরচ']], ['পরিবহন', ['@পরিবহন খরচ']], ['সেচে দাদন', ['cash_irrigation']],
                ['ব্যাংক কর্তন জমা', []], ['ব্যাংক মুনাফা জমা', []], ['সেরেস্তা খরচ', ['@সেরেস্তা খরচ']], ['হাওলাত পরিশোধ', ['cash_society', 'cash_misc']],
                ['ডাসকো ভর্তুকি', ['new' => 'expense']], ['যাতায়াত', ['@যাতায়াত']], ['ডিপ বসানো মিস্ত্রি', ['new' => 'expense']], ['মটর ক্রয়', ['new' => 'expense']],
                ['পানিসেচ খরচ', ['new' => 'expense']], ['লোড ক্রয়', ['new' => 'expense']], ['ব্যানার', ['@ব্যানার তৈরী']], ['এলসিএস-এ দাদন', ['new' => 'expense']],
            ],
        ],
    ];

    // where an account named after a head goes in the chart: type, parent code, code range
    private const NEW = [
        'income' => ['income', '4000', 4701, 4899],
        'expense' => ['expense', '5000', 5601, 5899],
        'liability' => ['liability', '2000', 2301, 2999],
        'asset' => ['asset', '1300', 1351, 1499],
        'fixed' => ['asset', '1500', 1520, 1589],
    ];

    public function up(): void
    {
        Schema::create('statement_heads', function (Blueprint $table) {
            $table->id();
            $table->string('fund', 20);            // society | irrigation | water
            $table->string('side', 10);            // receipt (জমা) | payment (খরচ)
            $table->string('name_bn', 150);
            $table->string('name_en', 150)->nullable();
            $table->string('kind', 20)->nullable(); // season: irrigation collections split by season
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['fund', 'side', 'name_bn']);
            $table->index(['fund', 'side', 'sort_order']);
        });
        Schema::create('statement_head_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('statement_head_id')->constrained('statement_heads')->cascadeOnDelete();
            $table->foreignId('account_id')->constrained('chart_of_accounts')->restrictOnDelete();
            $table->string('fund', 20);
            $table->string('side', 10);
            $table->timestamps();
            // an account's money in one fund and direction shows under one head only
            $table->unique(['fund', 'side', 'account_id']);
        });

        $this->seed();
    }

    private function seed(): void
    {
        $now = now();
        $byKey = DB::table('chart_of_accounts')->whereNotNull('key')->pluck('id', 'key');
        $created = []; // head name => account id (for '@name' reuse)
        $nextCode = [];

        $account = function (string $name, string $kind) use (&$created, &$nextCode, $now) {
            if (isset($created[$name])) {
                return $created[$name];
            }
            if ($id = DB::table('chart_of_accounts')->where('name_bn', $name)->value('id')) {
                return $created[$name] = $id;
            }
            [$type, $parentCode, $from, $to] = self::NEW[$kind];
            $parent = DB::table('chart_of_accounts')->where('code', $parentCode)->value('id');
            $code = $nextCode[$kind] ?? $from;
            while (DB::table('chart_of_accounts')->where('code', (string) $code)->exists()) {
                $code++;
            }
            if ($code > $to) {
                throw new RuntimeException("No free account code for $name");
            }
            $nextCode[$kind] = $code + 1;

            return $created[$name] = DB::table('chart_of_accounts')->insertGetId([
                'code' => (string) $code, 'name_bn' => $name, 'type' => $type, 'parent_id' => $parent,
                'is_postable' => true, 'is_system' => false, 'is_active' => true,
                'description' => 'জমা-খরচ বিবরণীর খাত', 'created_at' => $now, 'updated_at' => $now,
            ]);
        };

        foreach (self::HEADS as $fund => $sides) {
            foreach ($sides as $side => $heads) {
                foreach ($heads as $i => $h) {
                    [$name, $accounts] = $h;
                    $headId = DB::table('statement_heads')->insertGetId([
                        'fund' => $fund, 'side' => $side, 'name_bn' => $name, 'kind' => $h[2] ?? null,
                        'sort_order' => $i + 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                    $ids = [];
                    if (isset($accounts['new'])) {
                        $ids[] = $account($name, $accounts['new']);
                    } else {
                        foreach ($accounts as $a) {
                            $ids[] = str_starts_with($a, '@') ? ($created[substr($a, 1)] ?? null) : ($byKey[$a] ?? null);
                        }
                    }
                    foreach (array_unique(array_filter($ids)) as $accountId) {
                        DB::table('statement_head_accounts')->insertOrIgnore([
                            'statement_head_id' => $headId, 'account_id' => $accountId, 'fund' => $fund, 'side' => $side,
                            'created_at' => $now, 'updated_at' => $now,
                        ]);
                    }
                }
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('statement_head_accounts');
        Schema::dropIfExists('statement_heads');
        // the accounts the seed added stay unless unused
        DB::table('chart_of_accounts')->where('description', 'জমা-খরচ বিবরণীর খাত')
            ->whereNotIn('id', DB::table('journal_lines')->select('account_id'))->delete();
    }
};
