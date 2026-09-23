<?php

use App\Http\Controllers\Api\ApprovalController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\LocationController;
use App\Http\Controllers\Api\MouzaController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

// ---- Public ----
Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::get('public/settings', [AuthController::class, 'publicSettings']);
Route::get('public/logo', [SettingController::class, 'logo']);

// ---- Authenticated ----
Route::middleware(['auth:sanctum', 'usable'])->group(function () {
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::get('me', [AuthController::class, 'me']);
    Route::post('me', [ProfileController::class, 'update']);
    Route::post('me/password', [ProfileController::class, 'changePassword']);
    Route::post('me/logout-all', [ProfileController::class, 'logoutAll']);

    // Users
    Route::get('users', [UserController::class, 'index'])->middleware('permission:user.view');
    Route::post('users', [UserController::class, 'store'])->middleware('permission:user.create');
    Route::get('users/{user}', [UserController::class, 'show'])->middleware('permission:user.view');
    Route::put('users/{user}', [UserController::class, 'update'])->middleware('permission:user.edit');
    Route::post('users/{user}/toggle-active', [UserController::class, 'toggleActive'])->middleware('permission:user.edit');
    Route::post('users/{user}/reset-password', [UserController::class, 'resetPassword'])->middleware('permission:user.admin');
    Route::post('users/{user}/force-logout', [UserController::class, 'forceLogout'])->middleware('permission:user.admin');
    Route::get('users/{user}/login-logs', [UserController::class, 'loginLogs'])->middleware('permission:user.view');
    Route::get('users/{user}/activity', [UserController::class, 'activity'])->middleware('permission:user.view');
    Route::get('users/{user}/photo', [UserController::class, 'photo']);

    // Roles & permissions
    Route::get('roles', [RoleController::class, 'index'])->middleware('permission:role.view|user.create|user.edit');
    Route::post('roles', [RoleController::class, 'store'])->middleware('permission:role.create');
    Route::put('roles/{role}', [RoleController::class, 'update'])->middleware('permission:role.edit');
    Route::post('roles/{role}/duplicate', [RoleController::class, 'duplicate'])->middleware('permission:role.create');
    Route::delete('roles/{role}', [RoleController::class, 'destroy'])->middleware('permission:role.delete');
    Route::get('roles/{role}/permissions', [RoleController::class, 'permissions'])->middleware('permission:role.view');
    Route::put('roles/{role}/permissions', [RoleController::class, 'syncPermissions'])->middleware('permission:role.admin');

    // Audit log (read only — no write routes by design)
    Route::get('audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit.view');
    Route::get('audit-logs/meta', [AuditLogController::class, 'meta'])->middleware('permission:audit.view');
    Route::get('audit-logs/{auditLog}', [AuditLogController::class, 'show'])->middleware('permission:audit.view');

    // Approvals
    Route::get('approvals', [ApprovalController::class, 'index']);
    Route::get('approvals/pending-count', [ApprovalController::class, 'pendingCount']);
    Route::get('approval-rules', [ApprovalController::class, 'rules'])->middleware('permission:approval.admin');
    Route::put('approval-rules/{rule}', [ApprovalController::class, 'updateRule'])->middleware('permission:approval.admin');
    Route::get('approvals/{approval}', [ApprovalController::class, 'show']);
    Route::post('approvals/{approval}/decide', [ApprovalController::class, 'decide']);
    Route::post('approvals/{approval}/comments', [ApprovalController::class, 'comment']);

    // Locations & mouzas (read is open to all signed-in users — every form needs the dropdowns)
    Route::get('locations/{level}', [LocationController::class, 'index']);
    Route::post('locations/{level}', [LocationController::class, 'store'])->middleware('permission:location.create');
    Route::put('locations/{level}/{id}', [LocationController::class, 'update'])->middleware('permission:location.edit');
    Route::get('mouzas', [MouzaController::class, 'index']);
    Route::get('mouzas/{mouza}', [MouzaController::class, 'show']);
    Route::post('mouzas', [MouzaController::class, 'store'])->middleware('permission:mouza.create');
    Route::put('mouzas/{mouza}', [MouzaController::class, 'update'])->middleware('permission:mouza.edit');

    // Settings
    Route::middleware('permission:settings.admin')->group(function () {
        Route::get('settings', [SettingController::class, 'index']);
        Route::put('settings', [SettingController::class, 'update']);
        Route::post('settings/logo', [SettingController::class, 'uploadLogo']);
        Route::get('sequences', [SettingController::class, 'sequences']);
        Route::put('sequences/{sequence}', [SettingController::class, 'updateSequence']);
    });

    // Backups — Super Admin only
    Route::middleware('role:super_admin')->group(function () {
        Route::get('backups', [BackupController::class, 'index']);
        Route::post('backups', [BackupController::class, 'store']);
        Route::get('backups/{backup}/download', [BackupController::class, 'download']);
    });
});
