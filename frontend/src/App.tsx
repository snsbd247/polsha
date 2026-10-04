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
const LandTimelinePage = lazy(() => import('./pages/lands/LandTimelinePage'))
const LandReportsPage = lazy(() => import('./pages/lands/LandReportsPage'))
const DataHealthPage = lazy(() => import('./pages/lands/DataHealthPage'))
const ImportPage = lazy(() => import('./pages/lands/ImportPage'))
const ImportTypePage = lazy(() => import('./pages/imports/ImportTypePage'))
const ImportAuditPage = lazy(() => import('./pages/imports/ImportAuditPage'))
const BrandingSettingsPage = lazy(() => import('./pages/settings/BrandingSettingsPage'))
const ReceiptSettingsPage = lazy(() => import('./pages/settings/ReceiptSettingsPage'))
const PreferencesPage = lazy(() => import('./pages/settings/PreferencesPage'))
const LicensePage = lazy(() => import('./pages/settings/LicensePage'))
const WebsiteSettingsPage = lazy(() => import('./pages/settings/WebsiteSettingsPage'))
const LandTypesPage = lazy(() => import('./pages/settings/LandTypesPage'))
const ChartOfAccountsPage = lazy(() => import('./pages/accounting/ChartOfAccountsPage'))
const JournalListPage = lazy(() => import('./pages/accounting/JournalListPage'))
const JournalFormPage = lazy(() => import('./pages/accounting/JournalFormPage'))
const JournalDetailPage = lazy(() => import('./pages/accounting/JournalDetailPage'))
const FundsPage = lazy(() => import('./pages/accounting/FundsPage'))
const LedgerPage = lazy(() => import('./pages/accounting/LedgerPage'))
const FundStatementPage = lazy(() => import('./pages/cashbook/FundStatementPage'))
const IncomeExpenseBookPage = lazy(() => import('./pages/cashbook/IncomeExpenseHub'))
const ExportAuditPage = lazy(() => import('./pages/cashbook/ExportAuditPage'))
const BankAccountsPage = lazy(() => import('./pages/accounting/BankAccountsPage'))
const TrialBalancePage = lazy(() => import('./pages/accounting/TrialBalancePage'))
const PeriodsPage = lazy(() => import('./pages/accounting/PeriodsPage'))
const IrrigationTypesPage = lazy(() => import('./pages/settings/IrrigationTypesPage'))
const LookupPage = lazy(() => import('./pages/irrigation/LookupPage'))
const RateProposePage = lazy(() => import('./pages/irrigation/RateProposePage'))
const SeasonsPage = lazy(() => import('./pages/irrigation/SeasonsPage'))
const SeasonFormPage = lazy(() => import('./pages/irrigation/SeasonFormPage'))
const SeasonDetailPage = lazy(() => import('./pages/irrigation/SeasonDetailPage'))
const RatesHubPage = lazy(() => import('./pages/irrigation/IrrigationHubs').then((m) => ({ default: m.RatesHubPage })))
const BillingHubPage = lazy(() => import('./pages/irrigation/IrrigationHubs').then((m) => ({ default: m.BillingHubPage })))
const InvoiceListPage = lazy(() => import('./pages/irrigation/InvoiceListPage'))
const InvoiceDetailPage = lazy(() => import('./pages/irrigation/InvoiceDetailPage'))
const DuesPage = lazy(() => import('./pages/irrigation/DuesPage'))
const FarmerStatementPage = lazy(() => import('./pages/irrigation/FarmerStatementPage'))
const MismatchPage = lazy(() => import('./pages/irrigation/MismatchPage'))
const CollectHubPage = lazy(() => import('./pages/payments/PaymentHubs').then((m) => ({ default: m.CollectHubPage })))
const ReceiptsHubPage = lazy(() => import('./pages/payments/PaymentHubs').then((m) => ({ default: m.ReceiptsHubPage })))
const OldReceiptListPage = lazy(() => import('./pages/payments/OldReceiptListPage'))
const OldReceiptFormPage = lazy(() => import('./pages/payments/OldReceiptFormPage'))
const ReceiptDetailPage = lazy(() => import('./pages/payments/ReceiptDetailPage'))
const FundAccountListPage = lazy(() => import('./pages/funds/FundAccountListPage'))
const FundAccountDetailPage = lazy(() => import('./pages/funds/FundAccountDetailPage'))
const FundTxnListPage = lazy(() => import('./pages/funds/FundTxnListPage'))
const FundTxnDetailPage = lazy(() => import('./pages/funds/FundTxnDetailPage'))
const FundAuditPage = lazy(() => import('./pages/funds/FundAuditPage'))
const EntryListPage = lazy(() => import('./pages/savings/EntryListPage'))
const EntryFormPage = lazy(() => import('./pages/savings/EntryFormPage'))
const EntryDetailPage = lazy(() => import('./pages/savings/EntryDetailPage'))
const WithdrawalApprovalPage = lazy(() => import('./pages/savings/WithdrawalApprovalPage'))
const AccountListPage = lazy(() => import('./pages/savings/AccountListPage'))
const AccountClosePage = lazy(() => import('./pages/savings/AccountClosePage'))
const AccountHistoryPage = lazy(() => import('./pages/savings/AccountHistoryPage'))
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
const FieldCollectPage = lazy(() => import('./pages/field/FieldCollectPage'))
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
const AssetReportsPage = lazy(() => import('./pages/assets/AssetReportsPage'))
const ReportHub = lazy(() => import('./components/ReportHub'))
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
const LandingPage = lazy(() => import('./pages/site/LandingPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))

const ACC_SECTION = { label: tx('হিসাব'), to: '/accounting/summary' }

const MEMBERS_SECTION = { label: tx('কৃষক ও সদস্য'), to: '/members' }
const REPORTS_SECTION = { label: tx('রিপোর্ট'), to: '/reports/collections' }

/** Menu items that are simply one or more server reports (the page shows only those the user may open). */
const REPORT_ROUTES: { path: string; title: string; keys: string[]; section: { label: string; to: string } }[] = [
  { path: 'members/voter-history', title: tx('ভোটার ইতিহাস'), keys: ['voter_lists', 'voters'], section: MEMBERS_SECTION },
  { path: 'members/voter-audit', title: tx('ভোটার অডিট'), keys: ['voter_changes'], section: MEMBERS_SECTION },
  { path: 'loans/guarantors', title: tx('জামিনদার'), keys: ['guarantors'], section: { label: tx('ঋণ'), to: '/loans' } },
  {
    path: 'reports/collections',
    title: tx('আদায়ের রিপোর্ট'),
    keys: ['collection_daily', 'collection_by_user', 'irrigation_collection', 'loan_collection', 'savings_collection', 'combined_payments'],
    section: REPORTS_SECTION,
  },
  { path: 'reports/dues', title: tx('বকেয়ার রিপোর্ট'), keys: ['irrigation_due', 'loan_due'], section: REPORTS_SECTION },
  { path: 'reports/audit', title: tx('অডিট রিপোর্ট'), keys: ['audit_activity', 'audit_summary', 'approvals', 'cancellations', 'login_history'], section: REPORTS_SECTION },
]

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spin fullscreen />
  // visitors at the root see the public website; every other page still asks for a login
  if (!user && location.pathname === '/') return <LandingPage />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

/** Remount when the query string changes: for pages that read a ?preset once (menu items like /loans?status=pending). */
/** The menu's Old Receipt Entry opens /payments/collect?legacy=1; the plain path is irrigation collection. */
function CollectRoute() {
  const { search, hash } = useLocation()
  if (new URLSearchParams(search).get('legacy') !== '1') return <CollectHubPage />
  // the add form keeps the menu's exact query, so the menu still marks Old Receipt Entry
  return hash === '#new' ? <OldReceiptFormPage /> : <OldReceiptListPage />
}

/** The one-plot invoice form is a tab of বিল তৈরি now (?land_id kept). */
function ToBilling() {
  const { search } = useLocation()
  const q = new URLSearchParams(search)
  q.set('view', 'one')
  return <Navigate to={`/irrigation/invoices/bulk?${q.toString()}`} replace />
}

/** The old combined-payment form address (?farmer_id kept) opens টাকা আদায়. */
function ToCollect() {
  const { search } = useLocation()
  return <Navigate to={`/payments/collect${search}`} replace />
}

function ByQuery({ children }: { children: ReactNode }) {
  const { search } = useLocation()
  return <Fragment key={search}>{children}</Fragment>
}

function Perm({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth()
  return can(perm) ? <>{children}</> : <Result status="403" title={tx('অনুমতি নেই')} subTitle={tx('এই পাতা দেখার অনুমতি আপনার নেই।')} />
}

/** A field collector only collects: they land straight on their phone screen instead of the dashboard. */
function Home() {
  const { can } = useAuth()
  const fieldOnly = can('field.create') && !can(['farmer.view', 'payment.view', 'member.view', 'land.view', 'irrigation.view', 'loan.view', 'savings.view', 'accounting.view'])
  return fieldOnly ? <Navigate to="/payments/field" replace /> : <DashboardPage />
}

export default function App() {
  return (
    <Suspense fallback={<Spin fullscreen />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/verify/:kind/:token" element={<VerifyReceiptPage />} />
      <Route path="/pay" element={<PublicPaymentPage />} />
      <Route path="/site" element={<LandingPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
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
        <Route path="settings/website" element={<Perm perm="settings.admin"><WebsiteSettingsPage /></Perm>} />
        <Route path="settings/sequences" element={<Perm perm="settings.admin"><SequencePage /></Perm>} />
        <Route path="settings/land-types" element={<Perm perm="settings.admin"><LandTypesPage /></Perm>} />
        <Route path="settings/irrigation-types" element={<Perm perm="settings.admin"><IrrigationTypesPage /></Perm>} />

        <Route path="lands" element={<Perm perm="land.view"><LandListPage /></Perm>} />
        <Route path="lands/new" element={<Perm perm="land.create"><LandFormPage /></Perm>} />
        <Route path="lands/lookup" element={<Perm perm="land.view"><LandDetailPage /></Perm>} />
        <Route path="lands/lookup/history" element={<Perm perm="land.view"><LandHistoryPage /></Perm>} />
        <Route path="lands/lookup/history/:id" element={<Perm perm="land.view"><LandTimelinePage /></Perm>} />
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
        <Route path="cashbook/irrigation" element={<Perm perm={['accounting.view', 'cash.view', 'bank.view']}><FundStatementPage key="irrigation" stream="irrigation" /></Perm>} />
        <Route path="cashbook/society" element={<Perm perm={['accounting.view', 'cash.view', 'bank.view']}><FundStatementPage key="society" stream="society" /></Perm>} />
        <Route path="cashbook/income-expense" element={<Perm perm={['accounting.view', 'cash.view', 'bank.view']}><IncomeExpenseBookPage /></Perm>} />
        <Route path="audit/exports" element={<Perm perm="audit.view"><ExportAuditPage /></Perm>} />
        <Route path="accounting/bank-accounts" element={<Perm perm="bank.view"><BankAccountsPage /></Perm>} />
        <Route path="accounting/journals" element={<Perm perm="accounting.view"><JournalListPage /></Perm>} />
        <Route path="accounting/journals/new" element={<Perm perm="accounting.create"><ByQuery><JournalFormPage /></ByQuery></Perm>} />
        <Route path="accounting/journals/:id" element={<Perm perm="accounting.view"><JournalDetailPage /></Perm>} />
        <Route path="accounting/journals/:id/edit" element={<Perm perm="accounting.create"><JournalFormPage /></Perm>} />
        <Route path="accounting/accounts" element={<Perm perm="accounting.view"><ChartOfAccountsPage /></Perm>} />
        <Route path="accounting/trial-balance" element={<Perm perm="accounting.view"><TrialBalancePage /></Perm>} />
        <Route path="accounting/periods" element={<Perm perm="accounting.view"><PeriodsPage /></Perm>} />

        <Route path="irrigation/seasons" element={<Perm perm="irrigation.view"><SeasonsPage /></Perm>} />
        <Route path="irrigation/seasons/new" element={<Perm perm="irrigation.edit"><SeasonFormPage key="new" /></Perm>} />
        <Route path="irrigation/seasons/:id" element={<Perm perm="irrigation.view"><SeasonDetailPage /></Perm>} />
        <Route path="irrigation/seasons/:id/edit" element={<Perm perm="irrigation.edit"><SeasonFormPage /></Perm>} />
        <Route path="irrigation/rates" element={<Perm perm="irrigation.view"><ByQuery><RatesHubPage /></ByQuery></Perm>} />
        <Route path="irrigation/lookup" element={<Perm perm="irrigation.view"><LookupPage /></Perm>} />
        <Route path="irrigation/category-rates" element={<Navigate to="/irrigation/rates?view=grid" replace />} />
        <Route path="irrigation/rates/new" element={<Perm perm="irrigation.edit"><RateProposePage /></Perm>} />
        <Route path="irrigation/invoices" element={<Perm perm="irrigation.view"><InvoiceListPage /></Perm>} />
        <Route path="irrigation/invoices/new" element={<ToBilling />} />
        <Route path="irrigation/invoices/bulk" element={<Perm perm="irrigation.create"><ByQuery><BillingHubPage /></ByQuery></Perm>} />
        <Route path="irrigation/invoices/:id" element={<Perm perm="irrigation.view"><InvoiceDetailPage /></Perm>} />
        <Route path="irrigation/dues" element={<Perm perm="irrigation.view"><DuesPage /></Perm>} />
        <Route path="irrigation/farmers/:id/statement" element={<Perm perm="irrigation.view"><FarmerStatementPage /></Perm>} />
        <Route path="irrigation/mismatch" element={<Perm perm="irrigation.view"><MismatchPage /></Perm>} />
        <Route path="irrigation/rate-audit" element={<Navigate to="/irrigation/rates?view=history" replace />} />
        <Route path="payments/collect" element={<Perm perm="payment.create"><ByQuery><CollectRoute /></ByQuery></Perm>} />
        <Route path="payments/receipts" element={<Perm perm="payment.view"><ByQuery><ReceiptsHubPage /></ByQuery></Perm>} />
        <Route path="payments/receipts/:id" element={<Perm perm="payment.view"><ReceiptDetailPage /></Perm>} />

        {FUND_KINDS.map((k) => [
          <Route key={`${k}-a`} path={`funds/${k}/accounts`} element={<Perm perm={`${k}.view`}><FundAccountListPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-d`} path={`funds/${k}/accounts/:id`} element={<Perm perm={`${k}.view`}><FundAccountDetailPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-t`} path={`funds/${k}/transactions`} element={<Perm perm={`${k}.view`}><FundTxnListPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-s`} path={`funds/${k}/transactions/:id`} element={<Perm perm={`${k}.view`}><FundTxnDetailPage key={k} kind={k} /></Perm>} />,
          <Route key={`${k}-u`} path={`funds/${k}/audit`} element={<Perm perm={`${k}.view`}><FundAuditPage key={k} kind={k} /></Perm>} />,
        ])}
        <Route path="savings/accounts" element={<Perm perm={['savings.view', 'share.view']}><AccountListPage /></Perm>} />
        <Route path="savings/accounts/close" element={<Perm perm={['savings.view', 'share.view']}><AccountClosePage /></Perm>} />
        <Route path="savings/accounts/history" element={<Perm perm={['savings.view', 'share.view']}><AccountHistoryPage /></Perm>} />
        <Route path="savings/shares" element={<Perm perm="share.view"><EntryListPage key="share" entry="share" /></Perm>} />
        <Route path="savings/shares/new" element={<Perm perm="share.create"><EntryFormPage key="share" entry="share" /></Perm>} />
        <Route path="savings/shares/details/:id" element={<Perm perm="share.view"><EntryDetailPage key="share" entry="share" /></Perm>} />
        <Route path="savings/withdrawals" element={<Perm perm="savings.view"><EntryListPage key="withdrawal" entry="withdrawal" /></Perm>} />
        <Route path="savings/withdrawals/new" element={<Perm perm="savings.create"><EntryFormPage key="withdrawal" entry="withdrawal" /></Perm>} />
        <Route path="savings/withdrawals/details/:id" element={<Perm perm="savings.view"><EntryDetailPage key="withdrawal" entry="withdrawal" /></Perm>} />
        <Route path="savings/withdrawals/approval" element={<Perm perm="savings.view"><WithdrawalApprovalPage /></Perm>} />
        {/* addresses of the earlier savings menu (bookmarks) land on the new pages */}
        <Route path="savings/reports/*" element={<Navigate to="/reports" replace />} />
        <Route path="savings/*" element={<Navigate to="/savings/accounts" replace />} />
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
        {/* one loan's details, schedule and instalments are tabs of the loan page now; old links land on the list */}
        <Route path="loans/lookup/*" element={<Navigate to="/loans" replace />} />
        <Route path="loans/lookup" element={<Navigate to="/loans" replace />} />
        <Route path="loans/:id" element={<Perm perm="loan.view"><LoanDetailPage /></Perm>} />


        {/* one collection screen and one receipts page now; old links land there */}
        <Route path="payments/combined" element={<Navigate to="/payments/receipts" replace />} />
        <Route path="payments/field" element={<Perm perm={['field.create', 'field.view', 'field.approve']}><FieldCollectPage /></Perm>} />
        <Route path="payments/combined/new" element={<ToCollect />} />
        <Route path="payments/combined/:id" element={<Perm perm="payment.view"><CombinedPaymentDetailPage /></Perm>} />
        <Route path="cash/day-close" element={<Perm perm="cash.view"><ByQuery><DayClosePage /></ByQuery></Perm>} />
        <Route path="accounting/bank-reconciliations" element={<Perm perm="bank.view"><BankReconciliationListPage /></Perm>} />
        <Route path="accounting/bank-reconciliations/:id" element={<Perm perm="bank.view"><BankReconciliationDetailPage /></Perm>} />
        <Route path="qr/scan" element={<QrScannerPage />} />
        <Route path="qr/history" element={<QrHistoryPage />} />
        <Route path="q/:type/:code" element={<QrResolvePage />} />
        <Route path="assets/dashboard" element={<Perm perm="asset.view"><AssetDashboardPage /></Perm>} />
        <Route path="assets/reports" element={<Perm perm="asset.view"><AssetReportsPage /></Perm>} />
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
          <Route key={r.path} path={r.path} element={<ReportHub key={r.path} section={r.section} title={r.title} reports={r.keys.map((key) => ({ key }))} />} />
        ))}
        <Route path="farmers/deleted" element={<Perm perm="farmer.view"><DeletedFarmersPage /></Perm>} />
        <Route path="accounting/summary" element={<ReportHub key="summary" section={ACC_SECTION} title={tx('আর্থিক সারসংক্ষেপ')} reports={[{ key: 'income_statement' }, { key: 'balance_sheet' }, { key: 'cash_flow' }]} />} />
        <Route path="accounting/source-vs-ledger" element={<ReportHub key="svl" section={ACC_SECTION} title={tx('উৎস বনাম খতিয়ান')} reports={[{ key: 'source_vs_ledger' }]} />} />
        <Route path="accounting/irrigation-cash-bank" element={<ReportHub key="icb" section={ACC_SECTION} title={tx('সেচের নগদ ও ব্যাংক')} reports={[{ key: 'irrigation_cash_bank' }]} />} />
        <Route path="accounting/payment-reconciliation" element={<ReportHub key="prec" section={ACC_SECTION} title={tx('পেমেন্ট মিলকরণ')} reports={[{ key: 'payment_reconciliation' }]} />} />
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
