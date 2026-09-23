<?php

/*
| ERP-wide constants. Permission names are "{module}.{action}".
| Modules for later phases are listed now so the permission matrix is
| complete from day one; their screens arrive in their own phases.
*/

return [

    'actions' => [
        'view' => 'দেখা',
        'create' => 'তৈরি',
        'edit' => 'সম্পাদনা',
        'delete' => 'মুছা',
        'approve' => 'অনুমোদন',
        'export' => 'এক্সপোর্ট',
        'admin' => 'অ্যাডমিন',
    ],

    'modules' => [
        // Phase 1
        'user' => 'ইউজার',
        'role' => 'রোল ও অনুমতি',
        'audit' => 'অডিট লগ',
        'approval' => 'অনুমোদন',
        'location' => 'এলাকা',
        'mouza' => 'মৌজা',
        'settings' => 'সেটিংস',
        'backup' => 'ব্যাকআপ',
        // Phase 2
        'farmer' => 'কৃষক',
        'membership' => 'সদস্যপদ আবেদন',
        'member' => 'সদস্য',
        'patwari' => 'পাতওয়ারী',
        // Phase 3+
        'land' => 'জমি',
        'irrigation' => 'সেচ',
        'savings' => 'সঞ্চয়',
        'share' => 'শেয়ার',
        'loan' => 'ঋণ',
        'payment' => 'পেমেন্ট ও রশিদ',
        'cash' => 'ক্যাশ',
        'bank' => 'ব্যাংক',
        'accounting' => 'হিসাব',
        'asset' => 'সম্পদ',
        'report' => 'রিপোর্ট',
        'sms' => 'এসএমএস',
        'import' => 'ইমপোর্ট',
    ],

    'roles' => [
        'super_admin' => ['label' => 'সুপার অ্যাডমিন', 'description' => 'সব ক্ষমতা; পরিবর্তনযোগ্য নয়'],
        'admin' => ['label' => 'অ্যাডমিন', 'description' => 'সিস্টেম ও ইউজার ব্যবস্থাপনা'],
        'president' => ['label' => 'সভাপতি/বোর্ড', 'description' => 'চূড়ান্ত অনুমোদন'],
        'manager' => ['label' => 'ম্যানেজার', 'description' => 'দৈনন্দিন পরিচালনা ও প্রথম ধাপের অনুমোদন'],
        'accountant' => ['label' => 'হিসাবরক্ষক', 'description' => 'হিসাব ও লেজার'],
        'cashier' => ['label' => 'ক্যাশিয়ার', 'description' => 'টাকা গ্রহণ ও প্রদান'],
        'irrigation_officer' => ['label' => 'সেচ কর্মকর্তা', 'description' => 'সেচ ইনভয়েস ও আদায়'],
        'member_officer' => ['label' => 'সদস্য কর্মকর্তা', 'description' => 'কৃষক ও সদস্য ব্যবস্থাপনা'],
        'loan_officer' => ['label' => 'ঋণ কর্মকর্তা', 'description' => 'ঋণ ব্যবস্থাপনা'],
        'asset_officer' => ['label' => 'সম্পদ কর্মকর্তা', 'description' => 'সম্পদ ব্যবস্থাপনা'],
        'auditor' => ['label' => 'অডিটর', 'description' => 'শুধু দেখা ও এক্সপোর্ট'],
        'data_entry' => ['label' => 'ডাটা এন্ট্রি', 'description' => 'তথ্য এন্ট্রি'],
    ],

    'login' => [
        'max_attempts' => 5,
        'lock_minutes' => 15,
        'token_hours' => 12,
        'remember_days' => 30,
    ],

    // action_key => class implementing App\Approvals\ApprovalHandler
    'approval_handlers' => [
        'membership.admit' => App\Approvals\MembershipAdmitHandler::class,
        'member.deactivate' => App\Approvals\MemberStatusHandler::class,
        'member.activate' => App\Approvals\MemberStatusHandler::class,
        'member.cancel' => App\Approvals\MemberStatusHandler::class,
        'member.reactivate' => App\Approvals\MemberStatusHandler::class,
        'farmer.merge' => App\Approvals\FarmerMergeHandler::class,
    ],

    'farmer' => [
        'genders' => ['male' => 'পুরুষ', 'female' => 'মহিলা', 'other' => 'অন্যান্য'],
        'document_types' => [
            'nid_front' => 'NID (সামনে)', 'nid_back' => 'NID (পেছনে)', 'photo' => 'ছবি',
            'land_deed' => 'জমির দলিল', 'other' => 'অন্যান্য',
        ],
        'relations' => [
            'self' => 'নিজে (খানাপ্রধান)', 'spouse' => 'স্বামী/স্ত্রী', 'son' => 'পুত্র', 'daughter' => 'কন্যা',
            'father' => 'পিতা', 'mother' => 'মাতা', 'brother' => 'ভাই', 'sister' => 'বোন', 'other' => 'অন্যান্য',
        ],
        'occupations' => ['farmer' => 'কৃষক', 'business' => 'ব্যবসায়ী', 'service' => 'চাকরিজীবী', 'labour' => 'শ্রমিক', 'housewife' => 'গৃহিণী', 'other' => 'অন্যান্য'],
    ],

    'member' => [
        'cancel_reasons' => ['death' => 'মৃত্যু', 'resignation' => 'পদত্যাগ', 'expulsion' => 'বহিষ্কার', 'other' => 'অন্যান্য'],
    ],

    'backup' => [
        'keep_days' => 30,
        'mysqldump' => env('MYSQLDUMP_PATH', 'mysqldump'),
    ],
];
