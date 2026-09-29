<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AccountingReportController;
use App\Http\Controllers\Api\ApprovalController;
use App\Http\Controllers\Api\AssetCategoryController;
use App\Http\Controllers\Api\AssetController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\BankAccountController;
use App\Http\Controllers\Api\BankReconciliationController;
use App\Http\Controllers\Api\CombinedPaymentController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DataHealthController;
use App\Http\Controllers\Api\DayCloseController;
use App\Http\Controllers\Api\DistributionController;
use App\Http\Controllers\Api\DuplicateController;
use App\Http\Controllers\Api\FarmerController;
use App\Http\Controllers\Api\FarmerDocumentController;
use App\Http\Controllers\Api\FinancialYearController;
use App\Http\Controllers\Api\FundController;
use App\Http\Controllers\Api\HouseholdController;
use App\Http\Controllers\Api\ImportController;
use App\Http\Controllers\Api\IntegrityScanController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\IrrigationRateController;
use App\Http\Controllers\Api\IrrigationReportController;
use App\Http\Controllers\Api\IrrigationTypeController;
use App\Http\Controllers\Api\JournalController;
use App\Http\Controllers\Api\LandActivityController;
use App\Http\Controllers\Api\LandController;
use App\Http\Controllers\Api\LandRegisterController;
use App\Http\Controllers\Api\LandReportController;
use App\Http\Controllers\Api\LandTransferController;
use App\Http\Controllers\Api\LandTypeController;
use App\Http\Controllers\Api\LoanController;
use App\Http\Controllers\Api\LoanProductController;
use App\Http\Controllers\Api\LocationController;
use App\Http\Controllers\Api\MemberController;
use App\Http\Controllers\Api\MemberFundController;
use App\Http\Controllers\Api\FundEntryController;
use App\Http\Controllers\Api\MembershipApplicationController;
use App\Http\Controllers\Api\MouzaController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\PatwariController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\PublicPaymentController;
use App\Http\Controllers\Api\QrController;
use App\Http\Controllers\Api\ReceiptBookController;
use App\Http\Controllers\Api\ReceiptController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SeasonController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\SmsController;
use App\Http\Controllers\Api\SystemController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VoterListController;
use Illuminate\Support\Facades\Route;

// ---- Public ----
Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1,login');
Route::get('public/settings', [AuthController::class, 'publicSettings']);
Route::get('public/logo', [SettingController::class, 'logo']);
Route::get('public/receipts/{token}', [ReceiptController::class, 'verify'])->middleware('throttle:30,1,receipt-verify');
Route::get('public/combined-receipts/{token}', [CombinedPaymentController::class, 'verify'])->middleware('throttle:30,1,receipt-verify');
Route::post('auth/forgot-password', [PasswordResetController::class, 'forgot'])->middleware('throttle:5,1,forgot-password');
Route::post('auth/reset-password', [PasswordResetController::class, 'reset'])->middleware('throttle:10,1,reset-password');
Route::get('public/payment-info', [PublicPaymentController::class, 'info'])->middleware('throttle:30,1,pay-info');
Route::get('public/payments/farmer', [PublicPaymentController::class, 'farmer'])->middleware('throttle:20,1,pay-farmer');
Route::post('public/payments', [PublicPaymentController::class, 'submit'])->middleware('throttle:5,1,pay-submit');
Route::get('public/payments/status', [PublicPaymentController::class, 'status'])->middleware('throttle:20,1,pay-status');

// ---- Authenticated ----
Route::middleware(['auth:sanctum', 'usable'])->group(function () {
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::get('me', [AuthController::class, 'me']);
    Route::post('me', [ProfileController::class, 'update']);
    Route::post('me/password', [ProfileController::class, 'changePassword']);
    Route::post('me/logout-all', [ProfileController::class, 'logoutAll']);
    Route::post('me/locale', [ProfileController::class, 'locale']);
    Route::get('settings/images/{slot}', [SettingController::class, 'image'])->whereIn('slot', ['logo', 'signature', 'seal']);

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
    Route::get('mouzas-summary', [MouzaController::class, 'summary']);
    Route::get('mouzas/{mouza}', [MouzaController::class, 'show']);
    Route::post('mouzas', [MouzaController::class, 'store'])->middleware('permission:mouza.create');
    Route::put('mouzas/{mouza}', [MouzaController::class, 'update'])->middleware('permission:mouza.edit');

    // Settings
    Route::middleware('permission:settings.admin')->group(function () {
        Route::get('settings', [SettingController::class, 'index']);
        Route::put('settings', [SettingController::class, 'update']);
        Route::post('settings/logo', [SettingController::class, 'uploadLogo']);
        Route::put('settings/{section}', [SettingController::class, 'updateSection'])->whereIn('section', ['branding', 'receipt', 'preferences']);
        Route::post('settings/images/{slot}', [SettingController::class, 'uploadImage'])->whereIn('slot', ['logo', 'signature', 'seal']);
        Route::delete('settings/images/{slot}', [SettingController::class, 'removeImage'])->whereIn('slot', ['logo', 'signature', 'seal']);
        Route::get('system/license', [SystemController::class, 'license']);
        Route::post('system/license', [SystemController::class, 'installLicense']);
        Route::get('sequences', [SettingController::class, 'sequences']);
        Route::put('sequences/{sequence}', [SettingController::class, 'updateSequence']);
    });

    // ---- Phase 2: farmers ----
    Route::get('farmers/meta', [FarmerController::class, 'meta']);
    Route::get('farmers/lookup', [FarmerController::class, 'lookup'])->middleware('permission:farmer.view|membership.create|member.admin|patwari.create|patwari.edit');
    Route::middleware('permission:farmer.view')->group(function () {
        Route::get('farmers', [FarmerController::class, 'index']);
        Route::get('farmers/summary', [FarmerController::class, 'summary']);
        Route::get('farmers/export', [FarmerController::class, 'export'])->middleware('permission:farmer.export');
        Route::post('farmers/check-duplicate', [FarmerController::class, 'checkDuplicate']);
        Route::get('farmers/duplicates', [DuplicateController::class, 'index']);
        Route::get('farmers/compare', [DuplicateController::class, 'compare']);
        Route::get('farmers/{farmer}', [FarmerController::class, 'show']);
        Route::get('farmers/{farmer}/photo', [FarmerController::class, 'photo']);
        Route::get('farmers/{farmer}/history', [FarmerController::class, 'history']);
        Route::get('farmers/{farmer}/overview', [FarmerController::class, 'overview']);
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
        Route::get('farmers-merge/history', [DuplicateController::class, 'history']);
        Route::get('farmers-merge/summary', [DuplicateController::class, 'mergeSummary']);
        Route::get('farmers-merge/meta', [DuplicateController::class, 'mergeMeta']);
        Route::put('farmers-merge/{approval}', [DuplicateController::class, 'updateMerge'])->whereNumber('approval');
        Route::delete('farmers-merge/{approval}', [DuplicateController::class, 'destroyMerge'])->whereNumber('approval');
        Route::post('households', [HouseholdController::class, 'store']);
        Route::post('households/{household}/head', [HouseholdController::class, 'changeHead']);
        Route::post('households/{household}/members', [HouseholdController::class, 'addMember']);
        Route::delete('households/{household}/members/{farmer}', [HouseholdController::class, 'removeMember']);
    });
    Route::delete('farmers/{farmer}', [FarmerController::class, 'destroy'])->middleware('permission:farmer.delete');
    Route::get('farmers-deleted', [FarmerController::class, 'deleted'])->middleware('permission:farmer.view');
    Route::get('farmers-deleted/summary', [FarmerController::class, 'deletedSummary'])->middleware('permission:farmer.view');
    Route::post('farmers/{id}/restore', [FarmerController::class, 'restore'])->whereNumber('id')->middleware('permission:farmer.delete');
    Route::delete('farmers-deleted/{id}', [FarmerController::class, 'purge'])->whereNumber('id')->middleware('permission:farmer.delete');

    // ---- Phase 2: membership ----
    Route::middleware('permission:membership.view')->group(function () {
        Route::get('membership-applications', [MembershipApplicationController::class, 'index']);
        Route::get('membership-applications/defaults', [MembershipApplicationController::class, 'defaults']);
        Route::get('membership-applications/summary', [MembershipApplicationController::class, 'summary']);
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
        Route::get('members/summary', [MemberController::class, 'summary']);
        Route::get('members/export', [MemberController::class, 'export'])->middleware('permission:member.export');
        Route::get('members/admission-register', [MemberController::class, 'admissionRegister']);
        Route::get('members/admission-register/export', [MemberController::class, 'admissionRegisterExport'])->middleware('permission:member.export');
        Route::get('voter-lists', [VoterListController::class, 'index']);
        Route::get('voters', [VoterListController::class, 'voters']);
        Route::get('voter-lists/{voterList}', [VoterListController::class, 'show']);
        Route::get('voter-lists/{voterList}/export', [VoterListController::class, 'export'])->middleware('permission:member.export');
    });
    Route::post('members/{member}/status', [MemberController::class, 'requestStatusChange'])->middleware('permission:member.edit');
    Route::post('members/legacy', [MemberController::class, 'storeLegacy'])->middleware('permission:member.admin');
    Route::post('voter-lists', [VoterListController::class, 'store'])->middleware('permission:member.admin');

    // ---- Phase 2: patwari ----
    Route::get('patwaris', [PatwariController::class, 'index'])->middleware('permission:patwari.view');
    Route::get('patwaris/export', [PatwariController::class, 'export'])->middleware('permission:patwari.export');
    Route::get('patwaris/summary', [PatwariController::class, 'summary'])->middleware('permission:patwari.view');
    Route::get('patwaris/{patwari}', [PatwariController::class, 'show'])->middleware('permission:patwari.view');
    Route::post('patwaris', [PatwariController::class, 'store'])->middleware('permission:patwari.create');
    Route::put('patwaris/{patwari}', [PatwariController::class, 'update'])->middleware('permission:patwari.edit');

    // ---- Phase 3: land ----
    Route::get('lands/meta', [LandController::class, 'meta']);
    Route::middleware('permission:land.view')->group(function () {
        Route::get('lands', [LandController::class, 'index']);
        Route::get('lands/export', [LandController::class, 'export'])->middleware('permission:land.export');
        Route::get('lands/summary', [LandController::class, 'summary']);
        Route::post('lands/check-duplicate', [LandController::class, 'checkDuplicate']);
        Route::get('lands/{land}', [LandController::class, 'show']);
        Route::get('lands/{land}/history', [LandController::class, 'history']);
        Route::get('lands/{land}/documents/{document}', [LandController::class, 'downloadDocument']);
        Route::get('land-register/parties', [LandRegisterController::class, 'parties']);
        Route::get('land-register/parties/summary', [LandRegisterController::class, 'partiesSummary']);
        Route::get('land-register/cultivations', [LandRegisterController::class, 'cultivations']);
        Route::get('land-register/cultivations/summary', [LandRegisterController::class, 'cultivationsSummary']);
        Route::get('land-register/transfers', [LandRegisterController::class, 'transfers']);
        Route::get('land-register/transfers/summary', [LandRegisterController::class, 'transfersSummary']);
        Route::get('land-register/history', [LandRegisterController::class, 'history']);
        Route::get('land-register/history/summary', [LandRegisterController::class, 'historySummary']);
        Route::get('land-register/activities', [LandActivityController::class, 'index']);
        Route::get('land-register/activities/summary', [LandActivityController::class, 'summary']);
        Route::get('land-register/overview', [LandRegisterController::class, 'overview']);
        Route::get('land-reports/meta', [LandReportController::class, 'meta']);
        Route::get('land-reports/summary', [LandReportController::class, 'summary']);
        Route::get('land-reports/generated', [LandReportController::class, 'generated']);
        Route::delete('land-reports/generated/{exportLog}', [LandReportController::class, 'dismiss']);
        Route::get('land-transfers/meta', [LandTransferController::class, 'meta']);
        Route::get('land-transfers', [LandTransferController::class, 'index']);
        Route::get('land-transfers-summary', [LandTransferController::class, 'summary']);
        Route::get('land-transfers/{landTransfer}', [LandTransferController::class, 'show']);
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
        Route::post('lands/{land}/documents', [LandController::class, 'storeDocument']);
        Route::delete('lands/{land}/documents/{document}', [LandController::class, 'destroyDocument']);
        Route::post('lands/{land}/notes', [LandController::class, 'storeNote']);
        Route::post('land-transfers', [LandTransferController::class, 'store']);
        Route::put('land-transfers/{landTransfer}', [LandTransferController::class, 'update']);
        Route::delete('land-transfers/{landTransfer}', [LandTransferController::class, 'destroy']);
        Route::delete('lands/{land}/notes/{note}', [LandController::class, 'destroyNote']);
    });
    Route::delete('lands/{land}', [LandController::class, 'destroy'])->middleware('permission:land.delete');
    Route::get('land-types', [LandTypeController::class, 'index']);
    Route::get('land-types/meta', [LandTypeController::class, 'meta']);
    Route::post('land-types', [LandTypeController::class, 'store'])->middleware('permission:settings.admin');
    Route::put('land-types/{landType}', [LandTypeController::class, 'update'])->middleware('permission:settings.admin');
    Route::delete('land-types/{landType}', [LandTypeController::class, 'destroy'])->middleware('permission:settings.admin');

    // ---- Phase 3: import ----
    Route::middleware('permission:import.view')->group(function () {
        Route::get('imports', [ImportController::class, 'index']);
        Route::get('imports/types', [ImportController::class, 'types']);
        Route::get('imports/template/{type}', [ImportController::class, 'template']);
        Route::get('imports/{batch}', [ImportController::class, 'show'])->whereNumber('batch');
    });
    Route::post('imports/{batch}/rollback', [ImportController::class, 'rollback'])->whereNumber('batch')->middleware('permission:import.admin');
    Route::middleware('permission:import.create')->group(function () {
        Route::post('imports/validate', [ImportController::class, 'validateMapping']);
        Route::post('imports/{type}/upload', [ImportController::class, 'upload']);
        Route::post('imports/{type}/preview', [ImportController::class, 'preview']);
        Route::post('imports/commit', [ImportController::class, 'commit']);
    });

    // ---- Phase 4: accounting, cash & bank ----
    Route::get('accounts/options', [AccountController::class, 'options'])->middleware('permission:accounting.view|cash.view|bank.view');
    Route::middleware('permission:accounting.view')->group(function () {
        Route::get('accounts', [AccountController::class, 'index']);
        Route::get('journals', [JournalController::class, 'index']);
        Route::get('journals/{journal}', [JournalController::class, 'show']);
        Route::get('accounting/trial-balance', [AccountingReportController::class, 'trialBalance']);
        Route::get('accounting/periods', [AccountingReportController::class, 'periods']);
    });
    Route::get('accounting/ledger', [AccountingReportController::class, 'ledger'])->middleware('permission:accounting.view|cash.view|bank.view');
    Route::middleware('permission:accounting.edit')->group(function () {
        Route::post('accounts', [AccountController::class, 'store']);
        Route::put('accounts/{account}', [AccountController::class, 'update']);
        Route::delete('accounts/{account}', [AccountController::class, 'destroy']);
    });
    Route::middleware('permission:accounting.create')->group(function () {
        Route::post('journals', [JournalController::class, 'store']);
        Route::put('journals/{journal}', [JournalController::class, 'update']);
        Route::post('journals/{journal}/reverse', [JournalController::class, 'reverse']);
    });
    Route::middleware('permission:accounting.approve')->group(function () {
        Route::post('accounting/periods/{period}/close', [AccountingReportController::class, 'closePeriod']);
        Route::post('accounting/periods/{period}/reopen', [AccountingReportController::class, 'reopenPeriod']);
    });
    Route::get('funds', [FundController::class, 'index'])->middleware('permission:cash.view|bank.view');
    // Per-fund permission (cash.create / bank.create) is checked inside the controller.
    Route::middleware('permission:cash.create|bank.create')->group(function () {
        Route::post('funds/receipt', [FundController::class, 'receipt']);
        Route::post('funds/payment', [FundController::class, 'payment']);
        Route::post('funds/transfer', [FundController::class, 'transfer']);
    });
    Route::middleware('permission:bank.view')->group(function () {
        Route::get('bank-accounts', [BankAccountController::class, 'index']);
        Route::get('bank-accounts/{bankAccount}/statement', [BankAccountController::class, 'statement']);
    });
    Route::post('bank-accounts', [BankAccountController::class, 'store'])->middleware('permission:bank.create');
    Route::middleware('permission:bank.edit')->group(function () {
        Route::put('bank-accounts/{bankAccount}', [BankAccountController::class, 'update']);
        Route::post('bank-accounts/{bankAccount}/lines/{line}/reconcile', [BankAccountController::class, 'reconcile']);
    });

    // ---- Phase 5: irrigation, invoices & receipts ----
    Route::get('irrigation-types', [IrrigationTypeController::class, 'index']);
    Route::post('irrigation-types', [IrrigationTypeController::class, 'store'])->middleware('permission:settings.admin');
    Route::put('irrigation-types/{irrigationType}', [IrrigationTypeController::class, 'update'])->middleware('permission:settings.admin');
    Route::delete('irrigation-types/{irrigationType}', [IrrigationTypeController::class, 'destroy'])->middleware('permission:settings.admin');
    Route::middleware('permission:irrigation.view')->group(function () {
        Route::get('seasons', [SeasonController::class, 'index']);
        Route::get('seasons/{season}', [SeasonController::class, 'show'])->whereNumber('season');
        Route::get('irrigation-rates', [IrrigationRateController::class, 'index']);
        Route::get('irrigation-rates/all', [IrrigationRateController::class, 'all']);
        Route::get('invoices/meta', [InvoiceController::class, 'meta']);
        Route::get('invoices/summary', [InvoiceController::class, 'summary']);
        Route::get('invoices', [InvoiceController::class, 'index']);
        Route::get('invoices/{invoice}', [InvoiceController::class, 'show']);
        Route::get('irrigation/dues', [IrrigationReportController::class, 'dues']);
        Route::get('irrigation/farmers/{farmer}/statement', [IrrigationReportController::class, 'statement']);
        Route::get('irrigation/mismatch', [IrrigationReportController::class, 'mismatch']);
        Route::get('irrigation/collection-check', [IrrigationReportController::class, 'collectionCheck']);
        Route::get('irrigation/invoices/{invoice}/receipts', [IrrigationReportController::class, 'invoiceReceipts']);
        Route::get('irrigation/rate-audit', [IrrigationReportController::class, 'rateAudit']);
    });
    Route::middleware('permission:irrigation.create')->group(function () {
        Route::post('invoices/quote', [InvoiceController::class, 'quote']);
        Route::post('invoices', [InvoiceController::class, 'store']);
        Route::post('invoices/bulk/preview', [InvoiceController::class, 'bulkPreview']);
        Route::post('invoices/bulk', [InvoiceController::class, 'bulkStore']);
    });
    Route::middleware('permission:irrigation.edit')->group(function () {
        Route::post('seasons', [SeasonController::class, 'store']);
        Route::put('seasons/{season}', [SeasonController::class, 'update']);
        Route::delete('seasons/{season}', [SeasonController::class, 'destroy']);
        Route::post('irrigation-rates', [IrrigationRateController::class, 'store']);
        Route::post('invoices/{invoice}/cancel', [InvoiceController::class, 'cancel']);
    });
    Route::middleware('permission:payment.view')->group(function () {
        Route::get('receipts', [ReceiptController::class, 'index']);
        Route::get('receipts/legacy-summary', [ReceiptController::class, 'legacySummary']);
        Route::get('receipts/dues', [ReceiptController::class, 'dues']);
        Route::get('receipts/funds', [ReceiptController::class, 'funds']);
        Route::get('receipts/{receipt}', [ReceiptController::class, 'show']);
    });
    Route::middleware('permission:payment.create')->group(function () {
        Route::post('receipts', [ReceiptController::class, 'store']);
        Route::post('receipts/batch', [ReceiptController::class, 'storeBatch']);
        Route::post('receipts/{receipt}/cancel', [ReceiptController::class, 'cancel']);
    });

    // ---- Phase 6: savings & share (permission checked per kind in the controller) ----
    Route::prefix('funds/{kind}')->whereIn('kind', ['savings', 'share'])->group(function () {
        Route::get('meta', [MemberFundController::class, 'meta']);
        Route::get('accounts', [MemberFundController::class, 'accounts']);
        Route::post('accounts', [MemberFundController::class, 'open']);
        Route::get('lookup', [MemberFundController::class, 'lookup']);
        Route::get('accounts/{account}', [MemberFundController::class, 'show']);
        Route::get('accounts/{account}/statement', [MemberFundController::class, 'statement']);
        Route::post('accounts/{account}/transactions', [MemberFundController::class, 'storeTransaction']);
        Route::get('transactions', [MemberFundController::class, 'transactions']);
        Route::get('transactions/{txn}', [MemberFundController::class, 'showTransaction']);
        Route::post('transactions/{txn}/cancel', [MemberFundController::class, 'cancelTransaction']);
        Route::get('audit', [MemberFundController::class, 'audit']);
        Route::get('entry-summary', [FundEntryController::class, 'summary']);
        Route::get('history', [FundEntryController::class, 'history']);
        Route::get('history/summary', [FundEntryController::class, 'historySummary']);
    });
    Route::get('distributions', [DistributionController::class, 'index']);
    Route::get('distributions/{run}', [DistributionController::class, 'show'])->whereNumber('run');
    Route::get('distributions/{kind}/preview', [DistributionController::class, 'preview'])->whereIn('kind', ['profit', 'dividend']);
    Route::post('distributions/{kind}', [DistributionController::class, 'store'])->whereIn('kind', ['profit', 'dividend']);

    // ---- Phase 7: loans ----
    Route::middleware('permission:loan.view')->group(function () {
        Route::get('loan-products', [LoanProductController::class, 'index']);
        Route::get('loan-products/preview', [LoanProductController::class, 'preview']);
        Route::get('loans/meta', [LoanController::class, 'meta']);
        Route::get('loans/funds', [ReceiptController::class, 'funds']);
        Route::get('loans/members', [LoanController::class, 'members']);
        Route::get('loans/eligibility', [LoanController::class, 'eligibility']);
        Route::get('loans/dues', [LoanController::class, 'dues']);
        Route::get('loans/audit', [LoanController::class, 'audit']);
        Route::get('loans/payments', [LoanController::class, 'payments']);
        Route::get('loans/payments/{payment}', [LoanController::class, 'showPayment']);
        Route::get('loans', [LoanController::class, 'index']);
        Route::get('loans/{loan}', [LoanController::class, 'show'])->whereNumber('loan');
        Route::get('loans/{loan}/statement', [LoanController::class, 'statement'])->whereNumber('loan');
        Route::get('loans/{loan}/position', [LoanController::class, 'position'])->whereNumber('loan');
        // repayments: loan staff or cashiers (checked in the controller)
        Route::post('loans/{loan}/payments', [LoanController::class, 'pay'])->whereNumber('loan');
        Route::post('loans/payments/{payment}/cancel', [LoanController::class, 'cancelPayment']);
    });
    Route::middleware('permission:loan.create')->group(function () {
        Route::post('loans', [LoanController::class, 'store']);
        Route::post('loans/{loan}/disburse', [LoanController::class, 'disburse'])->whereNumber('loan');
        Route::post('loans/{loan}/cancel', [LoanController::class, 'cancel'])->whereNumber('loan');
    });
    Route::middleware('permission:loan.edit')->group(function () {
        Route::post('loan-products', [LoanProductController::class, 'store']);
        Route::put('loan-products/{product}', [LoanProductController::class, 'update']);
    });

    // ---- Phase 8: combined payment, day close, bank reconciliation, QR, assets ----
    Route::middleware('permission:payment.view')->group(function () {
        Route::get('combined-payments', [CombinedPaymentController::class, 'index']);
        Route::get('combined-payments/quote', [CombinedPaymentController::class, 'quote']);
        Route::get('combined-payments/{combinedPayment}', [CombinedPaymentController::class, 'show'])->whereNumber('combinedPayment');
    });
    Route::middleware('permission:payment.create')->group(function () {
        Route::post('combined-payments', [CombinedPaymentController::class, 'store']);
        Route::post('combined-payments/{combinedPayment}/cancel', [CombinedPaymentController::class, 'cancel']);
    });
    Route::middleware('permission:cash.view')->group(function () {
        Route::get('day-closes', [DayCloseController::class, 'index']);
        Route::get('day-closes/summary', [DayCloseController::class, 'summary']);
    });
    // the cashier who counts the drawer closes the day; reopening goes through approval
    Route::middleware('permission:cash.create|cash.edit')->group(function () {
        Route::post('day-closes', [DayCloseController::class, 'close']);
        Route::post('day-closes/{dayClose}/reopen', [DayCloseController::class, 'reopen']);
    });
    Route::middleware('permission:bank.view')->group(function () {
        Route::get('bank-reconciliations', [BankReconciliationController::class, 'index']);
        Route::get('bank-reconciliations/{bankReconciliation}', [BankReconciliationController::class, 'show']);
    });
    Route::middleware('permission:bank.edit')->group(function () {
        Route::post('bank-reconciliations', [BankReconciliationController::class, 'store']);
        Route::put('bank-reconciliations/{bankReconciliation}', [BankReconciliationController::class, 'update']);
        Route::delete('bank-reconciliations/{bankReconciliation}', [BankReconciliationController::class, 'destroy']);
        Route::post('bank-reconciliations/{bankReconciliation}/lines', [BankReconciliationController::class, 'addLines']);
        Route::delete('bank-reconciliations/{bankReconciliation}/lines/{line}', [BankReconciliationController::class, 'deleteLine']);
        Route::post('bank-reconciliations/{bankReconciliation}/auto-match', [BankReconciliationController::class, 'autoMatch']);
        Route::post('bank-reconciliations/{bankReconciliation}/lines/{line}/match', [BankReconciliationController::class, 'match']);
        Route::post('bank-reconciliations/{bankReconciliation}/lines/{line}/unmatch', [BankReconciliationController::class, 'unmatch']);
        Route::post('bank-reconciliations/{bankReconciliation}/lines/{line}/book', [BankReconciliationController::class, 'book']);
        Route::post('bank-reconciliations/{bankReconciliation}/finalize', [BankReconciliationController::class, 'finalize']);
    });
    // QR: any signed-in user may scan; the target screen checks its own permission.
    Route::post('qr/resolve', [QrController::class, 'resolve'])->middleware('throttle:60,1');
    Route::get('qr/history', [QrController::class, 'history']);
    Route::middleware('permission:asset.view')->group(function () {
        Route::get('assets/meta', [AssetController::class, 'meta']);
        Route::get('assets/maintenances', [AssetController::class, 'maintenances']);
        Route::get('assets/dashboard', [AssetController::class, 'dashboard']);
        Route::get('assets/movements', [AssetController::class, 'movements']);
        Route::get('assets/depreciation/preview', [AssetController::class, 'depreciationPreview']);
        Route::get('assets/depreciation', [AssetController::class, 'depreciationHistory']);
        Route::get('assets/funds', [ReceiptController::class, 'funds']);
        Route::get('asset-categories', [AssetCategoryController::class, 'index']);
        Route::get('assets', [AssetController::class, 'index']);
        Route::get('assets/{asset}', [AssetController::class, 'show'])->whereNumber('asset');
    });
    Route::middleware('permission:asset.create')->group(function () {
        Route::post('assets', [AssetController::class, 'store']);
    });
    Route::middleware('permission:asset.edit')->group(function () {
        Route::put('assets/{asset}', [AssetController::class, 'update'])->whereNumber('asset');
        Route::post('assets/{asset}/movements', [AssetController::class, 'movement'])->whereNumber('asset');
        Route::post('assets/{asset}/maintenances', [AssetController::class, 'schedule'])->whereNumber('asset');
        Route::post('assets/maintenances/{maintenance}/complete', [AssetController::class, 'complete']);
        Route::post('assets/maintenances/{maintenance}/cancel', [AssetController::class, 'cancelMaintenance']);
        Route::post('assets/{asset}/dispose', [AssetController::class, 'dispose'])->whereNumber('asset');
        Route::post('assets/depreciation', [AssetController::class, 'depreciate']);
    });
    Route::middleware('permission:asset.admin')->group(function () {
        Route::post('asset-categories', [AssetCategoryController::class, 'store']);
        Route::put('asset-categories/{assetCategory}', [AssetCategoryController::class, 'update']);
    });

    // ---- Phase 9: dashboard, reports, integrity, SMS, public payments ----
    Route::get('dashboard', [DashboardController::class, 'index']);
    Route::get('reports', [ReportController::class, 'index']);
    Route::get('reports/{key}', [ReportController::class, 'show']);
    Route::post('reports/{key}/export-log', [ReportController::class, 'logExport']);
    Route::middleware('permission:audit.view')->group(function () {
        Route::get('integrity-scans', [IntegrityScanController::class, 'index']);
        Route::get('integrity-scans/{integrityScan}', [IntegrityScanController::class, 'show'])->whereNumber('integrityScan');
        Route::post('integrity-scans', [IntegrityScanController::class, 'store']);
    });
    Route::get('ledger-integrity', [IntegrityScanController::class, 'ledger'])->middleware('permission:accounting.view');
    Route::middleware('permission:settings.admin|sms.admin')->group(function () {
        Route::get('sms/settings', [SmsController::class, 'settings']);
        Route::put('sms/settings', [SmsController::class, 'updateSettings']);
        Route::post('sms/test', [SmsController::class, 'test']);
        Route::get('sms/templates', [SmsController::class, 'templates']);
        Route::put('sms/templates/{smsTemplate}', [SmsController::class, 'updateTemplate']);
        Route::post('sms/templates/{smsTemplate}/preview', [SmsController::class, 'preview']);
        Route::post('sms/process', [SmsController::class, 'process']);
    });
    Route::middleware('permission:settings.admin|sms.view|sms.admin')->group(function () {
        Route::get('sms/logs', [SmsController::class, 'logs']);
        Route::post('sms/logs/{smsLog}/retry', [SmsController::class, 'retry']);
    });
    Route::middleware('permission:payment.admin|settings.admin')->group(function () {
        Route::get('public-payments/settings', [PublicPaymentController::class, 'settings']);
        Route::put('public-payments/settings', [PublicPaymentController::class, 'updateSettings']);
    });
    Route::middleware('permission:payment.view')->group(function () {
        Route::get('public-payments', [PublicPaymentController::class, 'index']);
        Route::get('public-payments/{publicPayment}', [PublicPaymentController::class, 'show'])->whereNumber('publicPayment');
    });
    Route::middleware('permission:payment.create|payment.approve')->group(function () {
        Route::post('public-payments/{publicPayment}/verify', [PublicPaymentController::class, 'verify'])->whereNumber('publicPayment');
        Route::post('public-payments/{publicPayment}/reject', [PublicPaymentController::class, 'reject'])->whereNumber('publicPayment');
    });
    Route::middleware('permission:settings.admin')->group(function () {
        Route::get('receipt-books', [ReceiptBookController::class, 'index']);
        Route::post('receipt-books', [ReceiptBookController::class, 'store']);
        Route::get('receipt-books/{receiptBook}', [ReceiptBookController::class, 'show']);
        Route::put('receipt-books/{receiptBook}', [ReceiptBookController::class, 'update']);
        Route::get('financial-years', [FinancialYearController::class, 'index']);
        Route::get('financial-years/{fy}/preview', [FinancialYearController::class, 'preview']);
        Route::post('financial-years/{fy}/close', [FinancialYearController::class, 'close']);
    });

    // Backups — Super Admin only
    Route::middleware('role:super_admin')->group(function () {
        Route::get('backups', [BackupController::class, 'index']);
        Route::post('backups', [BackupController::class, 'store']);
        Route::get('backups/{backup}/download', [BackupController::class, 'download']);
    });
});
