import { Fragment, lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Result, Spin } from 'antd'
import { useAuth } from './auth/AuthContext'
import AppLayout from './components/AppLayout'
import { FUND_KINDS } from './lib/funds'
import { t as tx } from './lib/i18n'
import { SOON } from './lib/comingSoon'
import ComingSoonPage from './pages/ComingSoonPage'
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const UserListPage = lazy(() => import('./pages/admin/UserListPage'))
const UserFormPage = lazy(() => import('./pages/admin/UserFormPage'))
const UserDetailPage = lazy(() => import('./pages/admin/UserDetailPage'))
const RoleListPage = lazy(() => import('./pages/admin/RoleListPage'))
const PermissionMatrixPage = lazy(() => import('./pages/admin/PermissionMatrixPage'))
const BackupPage = lazy(() => import('./pages/admin/BackupPage'))
const AuditLogPage = lazy(() => import('./pages/audit/AuditLogPage'))
const ApprovalInboxPage = lazy(() => import('./pages/approvals/ApprovalInboxPage'))
const ApprovalDetailPage = lazy(() => import('./pages/approvals/ApprovalDetailPage'))
const ApprovalRulesPage = lazy(() => import('./pages/approvals/ApprovalRulesPage'))
const LocationPage = lazy(() => import('./pages/masters/LocationPage'))
const MouzaPage = lazy(() => import('./pages/masters/MouzaPage'))
const GeneralSettingsPage = lazy(() => import('./pages/settings/GeneralSettingsPage'))
const SequencePage = lazy(() => import('./pages/settings/SequencePage'))
const FarmerListPage = lazy(() => import('./pages/farmers/FarmerListPage'))
const FarmerFormPage = lazy(() => import('./pages/farmers/FarmerFormPage'))
const FarmerProfilePage = lazy(() => import('./pages/farmers/FarmerProfilePage'))
const DuplicatesPage = lazy(() => import('./pages/farmers/DuplicatesPage'))
const MergePage = lazy(() => import('./pages/farmers/MergePage'))
const FarmerMergeListPage = lazy(() => import('./pages/farmers/FarmerMergeListPage'))
const HouseholdPage = lazy(() => import('./pages/farmers/HouseholdPage'))
const ApplicationListPage = lazy(() => import('./pages/membership/ApplicationListPage'))
const ApplicationFormPage = lazy(() => import('./pages/membership/ApplicationFormPage'))
const MemberListPage = lazy(() => import('./pages/membership/MemberListPage'))
const AdmissionRegisterPage = lazy(() => import('./pages/membership/AdmissionRegisterPage'))
const VoterListPage = lazy(() => import('./pages/membership/VoterListPage'))
const PatwariPage = lazy(() => import('./pages/masters/PatwariPage'))
const LandListPage = lazy(() => import('./pages/lands/LandListPage'))
const LandFormPage = lazy(() => import('./pages/lands/LandFormPage'))
const LandDetailPage = lazy(() => import('./pages/lands/LandDetailPage'))
const OwnerCultivatorPage = lazy(() => import('./pages/lands/OwnerCultivatorPage'))
const BorgaPage = lazy(() => import('./pages/lands/BorgaPage'))
const LandTransferPage = lazy(() => import('./pages/lands/LandTransferPage'))
const LandTransferFormPage = lazy(() => import('./pages/lands/LandTransferFormPage'))
const LandHistoryPage = lazy(() => import('./pages/lands/LandHistoryPage'))
const LandReportsPage = lazy(() => import('./pages/lands/LandReportsPage'))
const DataHealthPage = lazy(() => import('./pages/lands/DataHealthPage'))
const ImportPage = lazy(() => import('./pages/lands/ImportPage'))
const ImportTypePage = lazy(() => import('./pages/imports/ImportTypePage'))
const ImportAuditPage = lazy(() => import('./pages/imports/ImportAuditPage'))
const BrandingSettingsPage = lazy(() => import('./pages/settings/BrandingSettingsPage'))
const ReceiptSettingsPage = lazy(() => import('./pages/settings/ReceiptSettingsPage'))
const PreferencesPage = lazy(() => import('./pages/settings/PreferencesPage'))
const LicensePage = lazy(() => import('./pages/settings/LicensePage'))
const LandTypesPage = lazy(() => import('./pages/settings/LandTypesPage'))
const ChartOfAccountsPage = lazy(() => import('./pages/accounting/ChartOfAccountsPage'))
const JournalListPage = lazy(() => import('./pages/accounting/JournalListPage'))
const JournalFormPage = lazy(() => import('./pages/accounting/JournalFormPage'))
const JournalDetailPage = lazy(() => import('./pages/accounting/JournalDetailPage'))
const FundsPage = lazy(() => import('./pages/accounting/FundsPage'))
const LedgerPage = lazy(() => import('./pages/accounting/LedgerPage'))
const BankAccountsPage = lazy(() => import('./pages/accounting/BankAccountsPage'))
const TrialBalancePage = lazy(() => import('./pages/accounting/TrialBalancePage'))
const PeriodsPage = lazy(() => import('./pages/accounting/PeriodsPage'))
const IrrigationTypesPage = lazy(() => import('./pages/settings/IrrigationTypesPage'))
const SeasonsPage = lazy(() => import('./pages/irrigation/SeasonsPage'))
const RatesPage = lazy(() => import('./pages/irrigation/RatesPage'))
const InvoiceListPage = lazy(() => import('./pages/irrigation/InvoiceListPage'))
const InvoiceFormPage = lazy(() => import('./pages/irrigation/InvoiceFormPage'))
const BulkInvoicePage = lazy(() => import('./pages/irrigation/BulkInvoicePage'))
const InvoiceDetailPage = lazy(() => import('./pages/irrigation/InvoiceDetailPage'))
const DuesPage = lazy(() => import('./pages/irrigation/DuesPage'))
const FarmerStatementPage = lazy(() => import('./pages/irrigation/FarmerStatementPage'))
const MismatchPage = lazy(() => import('./pages/irrigation/MismatchPage'))
const RateAuditPage = lazy(() => import('./pages/irrigation/RateAuditPage'))
const CollectionPage = lazy(() => import('./pages/payments/CollectionPage'))
const ReceiptListPage = lazy(() => import('./pages/payments/ReceiptListPage'))
const ReceiptDetailPage = lazy(() => import('./pages/payments/ReceiptDetailPage'))
const FundAccountListPage = lazy(() => import('./pages/funds/FundAccountListPage'))
const FundAccountDetailPage = lazy(() => import('./pages/funds/FundAccountDetailPage'))
const FundTxnListPage = lazy(() => import('./pages/funds/FundTxnListPage'))
const FundTxnDetailPage = lazy(() => import('./pages/funds/FundTxnDetailPage'))
const FundAuditPage = lazy(() => import('./pages/funds/FundAuditPage'))
const DistributionListPage = lazy(() => import('./pages/funds/DistributionListPage'))
const DistributionFormPage = lazy(() => import('./pages/funds/DistributionFormPage'))
const DistributionDetailPage = lazy(() => import('./pages/funds/DistributionDetailPage'))
const LoanListPage = lazy(() => import('./pages/loans/LoanListPage'))
const LoanFormPage = lazy(() => import('./pages/loans/LoanFormPage'))
const LoanDetailPage = lazy(() => import('./pages/loans/LoanDetailPage'))
const LoanProductsPage = lazy(() => import('./pages/loans/LoanProductsPage'))
const LoanPaymentListPage = lazy(() => import('./pages/loans/LoanPaymentListPage'))
const LoanPaymentDetailPage = lazy(() => import('./pages/loans/LoanPaymentDetailPage'))
const LoanDuesPage = lazy(() => import('./pages/loans/LoanDuesPage'))
const LoanAuditPage = lazy(() => import('./pages/loans/LoanAuditPage'))
const VerifyReceiptPage = lazy(() => import('./pages/VerifyReceiptPage'))
const RecordLookupPage = lazy(() => import('./pages/RecordLookupPage'))
const CombinedPaymentPage = lazy(() => import('./pages/payments/CombinedPaymentPage'))
const CombinedPaymentListPage = lazy(() => import('./pages/payments/CombinedPaymentListPage'))
const CombinedPaymentDetailPage = lazy(() => import('./pages/payments/CombinedPaymentDetailPage'))
const DayClosePage = lazy(() => import('./pages/cash/DayClosePage'))
const BankReconciliationListPage = lazy(() => import('./pages/accounting/BankReconciliationListPage'))
const BankReconciliationDetailPage = lazy(() => import('./pages/accounting/BankReconciliationDetailPage'))
const QrScannerPage = lazy(() => import('./pages/qr/QrScannerPage'))
const QrResolvePage = lazy(() => import('./pages/qr/QrResolvePage'))
const QrHistoryPage = lazy(() => import('./pages/qr/QrHistoryPage'))
const AssetDashboardPage = lazy(() => import('./pages/assets/AssetDashboardPage'))
const AssetListPage = lazy(() => import('./pages/assets/AssetListPage'))
const AssetFormPage = lazy(() => import('./pages/assets/AssetFormPage'))
const AssetDetailPage = lazy(() => import('./pages/assets/AssetDetailPage'))
const AssetMovementsPage = lazy(() => import('./pages/assets/AssetMovementsPage'))
const MaintenancePage = lazy(() => import('./pages/assets/MaintenancePage'))
const DepreciationPage = lazy(() => import('./pages/assets/DepreciationPage'))
const AssetCategoriesPage = lazy(() => import('./pages/assets/AssetCategoriesPage'))
const ReportPage = lazy(() => import('./pages/reports/ReportPage'))
const ReportCenterPage = lazy(() => import('./pages/reports/ReportCenterPage'))
const DeletedFarmersPage = lazy(() => import('./pages/farmers/DeletedFarmersPage'))
const LedgerIntegrityPage = lazy(() => import('./pages/accounting/LedgerIntegrityPage'))
const PublicPaymentsPage = lazy(() => import('./pages/accounting/PublicPaymentsPage'))
const IntegrityScanPage = lazy(() => import('./pages/audit/IntegrityScanPage'))
const ReceiptSerialPage = lazy(() => import('./pages/admin/ReceiptSerialPage'))
const SmsSettingsPage = lazy(() => import('./pages/settings/SmsSettingsPage'))
const SmsTemplatesPage = lazy(() => import('./pages/settings/SmsTemplatesPage'))
const SmsLogsPage = lazy(() => import('./pages/settings/SmsLogsPage'))
const FinancialYearPage = lazy(() => import('./pages/settings/FinancialYearPage'))
const PublicPaymentPage = lazy(() => import('./pages/PublicPaymentPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))

/** Menu items that are simply one or more server reports (the page shows only those the user may open). */
const REPORT_ROUTES: { path: string; title: string; keys: string[] }[] = [
  { path: 'irrigation/lookup', title: tx('মৌসুম / জমির ধরন অনুসন্ধান'), keys: ['irrigation_rates'] },
  { path: 'irrigation/category-rates', title: tx('ক্যাটাগরিভিত্তিক রেট'), keys: ['rate_matrix'] },
  { path: 'members/voter-history', title: tx('ভোটার ইতিহাস'), keys: ['voter_lists', 'voters'] },
  { path: 'members/voter-audit', title: tx('ভোটার অডিট'), keys: ['voter_changes'] },
  { path: 'loans/guarantors', title: tx('জামিনদার'), keys: ['guarantors'] },
  { path: 'cashbook/irrigation', title: tx('সেচ নগদ বিবরণী'), keys: ['cash_irrigation'] },
  { path: 'cashbook/society', title: tx('সমিতির নগদ বিবরণী'), keys: ['cash_society'] },
  { path: 'cashbook/income-expense', title: tx('আয়-ব্যয় নগদ বই'), keys: ['income_expense_cashbook'] },
  { path: 'audit/exports', title: tx('Export অডিট'), keys: ['export_logs'] },
  { path: 'assets/reports', title: tx('সম্পদের রিপোর্ট'), keys: ['asset_register', 'asset_by_category', 'asset_depreciation', 'asset_maintenance'] },
  { path: 'accounting/summary', title: tx('আর্থিক সারসংক্ষেপ'), keys: ['income_statement', 'balance_sheet', 'cash_flow'] },
  { path: 'accounting/source-vs-ledger', title: tx('উৎস বনাম খতিয়ান'), keys: ['source_vs_ledger'] },
  { path: 'accounting/irrigation-cash-bank', title: tx('সেচের নগদ ও ব্যাংক'), keys: ['irrigation_cash_bank'] },
  { path: 'accounting/payment-reconciliation', title: tx('পেমেন্ট মিলকরণ'), keys: ['payment_reconciliation'] },
  {
    path: 'reports/collections',
    title: tx('আদায়ের রিপোর্ট'),
    keys: ['collection_daily', 'collection_by_user', 'irrigation_collection', 'loan_collection', 'savings_collection', 'combined_payments'],
  },
  { path: 'reports/dues', title: tx('বকেয়ার রিপোর্ট'), keys: ['irrigation_due', 'loan_due'] },
  { path: 'reports/audit', title: tx('অডিট রিপোর্ট'), keys: ['audit_activity', 'audit_summary', 'approvals', 'cancellations', 'login_history'] },
]

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spin fullscreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

/** Remount when the query string changes: for pages that read a ?preset once (menu items like /loans?status=pending). */
function ByQuery({ children }: { children: ReactNode }) {
  const { search } = useLocation()
  return <Fragment key={search}>{children}</Fragment>
}

function Perm({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth()
  return can(perm) ? <>{children}</> : <Result status="403" title={tx('অনুমতি নেই')} subTitle={tx('এই পাতা দেখার অনুমতি আপনার নেই।')} />
}

export default function App() {
  return (
    <Suspense fallback={<Spin fullscreen />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/verify/:kind/:token" element={<VerifyReceiptPage />} />
      <Route path="/pay" element={<PublicPaymentPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />

        <Route path="admin/users" element={<Perm perm="user.view"><UserListPage /></Perm>} />
        <Route path="admin/users/new" element={<Perm perm="user.create"><UserFormPage /></Perm>} />
        <Route path="admin/users/:id" element={<Perm perm="user.view"><UserDetailPage /></Perm>} />
        <Route path="admin/users/:id/edit" element={<Perm perm="user.edit"><UserFormPage /></Perm>} />
        <Route path="admin/roles" element={<Perm perm="role.view"><RoleListPage /></Perm>} />
        <Route path="admin/permissions" element={<Perm perm="role.view"><PermissionMatrixPage /></Perm>} />
        <Route path="admin/roles/:id/permissions" element={<Perm perm="role.view"><PermissionMatrixPage /></Perm>} />
        <Route path="admin/approval-rules" element={<Perm perm="approval.admin"><ApprovalRulesPage /></Perm>} />
        <Route path="admin/backups" element={<Perm perm="__super_admin__"><BackupPage /></Perm>} />

        <Route path="audit/logs" element={<Perm perm="audit.view"><AuditLogPage /></Perm>} />
        <Route path="approvals" element={<ApprovalInboxPage />} />
        <Route path="approvals/:id" element={<ApprovalDetailPage />} />

        <Route path="masters/locations" element={<LocationPage />} />
        <Route path="masters/mouzas" element={<MouzaPage />} />
        <Route path="masters/patwaris" element={<Perm perm="patwari.view"><PatwariPage /></Perm>} />

        <Route path="farmers" element={<Perm perm="farmer.view"><FarmerListPage /></Perm>} />
        <Route path="farmers/new" element={<Perm perm="farmer.create"><FarmerFormPage /></Perm>} />
        <Route path="farmers/duplicates" element={<Perm perm="farmer.view"><DuplicatesPage /></Perm>} />
        <Route path="farmers/merge" element={<Perm perm="farmer.edit"><FarmerMergeListPage /></Perm>} />
        <Route path="farmers/merge/new" element={<Perm perm="farmer.edit"><MergePage /></Perm>} />
        <Route path="farmers/:id" element={<Perm perm="farmer.view"><FarmerProfilePage /></Perm>} />
        <Route path="farmers/:id/edit" element={<Perm perm="farmer.edit"><FarmerFormPage /></Perm>} />
        <Route path="households" element={<Perm perm="farmer.view"><HouseholdPage /></Perm>} />

        <Route path="membership/applications" element={<Perm perm="membership.view"><ApplicationListPage /></Perm>} />
        <Route path="membership/applications/new" element={<Perm perm="membership.create"><ApplicationFormPage /></Perm>} />
        <Route path="membership/applications/:id" element={<Perm perm="membership.view"><ApplicationFormPage /></Perm>} />
        <Route path="members" element={<Perm perm="member.view"><MemberListPage /></Perm>} />
        <Route path="members/admission-register" element={<Perm perm="member.view"><AdmissionRegisterPage /></Perm>} />
        <Route path="members/voters" element={<Perm perm="member.view"><VoterListPage /></Perm>} />

        <Route path="settings/general" element={<Perm perm="settings.admin"><GeneralSettingsPage /></Perm>} />
        <Route path="settings/branding" element={<Perm perm="settings.admin"><BrandingSettingsPage /></Perm>} />
        <Route path="settings/receipt" element={<Perm perm="settings.admin"><ReceiptSettingsPage /></Perm>} />
        <Route path="settings/preferences" element={<Perm perm="settings.admin"><PreferencesPage /></Perm>} />
        <Route path="settings/license" element={<Perm perm="settings.admin"><LicensePage /></Perm>} />
        <Route path="settings/sequences" element={<Perm perm="settings.admin"><SequencePage /></Perm>} />
        <Route path="settings/land-types" element={<Perm perm="settings.admin"><LandTypesPage /></Perm>} />
        <Route path="settings/irrigation-types" element={<Perm perm="settings.admin"><IrrigationTypesPage /></Perm>} />

        <Route path="lands" element={<Perm perm="land.view"><LandListPage /></Perm>} />
        <Route path="lands/new" element={<Perm perm="land.create"><LandFormPage /></Perm>} />
        <Route path="lands/lookup" element={<Perm perm="land.view"><LandDetailPage /></Perm>} />
        <Route path="lands/lookup/history" element={<Perm perm="land.view"><LandHistoryPage /></Perm>} />
        <Route path="lands/owners" element={<Perm perm="land.view"><OwnerCultivatorPage /></Perm>} />
        <Route path="lands/borga" element={<Perm perm="land.view"><BorgaPage /></Perm>} />
        <Route path="lands/transfers" element={<Perm perm="land.view"><LandTransferPage /></Perm>} />
        <Route path="lands/transfers/new" element={<Perm perm="land.edit"><LandTransferFormPage key="new" /></Perm>} />
        <Route path="lands/transfers/:id" element={<Perm perm="land.view"><LandTransferFormPage /></Perm>} />
        <Route path="lands/reports" element={<Perm perm="land.view"><LandReportsPage /></Perm>} />
        <Route path="lands/:id" element={<Perm perm="land.view"><LandDetailPage /></Perm>} />
        <Route path="lands/:id/edit" element={<Perm perm="land.edit"><LandFormPage /></Perm>} />
        <Route path="data-health" element={<Perm perm="land.view"><DataHealthPage /></Perm>} />
        <Route path="imports" element={<Perm perm="import.create"><ByQuery><ImportPage /></ByQuery></Perm>} />
        <Route path="imports/savings-opening" element={<Perm perm="import.create"><ImportTypePage key="savings_opening" type="savings_opening" /></Perm>} />
        <Route path="imports/share-opening" element={<Perm perm="import.create"><ImportTypePage key="share_opening" type="share_opening" /></Perm>} />
        <Route path="imports/loan-opening" element={<Perm perm="import.create"><ImportTypePage key="loan_opening" type="loan_opening" /></Perm>} />
        <Route path="imports/payments" element={<Perm perm="import.create"><ImportTypePage key="payments" type="payments" /></Perm>} />
        <Route path="imports/legacy-irrigation" element={<Perm perm="import.create"><ImportTypePage key="legacy_irrigation" type="legacy_irrigation" /></Perm>} />
        <Route path="imports/audit" element={<Perm perm="import.view"><ImportAuditPage /></Perm>} />

        <Route path="accounting/funds" element={<Perm perm={['cash.view', 'bank.view']}><FundsPage /></Perm>} />
        <Route path="accounting/ledger" element={<Perm perm={['accounting.view', 'cash.view', 'bank.view']}><LedgerPage /></Perm>} />
        <Route path="accounting/bank-accounts" element={<Perm perm="bank.view"><BankAccountsPage /></Perm>} />
        <Route path="accounting/journals" element={<Perm perm="accounting.view"><JournalListPage /></Perm>} />
        <Route path="accounting/journals/new" element={<Perm perm="accounting.create"><ByQuery><JournalFormPage /></ByQuery></Perm>} />
        <Route path="accounting/journals/:id" element={<Perm perm="accounting.view"><JournalDetailPage /></Perm>} />
        <Route path="accounting/journals/:id/edit" element={<Perm perm="accounting.create"><JournalFormPage /></Perm>} />
        <Route path="accounting/accounts" element={<Perm perm="accounting.view"><ChartOfAccountsPage /></Perm>} />
        <Route path="accounting/trial-balance" element={<Perm perm="accounting.view"><TrialBalancePage /></Perm>} />
        <Route path="accounting/periods" element={<Perm perm="accounting.view"><PeriodsPage /></Perm>} />

        <Route path="irrigation/seasons" element={<Perm perm="irrigation.view"><SeasonsPage /></Perm>} />
        <Route path="irrigation/rates" element={<Perm perm="irrigation.view"><RatesPage /></Perm>} />
        <Route path="irrigation/invoices" element={<Perm perm="irrigation.view"><InvoiceListPage /></Perm>} />
        <Route path="irrigation/invoices/new" element={<Perm perm="irrigation.create"><InvoiceFormPage /></Perm>} />
        <Route path="irrigation/invoices/bulk" element={<Perm perm="irrigation.create"><BulkInvoicePage /></Perm>} />
        <Route path="irrigation/invoices/:id" element={<Perm perm="irrigation.view"><InvoiceDetailPage /></Perm>} />
        <Route path="irrigation/dues" element={<Perm perm="irrigation.view"><DuesPage /></Perm>} />
        <Route path="irrigation/farmers/:id/statement" element={<Perm perm="irrigation.view"><FarmerStatementPage /></Perm>} />
        <Route path="irrigation/mismatch" element={<Perm perm="irrigation.view"><MismatchPage /></Perm>} />
        <Route path="irrigation/rate-audit" element={<Perm perm="irrigation.view"><RateAuditPage /></Perm>} />
        <Route path="payments/collect" element={<Perm perm="payment.create"><ByQuery><CollectionPage /></ByQuery></Perm>} />
        <Route path="payments/receipts" element={<Perm perm="payment.view"><ReceiptListPage /></Perm>} />
        <Route path="payments/receipts/:id" element={<Perm perm="payment.view"><ReceiptDetailPage /></Perm>} />

        {FUND_KINDS.map((k) => [
          <Route key={`${k}-a`} path={`funds/${k}/accounts`} element={<Perm perm={`${k}.view`}><FundAccountListPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-d`} path={`funds/${k}/accounts/:id`} element={<Perm perm={`${k}.view`}><FundAccountDetailPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-t`} path={`funds/${k}/transactions`} element={<Perm perm={`${k}.view`}><FundTxnListPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-s`} path={`funds/${k}/transactions/:id`} element={<Perm perm={`${k}.view`}><FundTxnDetailPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-u`} path={`funds/${k}/audit`} element={<Perm perm={`${k}.view`}><FundAuditPage key={k} kind={k} /></Perm>} />,
        ])}
        <Route path="funds/distributions" element={<Perm perm={['savings.view', 'share.view']}><DistributionListPage /></Perm>} />
        <Route path="funds/distributions/new/:kind" element={<Perm perm={['savings.edit', 'share.edit']}><DistributionFormPage /></Perm>} />
        <Route path="funds/distributions/:id" element={<Perm perm={['savings.view', 'share.view']}><DistributionDetailPage /></Perm>} />
        <Route path="loans" element={<Perm perm="loan.view"><ByQuery><LoanListPage /></ByQuery></Perm>} />
        <Route path="loans/new" element={<Perm perm="loan.create"><LoanFormPage /></Perm>} />
        <Route path="loans/products" element={<Perm perm="loan.view"><LoanProductsPage /></Perm>} />
        <Route path="loans/payments" element={<Perm perm="loan.view"><LoanPaymentListPage /></Perm>} />
        <Route path="loans/payments/:id" element={<Perm perm="loan.view"><LoanPaymentDetailPage /></Perm>} />
        <Route path="loans/dues" element={<Perm perm="loan.view"><LoanDuesPage /></Perm>} />
        <Route path="loans/audit" element={<Perm perm="loan.view"><LoanAuditPage /></Perm>} />
        <Route path="loans/lookup" element={<Perm perm="loan.view"><RecordLookupPage key="loan" kind="loan" title={tx('ঋণের বিস্তারিত')} /></Perm>} />
        <Route path="loans/lookup/schedule" element={<Perm perm="loan.view"><RecordLookupPage key="loan-s" kind="loan" tab="schedule" title={tx('ঋণের কিস্তিসূচি')} /></Perm>} />
        <Route path="loans/lookup/installments" element={<Perm perm="loan.view"><RecordLookupPage key="loan-i" kind="loan" tab="payments" title={tx('ঋণের কিস্তি')} /></Perm>} />
        <Route path="loans/:id" element={<Perm perm="loan.view"><LoanDetailPage /></Perm>} />


        <Route path="payments/combined" element={<Perm perm="payment.view"><CombinedPaymentListPage /></Perm>} />
        <Route path="payments/combined/new" element={<Perm perm="payment.create"><CombinedPaymentPage /></Perm>} />
        <Route path="payments/combined/:id" element={<Perm perm="payment.view"><CombinedPaymentDetailPage /></Perm>} />
        <Route path="cash/day-close" element={<Perm perm="cash.view"><ByQuery><DayClosePage /></ByQuery></Perm>} />
        <Route path="accounting/bank-reconciliations" element={<Perm perm="bank.view"><BankReconciliationListPage /></Perm>} />
        <Route path="accounting/bank-reconciliations/:id" element={<Perm perm="bank.view"><BankReconciliationDetailPage /></Perm>} />
        <Route path="qr/scan" element={<QrScannerPage />} />
        <Route path="qr/history" element={<QrHistoryPage />} />
        <Route path="q/:type/:code" element={<QrResolvePage />} />
        <Route path="assets/dashboard" element={<Perm perm="asset.view"><AssetDashboardPage /></Perm>} />
        <Route path="assets" element={<Perm perm="asset.view"><AssetListPage key="all" /></Perm>} />
        <Route path="assets/stock" element={<Perm perm="asset.view"><AssetListPage key="stock" preset="stock" /></Perm>} />
        <Route path="assets/sales" element={<Perm perm="asset.view"><AssetListPage key="disposal" preset="disposal" /></Perm>} />
        <Route path="assets/transfers" element={<Perm perm="asset.view"><AssetMovementsPage key="transfer" preset="transfer" /></Perm>} />
        <Route path="assets/installations" element={<Perm perm="asset.view"><AssetMovementsPage key="install" preset="install" /></Perm>} />
        <Route path="assets/repairs" element={<Perm perm="asset.view"><AssetMovementsPage key="repair" preset="repair" /></Perm>} />
        <Route path="assets/maintenances" element={<Perm perm="asset.view"><MaintenancePage /></Perm>} />
        <Route path="assets/depreciation" element={<Perm perm="asset.view"><DepreciationPage /></Perm>} />
        <Route path="assets/categories" element={<Perm perm="asset.view"><AssetCategoriesPage /></Perm>} />
        <Route path="assets/new" element={<Perm perm="asset.create"><AssetFormPage /></Perm>} />
        <Route path="assets/:id" element={<Perm perm="asset.view"><AssetDetailPage /></Perm>} />
        <Route path="assets/:id/edit" element={<Perm perm="asset.edit"><AssetFormPage /></Perm>} />

        <Route path="reports" element={<ReportCenterPage />} />
        {REPORT_ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={<ReportPage key={r.path} title={r.title} keys={r.keys} />} />
        ))}
        <Route path="farmers/deleted" element={<Perm perm="farmer.view"><DeletedFarmersPage /></Perm>} />
        <Route path="accounting/ledger-integrity" element={<Perm perm="accounting.view"><LedgerIntegrityPage /></Perm>} />
        <Route path="accounting/public-payments" element={<Perm perm="payment.view"><PublicPaymentsPage /></Perm>} />
        <Route path="audit/integrity-scan" element={<Perm perm="audit.view"><IntegrityScanPage /></Perm>} />
        <Route path="admin/receipt-serials" element={<Perm perm="settings.admin"><ReceiptSerialPage /></Perm>} />
        <Route path="settings/sms" element={<Perm perm={['settings.admin', 'sms.admin']}><SmsSettingsPage /></Perm>} />
        <Route path="settings/sms-templates" element={<Perm perm={['settings.admin', 'sms.admin']}><SmsTemplatesPage /></Perm>} />
        <Route path="settings/sms-logs" element={<Perm perm={['settings.admin', 'sms.view', 'sms.admin']}><SmsLogsPage /></Perm>} />
        <Route path="settings/financial-year" element={<Perm perm="settings.admin"><FinancialYearPage /></Perm>} />

        {Object.entries(SOON).map(([path, page]) => (
          <Route key={path} path={path.slice(1)} element={<ComingSoonPage page={page} />} />
        ))}

        <Route path="*" element={<Result status="404" title={tx('পাতা পাওয়া যায়নি')} />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
