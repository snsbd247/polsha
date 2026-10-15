<?php

/*
| Online license, checked against the vendor's license server.
| Every answer from the server is signed (RSA-2048 / SHA-256); only answers
| whose signature verifies against the public key built into the app are kept.
| There is deliberately no setting that turns the check off.
*/

return [
    'server_url' => rtrim((string) env('LICENSE_SERVER_URL', 'https://syncsolutionbd.com/api/v1'), '/'),

    'product_slug' => (string) env('LICENSE_PRODUCT_SLUG', 'irrigation'),

    // Informational: the key that counts is the one built into App\Support\Runtime\TrustAnchor;
    // a different key here is ignored, so swapping it cannot be used to accept forged answers.
    'public_key_pem' => env('LICENSE_PUBLIC_KEY_PEM'),

    // a fresh answer from the server is reused this long before asking again
    'cache_hours' => 6,

    // the server cannot be reached: keep trusting the last signed answer this long
    'offline_days' => 5,

    // after the expiry date the software keeps working this long, asking for renewal
    'grace_days' => 2,

    // warn before the expiry date
    'warn_days' => 3,

    // "Recheck now": once per this many seconds per user
    'recheck_seconds' => 30,

    'app_version' => '1.0.0',
];
