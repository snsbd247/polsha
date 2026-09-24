import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Result, Spin } from 'antd'
import { useAuth } from './auth/AuthContext'
import AppLayout from './components/AppLayout'
import { t as tx } from './lib/i18n'
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
const DataHealthPage = lazy(() => import('./pages/lands/DataHealthPage'))
const ImportPage = lazy(() => import('./pages/lands/ImportPage'))
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

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spin fullscreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  return <>{children}</>
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
        <Route path="farmers/merge" element={<Perm perm="farmer.edit"><MergePage /></Perm>} />
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
        <Route path="settings/sequences" element={<Perm perm="settings.admin"><SequencePage /></Perm>} />
        <Route path="settings/land-types" element={<Perm perm="settings.admin"><LandTypesPage /></Perm>} />

        <Route path="lands" element={<Perm perm="land.view"><LandListPage /></Perm>} />
        <Route path="lands/new" element={<Perm perm="land.create"><LandFormPage /></Perm>} />
        <Route path="lands/:id" element={<Perm perm="land.view"><LandDetailPage /></Perm>} />
        <Route path="lands/:id/edit" element={<Perm perm="land.edit"><LandFormPage /></Perm>} />
        <Route path="data-health" element={<Perm perm="land.view"><DataHealthPage /></Perm>} />
        <Route path="imports" element={<Perm perm="import.create"><ImportPage /></Perm>} />

        <Route path="accounting/funds" element={<Perm perm={['cash.view', 'bank.view']}><FundsPage /></Perm>} />
        <Route path="accounting/ledger" element={<Perm perm={['accounting.view', 'cash.view', 'bank.view']}><LedgerPage /></Perm>} />
        <Route path="accounting/bank-accounts" element={<Perm perm="bank.view"><BankAccountsPage /></Perm>} />
        <Route path="accounting/journals" element={<Perm perm="accounting.view"><JournalListPage /></Perm>} />
        <Route path="accounting/journals/new" element={<Perm perm="accounting.create"><JournalFormPage /></Perm>} />
        <Route path="accounting/journals/:id" element={<Perm perm="accounting.view"><JournalDetailPage /></Perm>} />
        <Route path="accounting/journals/:id/edit" element={<Perm perm="accounting.create"><JournalFormPage /></Perm>} />
        <Route path="accounting/accounts" element={<Perm perm="accounting.view"><ChartOfAccountsPage /></Perm>} />
        <Route path="accounting/trial-balance" element={<Perm perm="accounting.view"><TrialBalancePage /></Perm>} />
        <Route path="accounting/periods" element={<Perm perm="accounting.view"><PeriodsPage /></Perm>} />

        <Route path="*" element={<Result status="404" title={tx('পাতা পাওয়া যায়নি')} />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
