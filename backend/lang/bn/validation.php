<?php

/*
| Bangla validation messages for the rules this app uses. Rules not listed
| here fall back to lang/en/validation.php.
*/

$attributes = require __DIR__.'/../attributes.php';

return [
    'accepted' => ':attribute গ্রহণ করতে হবে।',
    'after' => ':attribute অবশ্যই :date-এর পরের তারিখ হতে হবে।',
    'array' => ':attribute একটি তালিকা হতে হবে।',
    'before' => ':attribute অবশ্যই :date-এর আগের তারিখ হতে হবে।',
    'before_or_equal' => ':attribute :date বা তার আগের তারিখ হতে হবে।',
    'between' => [
        'numeric' => ':attribute :min থেকে :max-এর মধ্যে হতে হবে।',
        'string' => ':attribute :min থেকে :max অক্ষরের মধ্যে হতে হবে।',
        'array' => ':attribute-এ :min থেকে :max টি থাকতে হবে।',
        'file' => ':attribute :min থেকে :max কিলোবাইটের মধ্যে হতে হবে।',
    ],
    'boolean' => ':attribute হ্যাঁ বা না হতে হবে।',
    'confirmed' => ':attribute নিশ্চিতকরণ মেলেনি।',
    'date' => ':attribute সঠিক তারিখ নয়।',
    'different' => ':attribute ও :other আলাদা হতে হবে।',
    'digits' => ':attribute :digits অঙ্কের হতে হবে।',
    'email' => ':attribute সঠিক ইমেইল ঠিকানা নয়।',
    'exists' => 'বাছাই করা :attribute সঠিক নয়।',
    'file' => ':attribute একটি ফাইল হতে হবে।',
    'gt' => [
        'numeric' => ':attribute :value-এর বেশি হতে হবে।',
        'string' => ':attribute :value অক্ষরের বেশি হতে হবে।',
        'array' => ':attribute-এ :value টির বেশি থাকতে হবে।',
        'file' => ':attribute :value কিলোবাইটের বেশি হতে হবে।',
    ],
    'image' => ':attribute একটি ছবি হতে হবে।',
    'in' => 'বাছাই করা :attribute সঠিক নয়।',
    'integer' => ':attribute একটি পূর্ণসংখ্যা হতে হবে।',
    'max' => [
        'numeric' => ':attribute :max-এর বেশি হতে পারবে না।',
        'string' => ':attribute :max অক্ষরের বেশি হতে পারবে না।',
        'array' => ':attribute-এ :max টির বেশি থাকতে পারবে না।',
        'file' => ':attribute :max কিলোবাইটের বেশি হতে পারবে না।',
    ],
    'mimes' => ':attribute অবশ্যই এই ধরনের ফাইল হতে হবে: :values।',
    'min' => [
        'numeric' => ':attribute কমপক্ষে :min হতে হবে।',
        'string' => ':attribute কমপক্ষে :min অক্ষরের হতে হবে।',
        'array' => ':attribute-এ কমপক্ষে :min টি থাকতে হবে।',
        'file' => ':attribute কমপক্ষে :min কিলোবাইট হতে হবে।',
    ],
    'numeric' => ':attribute একটি সংখ্যা হতে হবে।',
    'password' => [
        'letters' => ':attribute-এ কমপক্ষে একটি অক্ষর থাকতে হবে।',
        'mixed' => ':attribute-এ বড় ও ছোট হাতের অক্ষর থাকতে হবে।',
        'numbers' => ':attribute-এ কমপক্ষে একটি সংখ্যা থাকতে হবে।',
        'symbols' => ':attribute-এ কমপক্ষে একটি চিহ্ন থাকতে হবে।',
        'uncompromised' => 'এই :attribute ফাঁস হওয়া পাসওয়ার্ডের তালিকায় আছে। অন্য পাসওয়ার্ড দিন।',
    ],
    'present' => ':attribute থাকতে হবে।',
    'prohibited' => ':attribute দেওয়া যাবে না।',
    'regex' => ':attribute-এর গঠন সঠিক নয়।',
    'required' => ':attribute আবশ্যক।',
    'required_if' => ':other :value হলে :attribute আবশ্যক।',
    'required_with' => ':values দিলে :attribute আবশ্যক।',
    'string' => ':attribute লেখা হতে হবে।',
    'unique' => 'এই :attribute আগে থেকেই ব্যবহৃত।',
    'uploaded' => ':attribute আপলোড করা যায়নি।',
    'uuid' => ':attribute সঠিক নয়।',

    'custom' => [],

    'attributes' => $attributes['bn'],
];
