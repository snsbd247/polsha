<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class ProfileController extends Controller
{
    public function update(Request $request, AuthController $auth): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'email' => ['nullable', 'email', 'max:150'],
            'locale' => ['in:bn,en'],
            'photo' => ['nullable', 'image', 'max:2048'],
        ]);

        if ($request->hasFile('photo')) {
            if ($user->photo) {
                Storage::disk('local')->delete($user->photo);
            }
            $data['photo'] = $request->file('photo')->store('users', 'local');
        } else {
            unset($data['photo']);
        }
        $user->update($data);

        return response()->json(['user' => $auth->userPayload($user)]);
    }

    public function changePassword(Request $request, AuthController $auth): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'confirmed', Password::min(8)->letters()->numbers()],
        ]);

        if (! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages(['current_password' => 'বর্তমান পাসওয়ার্ড ভুল।']);
        }
        if (Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['password' => 'নতুন পাসওয়ার্ড পুরোনোটির মতো হতে পারবে না।']);
        }

        $user->forceFill(['password' => $data['password'], 'must_change_password' => false])->saveQuietly();
        // Keep this session, sign out everywhere else.
        $user->tokens()->where('id', '!=', $user->currentAccessToken()->id)->delete();
        AuditLogger::log('user', 'password_change', $user);

        return response()->json(['message' => 'পাসওয়ার্ড পরিবর্তন হয়েছে।', 'user' => $auth->userPayload($user)]);
    }

    public function logoutAll(Request $request): JsonResponse
    {
        $request->user()->tokens()->delete();
        AuditLogger::log('user', 'logout_all', $request->user());

        return response()->json(['message' => 'সব ডিভাইস থেকে লগআউট হয়েছে।']);
    }
}
