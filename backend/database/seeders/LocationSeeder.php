<?php

namespace Database\Seeders;

use App\Models\District;
use App\Models\Division;
use Illuminate\Database\Seeder;

/**
 * Seeds the 8 divisions and 64 districts. Upazila, union, village and mouza
 * are added from the Location screen for the society's own working area.
 */
class LocationSeeder extends Seeder
{
    private const DATA = [
        ['ঢাকা', 'Dhaka', [
            ['ঢাকা', 'Dhaka'], ['গাজীপুর', 'Gazipur'], ['নারায়ণগঞ্জ', 'Narayanganj'], ['নরসিংদী', 'Narsingdi'],
            ['মানিকগঞ্জ', 'Manikganj'], ['মুন্সিগঞ্জ', 'Munshiganj'], ['টাঙ্গাইল', 'Tangail'], ['কিশোরগঞ্জ', 'Kishoreganj'],
            ['ফরিদপুর', 'Faridpur'], ['গোপালগঞ্জ', 'Gopalganj'], ['মাদারীপুর', 'Madaripur'], ['রাজবাড়ী', 'Rajbari'],
            ['শরীয়তপুর', 'Shariatpur'],
        ]],
        ['চট্টগ্রাম', 'Chattogram', [
            ['চট্টগ্রাম', 'Chattogram'], ['কক্সবাজার', "Cox's Bazar"], ['রাঙ্গামাটি', 'Rangamati'], ['বান্দরবান', 'Bandarban'],
            ['খাগড়াছড়ি', 'Khagrachhari'], ['কুমিল্লা', 'Cumilla'], ['চাঁদপুর', 'Chandpur'], ['ব্রাহ্মণবাড়িয়া', 'Brahmanbaria'],
            ['নোয়াখালী', 'Noakhali'], ['লক্ষ্মীপুর', 'Lakshmipur'], ['ফেনী', 'Feni'],
        ]],
        ['রাজশাহী', 'Rajshahi', [
            ['রাজশাহী', 'Rajshahi'], ['নাটোর', 'Natore'], ['নওগাঁ', 'Naogaon'], ['চাঁপাইনবাবগঞ্জ', 'Chapainawabganj'],
            ['পাবনা', 'Pabna'], ['সিরাজগঞ্জ', 'Sirajganj'], ['বগুড়া', 'Bogura'], ['জয়পুরহাট', 'Joypurhat'],
        ]],
        ['খুলনা', 'Khulna', [
            ['খুলনা', 'Khulna'], ['বাগেরহাট', 'Bagerhat'], ['সাতক্ষীরা', 'Satkhira'], ['যশোর', 'Jashore'],
            ['ঝিনাইদহ', 'Jhenaidah'], ['মাগুরা', 'Magura'], ['নড়াইল', 'Narail'], ['কুষ্টিয়া', 'Kushtia'],
            ['চুয়াডাঙ্গা', 'Chuadanga'], ['মেহেরপুর', 'Meherpur'],
        ]],
        ['বরিশাল', 'Barishal', [
            ['বরিশাল', 'Barishal'], ['পটুয়াখালী', 'Patuakhali'], ['ভোলা', 'Bhola'], ['পিরোজপুর', 'Pirojpur'],
            ['বরগুনা', 'Barguna'], ['ঝালকাঠি', 'Jhalokati'],
        ]],
        ['সিলেট', 'Sylhet', [
            ['সিলেট', 'Sylhet'], ['মৌলভীবাজার', 'Moulvibazar'], ['হবিগঞ্জ', 'Habiganj'], ['সুনামগঞ্জ', 'Sunamganj'],
        ]],
        ['রংপুর', 'Rangpur', [
            ['রংপুর', 'Rangpur'], ['দিনাজপুর', 'Dinajpur'], ['গাইবান্ধা', 'Gaibandha'], ['কুড়িগ্রাম', 'Kurigram'],
            ['লালমনিরহাট', 'Lalmonirhat'], ['নীলফামারী', 'Nilphamari'], ['পঞ্চগড়', 'Panchagarh'], ['ঠাকুরগাঁও', 'Thakurgaon'],
        ]],
        ['ময়মনসিংহ', 'Mymensingh', [
            ['ময়মনসিংহ', 'Mymensingh'], ['জামালপুর', 'Jamalpur'], ['নেত্রকোনা', 'Netrokona'], ['শেরপুর', 'Sherpur'],
        ]],
    ];

    public function run(): void
    {
        foreach (self::DATA as [$bn, $en, $districts]) {
            $division = Division::firstOrCreate(['name_bn' => $bn], ['name_en' => $en]);
            foreach ($districts as [$dbn, $den]) {
                District::firstOrCreate(['division_id' => $division->id, 'name_bn' => $dbn], ['name_en' => $den]);
            }
        }
        // and every upazila and union of the country
        app(\App\Services\BdLocationImporter::class)->run();
    }
}
