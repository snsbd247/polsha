<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SmsOtp;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\SmsService;
use App\Support\Bn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * Self-service password reset: a 6-digit code goes by SMS to the user's
 * registered mobile. The response never says whether the account exists.
 */
class PasswordResetController extends Controller
{
    private const MINUTES = 10;

    private const MAX_ATTEMPTS = 5;

    public function __construct(private SmsService $sms) {}

    public function forgot(Request $request): JsonResponse
    {
        $login = trim(Bn::toEnDigits((string) $request->validate(['login' => ['required', 'string', 'max:100']])['login']));
        $user = $this->findUser($login);

        if ($user && $user->is_active && SmsService::normalize($user->mobile)) {
            $recent = SmsOtp::where('user_id', $user->id)->where('purpose', 'password_reset')->where('created_at', '>=', now()->subMinute())->exists();
            if (! $recent) {
                SmsOtp::where('user_id', $user->id)->where('purpose', 'password_reset')->whereNull('used_at')->update(['used_at' => now()]);
                $code = (string) random_int(100000, 999999);
                SmsOtp::create(['user_id' => $user->id, 'purpose' => 'password_reset', 'code_hash' => Hash::make($code), 'expires_at' => now()->addMinutes(self::MINUTES)]);
                $log = $this->sms->queue('otp', $user->mobile, ['code' => $code, 'minutes' => self::MINUTES], $user);
                $log && $this->sms->send($log);
            }
        }

        return response()->json(['message' => __('অ্যাকাউন্টে নিবন্ধিত মোবাইল থাকলে একটি কোড পাঠানো হয়েছে। কোডটি :m মিনিট কার্যকর থাকবে।', ['m' => app()->getLocale() === 'en' ? self::MINUTES : Bn::toBnDigits(self::MINUTES)])]);
    }

    public function reset(Request $request): JsonResponse
    {
        $data = $request->validate([
            'login' => ['required', 'string', 'max:100'],
            'code' => ['required', 'string', 'max:10'],
            'password' => ['required', 'confirmed', Password::min(8)->letters()->numbers()],
        ]);
        $fail = fn () => throw ValidationException::withMessages(['code' => __('কোডটি ভুল বা মেয়াদোত্তীর্ণ।')]);

        $user = $this->findUser(trim(Bn::toEnDigits($data['login'])));
        $otp = $user ? SmsOtp::where('user_id', $user->id)->where('purpose', 'password_reset')->whereNull('used_at')
            ->where('expires_at', '>', now())->latest('id')->first() : null;
        if (! $otp || $otp->attempts >= self::MAX_ATTEMPTS) {
            $fail();
        }
        if (! Hash::check(trim(Bn::toEnDigits($data['code'])), $otp->code_hash)) {
            $otp->increment('attempts');
            $fail();
        }

        $otp->update(['used_at' => now()]);
        $user->forceFill(['password' => $data['password'], 'must_change_password' => false])->saveQuietly();
        $user->tokens()->delete();
        AuditLogger::log('user', 'password_reset', $user, null, null, __('SMS কোড দিয়ে পাসওয়ার্ড রিসেট'), $user->id);

        return response()->json(['message' => __('পাসওয়ার্ড রিসেট হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।')]);
    }

    private function findUser(string $login): ?User
    {
        if ($login === '') {
            return null;
        }
        $user = User::where('username', $login)->first();
        if (! $user && ($mobile = SmsService::normalize($login))) {
            $matches = User::where('mobile', 'like', '%'.substr($mobile, -10))->limit(2)->get();
            $user = $matches->count() === 1 ? $matches->first() : null;
        }

        return $user;
    }
}
