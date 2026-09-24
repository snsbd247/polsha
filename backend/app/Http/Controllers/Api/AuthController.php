<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LoginLog;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\SettingService;
use App\Support\Bn;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:100'],
            'password' => ['required', 'string'],
            'remember' => ['boolean'],
        ]);

        $login = Bn::toEnDigits($data['username']);
        $user = User::where('username', $login)->orWhere('mobile', $login)->first();
        $cfg = config('erp.login');

        $fail = function (string $reason, string $message, int $status = 422) use ($request, $login, $user) {
            $this->logAttempt($request, $login, $user, false, $reason);

            return response()->json(['message' => $message], $status);
        };

        if (! $user) {
            return $fail('unknown_user', __('ইউজারনেম বা পাসওয়ার্ড ভুল।'));
        }
        if ($user->isLocked()) {
            $minutes = (int) ceil(now()->diffInSeconds($user->locked_until) / 60);

            return $fail('locked', __('অনেকবার ভুল পাসওয়ার্ড। :p0 মিনিট পর চেষ্টা করুন।', ['p0' => $minutes]), 423);
        }
        if (! Hash::check($data['password'], $user->password)) {
            $user->failed_attempts++;
            if ($user->failed_attempts >= $cfg['max_attempts']) {
                $user->failed_attempts = 0;
                $user->locked_until = now()->addMinutes($cfg['lock_minutes']);
            }
            $user->saveQuietly();

            return $fail('wrong_password', __('ইউজারনেম বা পাসওয়ার্ড ভুল।'));
        }
        if (! $user->is_active) {
            return $fail('inactive', __('আপনার অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে।'), 403);
        }

        $user->forceFill(['failed_attempts' => 0, 'locked_until' => null, 'last_login_at' => now()])->saveQuietly();
        $this->logAttempt($request, $login, $user, true);

        $expires = ($data['remember'] ?? false) ? now()->addDays($cfg['remember_days']) : now()->addHours($cfg['token_hours']);
        $token = $user->createToken(Str::limit((string) $request->userAgent(), 100, ''), ['*'], $expires);

        return response()->json([
            'token' => $token->plainTextToken,
            'expires_at' => $expires->toIso8601String(),
            'user' => $this->userPayload($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => __('লগআউট হয়েছে।')]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function publicSettings(): JsonResponse
    {
        return response()->json(SettingService::public());
    }

    public function userPayload(User $user): array
    {
        $user->loadMissing('roles');

        return [
            'id' => $user->id,
            'name_bn' => $user->name_bn,
            'name_en' => $user->name_en,
            'username' => $user->username,
            'mobile' => $user->mobile,
            'email' => $user->email,
            'photo_url' => $user->photo ? url('api/users/'.$user->id.'/photo') : null,
            'locale' => $user->locale,
            'must_change_password' => $user->must_change_password,
            'roles' => $user->roles->map(fn ($r) => ['name' => $r->name, 'label' => Tr::label($r->label)])->values(),
            'permissions' => $user->permissionNames(),
            'is_super_admin' => $user->isSuperAdmin(),
        ];
    }

    private function logAttempt(Request $request, string $login, ?User $user, bool $success, ?string $reason = null): void
    {
        LoginLog::create([
            'user_id' => $user?->id,
            'username' => $login,
            'success' => $success,
            'reason' => $reason,
            'ip_address' => $request->ip(),
            'user_agent' => substr((string) $request->userAgent(), 0, 500),
        ]);
        if ($success) {
            AuditLogger::log('user', 'login', $user, null, null, null, $user->id);
        }
    }
}
