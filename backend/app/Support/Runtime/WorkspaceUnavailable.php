<?php

namespace App\Support\Runtime;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/** 403 with a fixed code the app recognises: it then opens the license page. */
class WorkspaceUnavailable extends HttpException
{
    public function __construct(public readonly string $reason = 'inactive')
    {
        parent::__construct(403, self::text($reason));
    }

    public static function text(string $reason): string
    {
        return match ($reason) {
            'expired' => __('লাইসেন্সের মেয়াদ শেষ হয়ে গেছে। নবায়ন করে নতুন করে সক্রিয় করুন।'),
            'suspended' => __('লাইসেন্স সাময়িকভাবে স্থগিত করা হয়েছে। সফটওয়্যার সরবরাহকারীর সাথে যোগাযোগ করুন।'),
            'revoked' => __('লাইসেন্স বাতিল করা হয়েছে। সফটওয়্যার সরবরাহকারীর সাথে যোগাযোগ করুন।'),
            'denied' => __('এই ডোমেইনে লাইসেন্স গ্রহণযোগ্য নয়।'),
            'domain' => __('লাইসেন্সটি অন্য ডোমেইনের জন্য সক্রিয় করা।'),
            'tampered' => __('লাইসেন্সের তথ্য মেলেনি। আবার সক্রিয় করুন।'),
            'unverified' => __('অনেক দিন লাইসেন্স সার্ভারের সাথে যোগাযোগ হয়নি। ইন্টারনেট সংযোগ দেখে আবার যাচাই করুন।'),
            default => __('সফটওয়্যারটি এখনো সক্রিয় করা হয়নি। লাইসেন্স কী দিয়ে সক্রিয় করুন।'),
        };
    }

    public function render(Request $request): JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'code' => Continuity::LOCKED, 'reason' => $this->reason], 403);
    }
}
