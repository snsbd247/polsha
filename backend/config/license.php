<?php

/*
| Offline license. Keys are signed on the vendor's machine with
| `php artisan license:issue` (private key kept outside the repo);
| only this public key ships with the app.
*/

return [
    // When on, an expired/missing license makes the system read-only (HTTP 423 on writes).
    'enforce' => (bool) env('LICENSE_ENFORCE', false),

    // Warn this many days before expiry.
    'warn_days' => 30,

    'app_version' => '1.0.0',

    'public_key' => env('LICENSE_PUBLIC_KEY', <<<'PEM'
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsZXKe8DDfbn7+i7PK0Mu
AvaY/Gj6Slc7UAl35hAdVejEGBeDJi9yp5gADsJoo8sC22RolPMEyq3apolP98U5
ANY8UI0zBDiJbxGf5KT/qkL/Q/+3Ba2B/bu+0e+tA2m/c8tsiFDt60vBA1UWzNRz
fVk9jsY3epJAd0Am8YXOddbTm3G6ZSqsElRO7bfjSLpz4K6Sfen5egc9Gnqa3Kdg
ABSjM5W8Xav0gGHVZ1ED/afFDfDWmZs7rvhhNDKDTbuNb5hROzX8kz0o07wH07XI
XeCGy702VKh3FI6zRLJfwxfAPirCdZM+fS3QgEArB41RHFJr143wkTLiAzQYrSU4
rQIDAQAB
-----END PUBLIC KEY-----
PEM),
];
