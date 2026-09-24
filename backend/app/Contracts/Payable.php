<?php

namespace App\Contracts;

/**
 * Anything a money receipt can pay off (irrigation invoice now; loan
 * instalment, share money … later). The receipt engine credits
 * creditAccountId() and calls applyPayment()/revertPayment() inside its
 * own transaction.
 */
interface Payable
{
    public function dueAmount(): float;

    public function creditAccountId(): int;

    public function payableLabel(): string;

    public function applyPayment(float $amount): void;

    public function revertPayment(float $amount): void;
}
