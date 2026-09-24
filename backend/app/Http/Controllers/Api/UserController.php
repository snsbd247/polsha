<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\AuditLogger;
use App\Support\Bn;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = User::query()->with('roles:id,name,label');

        if ($search = trim((string) $request->query('search'))) {
            $s = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('name_bn', 'like', "%$search%")
                ->orWhere('name_en', 'like', "%$search%")
                ->orWhere('username', 'like', "%$s%")
                ->orWhere('mobile', 'like', "%$s%"));
        }
        if ($role = $request->query('role')) {
            $q->role($role);
        }
        if ($request->filled('is_active')) {
            $q->where('is_active', $request->boolean('is_active'));
        }

        $sort = in_array($request->query('sort'), ['name_bn', 'username', 'last_login_at', 'created_at'], true) ? $request->query('sort') : 'id';
        $q->orderBy($sort, $request->query('order') === 'asc' ? 'asc' : 'desc');

        return response()->json($q->paginate($this->perPage($request))->through(fn ($u) => $this->row($u)));
    }

    public function show(User $user): JsonResponse
    {
        return response()->json($this->row($user->load('roles:id,name,label')));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);

        $user = DB::transaction(function () use ($data) {
            $user = User::create($data + ['must_change_password' => $data['must_change_password'] ?? true]);
            $user->syncRoles($data['roles']);

            return $user;
        });

        return response()->json($this->row($user->load('roles')), 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $this->validated($request, $user);

        if ($user->id === $request->user()->id && array_key_exists('is_active', $data) && ! $data['is_active']) {
            throw ValidationException::withMessages(['is_active' => __('নিজের অ্যাকাউন্ট নিষ্ক্রিয় করা যাবে না।')]);
        }

        DB::transaction(function () use ($user, $data) {
            unset($data['password']);
            $before = $user->roles->pluck('name')->sort()->values()->all();
            $user->update($data);
            $user->syncRoles($data['roles']);
            $after = collect($data['roles'])->sort()->values()->all();
            if ($before !== $after) {
                AuditLogger::log('user', 'roles_change', $user, ['roles' => $before], ['roles' => $after]);
            }
        });

        return response()->json($this->row($user->fresh('roles')));
    }

    public function toggleActive(Request $request, User $user): JsonResponse
    {
        if ($user->id === $request->user()->id) {
            throw ValidationException::withMessages(['is_active' => __('নিজের অ্যাকাউন্ট নিষ্ক্রিয় করা যাবে না।')]);
        }
        $user->update(['is_active' => ! $user->is_active]);
        if (! $user->is_active) {
            $user->tokens()->delete();
        }

        return response()->json($this->row($user->load('roles')));
    }

    public function resetPassword(Request $request, User $user): JsonResponse
    {
        $data = $request->validate(['password' => ['required', Password::min(8)->letters()->numbers()]]);

        $user->forceFill([
            'password' => $data['password'],
            'must_change_password' => true,
            'failed_attempts' => 0,
            'locked_until' => null,
        ])->saveQuietly();
        $user->tokens()->delete();
        AuditLogger::log('user', 'password_reset', $user);

        return response()->json(['message' => __('পাসওয়ার্ড রিসেট হয়েছে। পরবর্তী লগইনে ইউজারকে নতুন পাসওয়ার্ড দিতে হবে।')]);
    }

    public function forceLogout(User $user): JsonResponse
    {
        $user->tokens()->delete();
        AuditLogger::log('user', 'force_logout', $user);

        return response()->json(['message' => __('ইউজারকে সব ডিভাইস থেকে লগআউট করা হয়েছে।')]);
    }

    public function loginLogs(Request $request, User $user): JsonResponse
    {
        return response()->json($user->loginLogs()->latest('created_at')->paginate($this->perPage($request)));
    }

    public function activity(Request $request, User $user): JsonResponse
    {
        abort_unless($request->user()->can('audit.view'), 403);

        return response()->json(AuditLog::where('user_id', $user->id)->latest('id')->paginate($this->perPage($request)));
    }

    public function photo(User $user)
    {
        abort_unless($user->photo && Storage::disk('local')->exists($user->photo), 404);

        return Storage::disk('local')->response($user->photo);
    }

    private function validated(Request $request, ?User $user = null): array
    {
        $request->merge([
            'mobile' => Bn::toEnDigits($request->input('mobile')),
            'username' => Bn::toEnDigits($request->input('username')),
        ]);

        $data = $request->validate([
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'username' => ['required', 'string', 'min:3', 'max:50', 'regex:/^[a-zA-Z0-9._-]+$/', Rule::unique('users')->ignore($user)],
            'mobile' => ['required', 'regex:/^01[3-9]\d{8}$/', Rule::unique('users')->ignore($user)],
            'email' => ['nullable', 'email', 'max:150'],
            'roles' => ['required', 'array', 'min:1'],
            'roles.*' => ['string', 'exists:roles,name'],
            'password' => [$user ? 'prohibited' : 'required', Password::min(8)->letters()->numbers()],
            'must_change_password' => ['boolean'],
            'is_active' => ['boolean'],
        ]);

        // Only a Super Admin may create or remove Super Admins.
        $touchesSuper = in_array('super_admin', $data['roles'], true) || $user?->isSuperAdmin();
        if ($touchesSuper && ! $request->user()->isSuperAdmin()) {
            throw ValidationException::withMessages(['roles' => __('সুপার অ্যাডমিন রোল শুধু সুপার অ্যাডমিন দিতে বা সরাতে পারেন।')]);
        }

        return $data;
    }

    private function row(User $u): array
    {
        return [
            'id' => $u->id,
            'name_bn' => $u->name_bn,
            'name_en' => $u->name_en,
            'username' => $u->username,
            'mobile' => $u->mobile,
            'email' => $u->email,
            'is_active' => $u->is_active,
            'is_locked' => $u->isLocked(),
            'must_change_password' => $u->must_change_password,
            'last_login_at' => $u->last_login_at,
            'created_at' => $u->created_at,
            'photo_url' => $u->photo ? url('api/users/'.$u->id.'/photo') : null,
            'roles' => $u->roles->map(fn ($r) => ['name' => $r->name, 'label' => Tr::label($r->label)])->values(),
        ];
    }
}
