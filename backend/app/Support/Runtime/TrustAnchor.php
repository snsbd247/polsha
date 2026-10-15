<?php

namespace App\Support\Runtime;

/**
 * Checks signed answers from the vendor's service. The public key is built in:
 * a key from the environment is used only when it is this same key, so it cannot
 * be swapped for one whose private half someone else holds.
 */
class TrustAnchor
{
    public const VENDOR_PEM = <<<'PEM'
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwVlQsO1Dy4wp0LoIwdjj
YJrzsBbnj3QvvhoLMo608U68YX5WduNh2dOpSF27+vSMq+vC58G3+YoLtN87qm3h
T6PkY/BlKQDpzzCGPdUJob9k/bQvJRKuK2GOXTfZq3uR5BNQW2pS5ZWBbF7+8+H/
ut6bPHkVlhuxSarW0DirSXNBrsbhb5ar0dlBDPk3Em9FVySOvxv1SiijVfzSuT/4
Fd/inJFuhnrgAhTNUsLEQH9jC9PnA6sGDNfSRUtnrrIscZaVg/kWNgJupsmmIl5i
+cQv2QBv4HTCC1n2AmKOwBMR8Up3t0ue3EVsxhUxqkAN9af4rIG38tAcWQ+ElvK0
yQIDAQAB
-----END PUBLIC KEY-----
PEM;

    private string $pem;

    /** $pem is for the test suite only (bound in the container); the app always resolves the built-in key. */
    public function __construct(?string $pem = null)
    {
        $this->pem = $pem ?? self::VENDOR_PEM;
    }

    /** RSA-SHA256 over the plain text, signature base64-encoded. */
    public function accepts(string $text, ?string $signatureB64): bool
    {
        if (! $signatureB64) {
            return false;
        }
        $sig = base64_decode($signatureB64, true);
        $key = openssl_pkey_get_public($this->pem);

        return $sig !== false && $key !== false && openssl_verify($text, $sig, $key, OPENSSL_ALGO_SHA256) === 1;
    }
}
