<?php

use App\Http\Controllers\Api\ApprovalController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\DataHealthController;
use App\Http\Controllers\Api\DuplicateController;
use App\Http\Controllers\Api\ImportController;
use App\Http\Controllers\Api\LandController;
use App\Http\Controllers\Api\LandTypeController;
use App\Http\Controllers\Api\FarmerController;
use App\Http\Controllers\Api\FarmerDocumentController;
use App\Http\Controllers\Api\HouseholdController;
use App\Http\Controllers\Api\MemberController;
use App\Http\Controllers\Api\MembershipApplicationController;
use App\Http\Controllers\Api\PatwariController;
use App\Http\Controllers\Api\VoterListController;
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
    Route::post('me/locale', [ProfileController::class, 'locale']);

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
    Route::get('roles/options', [RoleController::class, 'options']);
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

    // ---- Phase 2: farmers ----
    Route::get('farmers/meta', [FarmerController::class, 'meta']);
    Route::get('farmers/lookup', [FarmerController::class, 'lookup'])->middleware('permission:farmer.view|membership.create|member.admin|patwari.create|patwari.edit');
    Route::middleware('permission:farmer.view')->group(function () {
        Route::get('farmers', [FarmerController::class, 'index']);
        Route::get('farmers/export', [FarmerController::class, 'export'])->middleware('permission:farmer.export');
        Route::post('farmers/check-duplicate', [FarmerController::class, 'checkDuplicate']);
        Route::get('farmers/duplicates', [DuplicateController::class, 'index']);
        Route::get('farmers/compare', [DuplicateController::class, 'compare']);
        Route::get('farmers/{farmer}', [FarmerController::class, 'show']);
        Route::get('farmers/{farmer}/photo', [FarmerController::class, 'photo']);
        Route::get('farmers/{farmer}/history', [FarmerController::class, 'history']);
        Route::get('farmers/{farmer}/documents', [FarmerDocumentController::class, 'index']);
        Route::get('farmers/{farmer}/documents/{document}', [FarmerDocumentController::class, 'download']);
        Route::get('households', [HouseholdController::class, 'index']);
        Route::get('households/lookup', [HouseholdController::class, 'lookup']);
        Route::get('households/{household}', [HouseholdController::class, 'show']);
    });
    Route::post('farmers', [FarmerController::class, 'store'])->middleware('permission:farmer.create');
    Route::middleware('permission:farmer.edit')->group(function () {
        Route::post('farmers/{farmer}', [FarmerController::class, 'update']); // POST: multipart photo upload
        Route::post('farmers/{farmer}/toggle-active', [FarmerController::class, 'toggleActive']);
        Route::post('farmers/{farmer}/documents', [FarmerDocumentController::class, 'store']);
        Route::delete('farmers/{farmer}/documents/{document}', [FarmerDocumentController::class, 'destroy']);
        Route::post('farmers-duplicates/dismiss', [DuplicateController::class, 'dismiss']);
        Route::post('farmers-merge', [DuplicateController::class, 'requestMerge']);
        Route::post('households', [HouseholdController::class, 'store']);
        Route::post('households/{household}/head', [HouseholdController::class, 'changeHead']);
        Route::post('households/{household}/members', [HouseholdController::class, 'addMember']);
        Route::delete('households/{household}/members/{farmer}', [HouseholdController::class, 'removeMember']);
    });
    Route::delete('farmers/{farmer}', [FarmerController::class, 'destroy'])->middleware('permission:farmer.delete');

    // ---- Phase 2: membership ----
    Route::middleware('permission:membership.view')->group(function () {
        Route::get('membership-applications', [MembershipApplicationController::class, 'index']);
        Route::get('membership-applications/defaults', [MembershipApplicationController::class, 'defaults']);
        Route::get('membership-applications/{application}', [MembershipApplicationController::class, 'show']);
        Route::get('membership-applications/{application}/file/{kind}', [MembershipApplicationController::class, 'file']);
    });
    Route::post('membership-applications', [MembershipApplicationController::class, 'store'])->middleware('permission:membership.create');
    Route::middleware('permission:membership.edit|membership.create')->group(function () {
        Route::post('membership-applications/{application}', [MembershipApplicationController::class, 'update']);
        Route::post('membership-applications/{application}/submit', [MembershipApplicationController::class, 'submit']);
        Route::post('membership-applications/{application}/cancel', [MembershipApplicationController::class, 'cancel']);
    });

    Route::middleware('permission:member.view')->group(function () {
        Route::get('members', [MemberController::class, 'index']);
        Route::get('members/export', [MemberController::class, 'export'])->middleware('permission:member.export');
        Route::get('members/admission-register', [MemberController::class, 'admissionRegister']);
        Route::get('members/admission-register/export', [MemberController::class, 'admissionRegisterExport'])->middleware('permission:member.export');
        Route::get('voter-lists', [VoterListController::class, 'index']);
        Route::get('voter-lists/{voterList}', [VoterListController::class, 'show']);
        Route::get('voter-lists/{voterList}/export', [VoterListController::class, 'export'])->middleware('permission:member.export');
    });
    Route::post('members/{member}/status', [MemberController::class, 'requestStatusChange'])->middleware('permission:member.edit');
    Route::post('members/legacy', [MemberController::class, 'storeLegacy'])->middleware('permission:member.admin');
    Route::post('voter-lists', [VoterListController::class, 'store'])->middleware('permission:member.admin');

    // ---- Phase 2: patwari ----
    Route::get('patwaris', [PatwariController::class, 'index'])->middleware('permission:patwari.view');
    Route::get('patwaris/export', [PatwariController::class, 'export'])->middleware('permission:patwari.export');
    Route::get('patwaris/{patwari}', [PatwariController::class, 'show'])->middleware('permission:patwari.view');
    Route::post('patwaris', [PatwariController::class, 'store'])->middleware('permission:patwari.create');
    Route::put('patwaris/{patwari}', [PatwariController::class, 'update'])->middleware('permission:patwari.edit');

    // ---- Phase 3: land ----
    Route::get('lands/meta', [LandController::class, 'meta']);
    Route::middleware('permission:land.view')->group(function () {
        Route::get('lands', [LandController::class, 'index']);
        Route::get('lands/export', [LandController::class, 'export'])->middleware('permission:land.export');
        Route::post('lands/check-duplicate', [LandController::class, 'checkDuplicate']);
        Route::get('lands/{land}', [LandController::class, 'show']);
        Route::get('lands/{land}/history', [LandController::class, 'history']);
        Route::get('farmers/{farmer}/lands', [LandController::class, 'forFarmer']);
        Route::get('data-health/summary', [DataHealthController::class, 'summary']);
        Route::get('data-health/mouzas', [DataHealthController::class, 'mouzas']);
        Route::get('data-health/items/{key}', [DataHealthController::class, 'items']);
    });
    Route::post('lands', [LandController::class, 'store'])->middleware('permission:land.create');
    Route::middleware('permission:land.edit')->group(function () {
        Route::put('lands/{land}', [LandController::class, 'update']);
        Route::post('lands/{land}/transfer', [LandController::class, 'transfer']);
        Route::post('lands/{land}/cultivation', [LandController::class, 'changeCultivation']);
        Route::post('lands/{land}/cultivation/end', [LandController::class, 'endCultivation']);
    });
    Route::delete('lands/{land}', [LandController::class, 'destroy'])->middleware('permission:land.delete');
    Route::get('land-types', [LandTypeController::class, 'index']);
    Route::post('land-types', [LandTypeController::class, 'store'])->middleware('permission:settings.admin');
    Route::put('land-types/{landType}', [LandTypeController::class, 'update'])->middleware('permission:settings.admin');

    // ---- Phase 3: import ----
    Route::middleware('permission:import.create')->group(function () {
        Route::get('imports', [ImportController::class, 'index']);
        Route::get('imports/template/{type}', [ImportController::class, 'template']);
        Route::post('imports/{type}/preview', [ImportController::class, 'preview']);
        Route::post('imports/commit', [ImportController::class, 'commit']);
        Route::get('imports/{batch}', [ImportController::class, 'show']);
    });

    // Backups — Super Admin only
    Route::middleware('role:super_admin')->group(function () {
        Route::get('backups', [BackupController::class, 'index']);
        Route::post('backups', [BackupController::class, 'store']);
        Route::get('backups/{backup}/download', [BackupController::class, 'download']);
    });
});
