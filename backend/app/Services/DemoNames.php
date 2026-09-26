<?php

namespace App\Services;

/** Bangla names with their English spelling, for demo farmers and relatives. */
class DemoNames
{
    private const MALE_FIRST = [
        ['আব্দুল', 'Abdul'], ['মোহাম্মদ', 'Mohammad'], ['আবুল', 'Abul'], ['নুরুল', 'Nurul'], ['রফিকুল', 'Rafiqul'], ['শফিকুল', 'Shafiqul'],
        ['জাহাঙ্গীর', 'Jahangir'], ['আলমগীর', 'Alamgir'], ['মনির', 'Monir'], ['সেলিম', 'Selim'], ['হারুন', 'Harun'], ['কামাল', 'Kamal'],
        ['জামাল', 'Jamal'], ['আনোয়ার', 'Anwar'], ['মিজানুর', 'Mizanur'], ['আজিজুল', 'Azizul'], ['শাহাবুদ্দিন', 'Shahabuddin'], ['রুহুল', 'Ruhul'],
        ['ফারুক', 'Faruk'], ['মোস্তফা', 'Mostafa'], ['নজরুল', 'Nazrul'], ['বাবুল', 'Babul'], ['হাবিবুর', 'Habibur'], ['আমিনুল', 'Aminul'],
    ];

    private const MALE_LAST = [
        ['করিম', 'Karim'], ['রহমান', 'Rahman'], ['ইসলাম', 'Islam'], ['হোসেন', 'Hossain'], ['আলী', 'Ali'], ['উদ্দিন', 'Uddin'], ['মিয়া', 'Mia'],
        ['হক', 'Haque'], ['কাশেম', 'Kashem'], ['মজিদ', 'Majid'], ['বারী', 'Bari'], ['খালেক', 'Khalek'], ['সরকার', 'Sarkar'], ['মোল্লা', 'Molla'],
        ['শেখ', 'Sheikh'], ['প্রামানিক', 'Pramanik'], ['মন্ডল', 'Mondol'], ['খান', 'Khan'],
    ];

    private const FEMALE = [
        ['রহিমা', 'Rahima'], ['সালমা', 'Salma'], ['আমেনা', 'Amena'], ['রেহানা', 'Rehana'], ['নাসরিন', 'Nasrin'], ['শাহানা', 'Shahana'],
        ['জোহরা', 'Johora'], ['ফাতেমা', 'Fatema'], ['মরিয়ম', 'Moriom'], ['রাশিদা', 'Rashida'], ['হালিমা', 'Halima'], ['কুলসুম', 'Kulsum'],
        ['সুফিয়া', 'Sufia'], ['মাহমুদা', 'Mahmuda'], ['নাজমা', 'Nazma'], ['পারভীন', 'Parvin'], ['শিরিন', 'Shirin'], ['লাইলী', 'Laily'],
    ];

    private const FEMALE_LAST = [['বেগম', 'Begum'], ['খাতুন', 'Khatun'], ['আক্তার', 'Akter'], ['বিবি', 'Bibi']];

    /** @return array{0:string, 1:string} [bangla, english] */
    public static function person(bool $male): array
    {
        if ($male) {
            [$fb, $fe] = self::MALE_FIRST[array_rand(self::MALE_FIRST)];
            [$lb, $le] = self::MALE_LAST[array_rand(self::MALE_LAST)];
            $md = mt_rand(1, 100) <= 60;

            return [($md ? 'মোঃ ' : '').$fb.' '.$lb, ($md ? 'Md. ' : '').$fe.' '.$le];
        }
        [$fb, $fe] = self::FEMALE[array_rand(self::FEMALE)];
        [$lb, $le] = self::FEMALE_LAST[array_rand(self::FEMALE_LAST)];
        $mst = mt_rand(1, 100) <= 50;

        return [($mst ? 'মোছাঃ ' : '').$fb.' '.$lb, ($mst ? 'Mst. ' : '').$fe.' '.$le];
    }
}
