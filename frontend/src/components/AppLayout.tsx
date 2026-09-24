import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Avatar, Badge, Button, Drawer, Dropdown, Grid, Layout, Menu, Spin, Typography, type MenuProps } from 'antd'
import {
  AccountBookOutlined,
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  BookOutlined,
  BorderOuterOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  DollarOutlined,
  ExperimentOutlined,
  HddOutlined,
  IdcardOutlined,
  ImportOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { digits, fmtDate } from '../lib/format'
import { usePublicSettings } from '../lib/settings'
import { lang, nameOf, t as tx } from '../lib/i18n'
import LanguageToggle from './LanguageToggle'

const { Header, Sider, Content, Footer } = Layout

/** Menu label: Bangla, or the exact English menu name in English mode. */
const m = (bn: string, en: string) => (lang === 'en' ? en : bn)

type Leaf = { path: string; label: string; perm?: string | string[]; superOnly?: boolean }
type Group = { key: string; label: string; icon: React.ReactNode; children: Leaf[] }

const ACC = ['accounting.view', 'cash.view', 'bank.view']

// The sidebar follows the society's own menu exactly. Items whose screen comes in a later phase open
// a "coming soon" page (lib/comingSoon.ts); an item may appear in more than one group.
const GROUPS: Group[] = [
  {
    key: 'g-farmers',
    label: m('কৃষক ও সদস্য', 'Farmers & Members'),
    icon: <IdcardOutlined />,
    children: [
      { path: '/farmers', label: m('কৃষক তালিকা', 'Farmer List'), perm: 'farmer.view' },
      { path: '/farmers/new', label: m('নতুন কৃষক', 'Add Farmer'), perm: 'farmer.create' },
      { path: '/membership/applications', label: m('সদস্যপদ আবেদন', 'Membership Applications'), perm: 'membership.view' },
      { path: '/members', label: m('সদস্য তালিকা', 'Member List'), perm: 'member.view' },
      { path: '/members/voters', label: m('ভোটার তালিকা', 'Voter List'), perm: 'member.view' },
      { path: '/farmers/merge', label: m('কৃষক একীকরণ', 'Farmer Merge'), perm: 'farmer.edit' },
      { path: '/farmers/deleted', label: m('মুছে ফেলা কৃষক', 'Deleted Farmers'), perm: 'farmer.view' },
      { path: '/masters/patwaris', label: m('পাটোয়ারী তালিকা', 'Patwari List'), perm: 'patwari.view' },
      { path: '/masters/mouzas', label: m('মৌজা ব্যবস্থাপনা', 'Mouza Management') },
    ],
  },
  {
    key: 'g-lands',
    label: m('জমি ব্যবস্থাপনা', 'Land Management'),
    icon: <BorderOuterOutlined />,
    children: [
      { path: '/lands', label: m('জমির তালিকা', 'Land List'), perm: 'land.view' },
      { path: '/lands/new', label: m('নতুন জমি', 'Add Land'), perm: 'land.create' },
      { path: '/lands/lookup', label: m('জমির প্রোফাইল', 'Land Profile'), perm: 'land.view' },
      { path: '/lands/owners', label: m('মালিক ও চাষি', 'Owner & Cultivator'), perm: 'land.view' },
      { path: '/lands/borga', label: m('বর্গা চাষ', 'Borga / Sharecropping'), perm: 'land.view' },
      { path: '/lands/transfers', label: m('জমি হস্তান্তর', 'Land Transfer'), perm: 'land.view' },
      { path: '/lands/lookup/history', label: m('জমির ইতিহাস', 'Land History'), perm: 'land.view' },
      { path: '/settings/land-types', label: m('জমির ধরন', 'Land Types'), perm: 'settings.admin' },
      { path: '/lands/reports', label: m('জমির রিপোর্ট', 'Land Reports'), perm: 'land.view' },
    ],
  },
  {
    key: 'g-irrigation',
    label: m('সেচ', 'Irrigation'),
    icon: <ExperimentOutlined />,
    children: [
      { path: '/irrigation/seasons', label: m('মৌসুম', 'Seasons'), perm: 'irrigation.view' },
      { path: '/irrigation/invoices', label: m('সেচ ইনভয়েস', 'Irrigation Invoices'), perm: 'irrigation.view' },
      { path: '/irrigation/rates', label: m('সেচের রেট', 'Irrigation Rates'), perm: 'irrigation.view' },
      { path: '/payments/collect?legacy=1', label: m('পুরোনো রশিদ এন্ট্রি', 'Old Receipt Entry'), perm: 'payment.create' },
      { path: '/irrigation/invoices/bulk', label: m('বিলিং ভাগের প্রিভিউ', 'Billing Split Preview'), perm: 'irrigation.create' },
      { path: '/irrigation/lookup', label: m('মৌসুম / জমির ধরন অনুসন্ধান', 'Season / Land-Type Lookup'), perm: 'irrigation.view' },
      { path: '/settings/irrigation-types', label: m('ক্যাটাগরি', 'Categories'), perm: 'settings.admin' },
      { path: '/irrigation/category-rates', label: m('ক্যাটাগরিভিত্তিক রেট', 'Category Rates'), perm: 'irrigation.view' },
      { path: '/irrigation/rate-audit', label: m('রেট অডিট ইতিহাস', 'Rate Audit History'), perm: 'irrigation.view' },
      { path: '/irrigation/mismatch', label: m('বকেয়া অমিল', 'Due Mismatch'), perm: 'irrigation.view' },
    ],
  },
  {
    key: 'g-savings',
    label: m('সঞ্চয়', 'Savings'),
    icon: <WalletOutlined />,
    children: [
      { path: '/funds/savings/transactions', label: m('সঞ্চয় জমা', 'Savings Entry'), perm: 'savings.view' },
      { path: '/funds/share/transactions', label: m('শেয়ার আদায়', 'Share Collection'), perm: 'share.view' },
      { path: '/funds/savings/accounts', label: m('বিবরণী', 'Statements'), perm: 'savings.view' },
      { path: '/members/voters', label: m('ভোটার তালিকা', 'Voter List'), perm: 'member.view' },
      { path: '/members/voter-history', label: m('ভোটার ইতিহাস', 'Voter History'), perm: 'member.view' },
      { path: '/members/voter-audit', label: m('ভোটার অডিট', 'Voter Audit'), perm: 'member.view' },
      { path: '/members/admission-register', label: m('ভর্তি রেজিস্টার', 'Admission Register'), perm: 'member.view' },
    ],
  },
  {
    key: 'g-loans',
    label: m('ঋণ', 'Loans'),
    icon: <BankOutlined />,
    children: [
      { path: '/loans', label: m('ঋণের তালিকা', 'Loan List'), perm: 'loan.view' },
      { path: '/loans?status=pending', label: m('অপেক্ষমাণ ঋণ', 'Pending Loans'), perm: 'loan.view' },
      { path: '/loans?status=approved', label: m('অনুমোদিত ঋণ', 'Approved Loans'), perm: 'loan.view' },
      { path: '/loans/new', label: m('ঋণের আবেদন', 'Loan Applications'), perm: 'loan.create' },
      { path: '/loans/products', label: m('ঋণের প্ল্যান', 'Loan Plans'), perm: 'loan.view' },
      { path: '/loans/lookup', label: m('ঋণের বিস্তারিত', 'Loan Details'), perm: 'loan.view' },
      { path: '/loans/lookup/schedule', label: m('ঋণের কিস্তিসূচি', 'Loan Schedule'), perm: 'loan.view' },
      { path: '/loans/lookup/installments', label: m('ঋণের কিস্তি', 'Loan Installments'), perm: 'loan.view' },
      { path: '/loans/payments', label: m('ঋণ পরিশোধ', 'Loan Payments'), perm: 'loan.view' },
      { path: '/loans/guarantors', label: m('জামিনদার', 'Guarantors'), perm: 'loan.view' },
      { path: '/loans/dues', label: m('ঋণের বকেয়া', 'Loan Due'), perm: 'loan.view' },
    ],
  },
  {
    key: 'g-cash',
    label: m('নগদ ও পেমেন্ট', 'Cash & Payments'),
    icon: <DollarOutlined />,
    children: [
      { path: '/payments/collect', label: m('পেমেন্ট', 'Payments'), perm: 'payment.create' },
      { path: '/payments/receipts', label: m('রশিদ তালিকা', 'Receipt List'), perm: 'payment.view' },
      { path: '/payments/combined', label: m('একত্রিত পেমেন্ট', 'Combined Payment'), perm: 'payment.view' },
      { path: '/qr/scan', label: m('QR স্ক্যানার', 'QR Scanner') },
      { path: '/qr/history', label: m('QR স্ক্যান ইতিহাস', 'QR Scan History') },
      { path: '/accounting/ledger', label: m('ক্যাশ বই', 'Cash Book'), perm: ACC },
      { path: '/accounting/funds', label: m('হাতে নগদ', 'Hand Cash'), perm: ['cash.view', 'bank.view'] },
      { path: '/cash/day-close?tab=register', label: m('নগদ অডিট', 'Cash Audit'), perm: 'cash.view' },
      { path: '/approvals', label: m('অনুমোদন', 'Approvals') },
    ],
  },
  {
    key: 'g-cashbook',
    label: m('ক্যাশ বই ও খতিয়ান', 'Cash Book & Ledger'),
    icon: <BookOutlined />,
    children: [
      { path: '/cashbook/irrigation', label: m('সেচ নগদ বিবরণী', 'Irrigation Cash Statement'), perm: ACC },
      { path: '/cashbook/society', label: m('সমিতির নগদ বিবরণী', 'Society Cash Statement'), perm: ACC },
      { path: '/cashbook/income-expense', label: m('আয়-ব্যয় নগদ বই', 'Income & Expense Cash Book'), perm: ACC },
      { path: '/accounting/ledger', label: m('ক্যাশ বই (খতিয়ান)', 'Cash Book (Ledger)'), perm: ACC },
      { path: '/audit/exports', label: m('Export অডিট', 'Export Audit'), perm: 'audit.view' },
    ],
  },
  {
    key: 'g-assets',
    label: m('সম্পদ', 'Assets'),
    icon: <HddOutlined />,
    children: [
      { path: '/assets/dashboard', label: m('সম্পদ ড্যাশবোর্ড', 'Asset Dashboard'), perm: 'asset.view' },
      { path: '/assets', label: m('সম্পদ রেজিস্টার', 'Asset Registry'), perm: 'asset.view' },
      { path: '/assets/stock', label: m('স্টক', 'Stock'), perm: 'asset.view' },
      { path: '/assets/transfers', label: m('সম্পদ স্থানান্তর', 'Asset Transfer'), perm: 'asset.view' },
      { path: '/assets/installations', label: m('স্থাপন', 'Installation'), perm: 'asset.view' },
      { path: '/assets/repairs', label: m('মেরামত', 'Repair'), perm: 'asset.view' },
      { path: '/assets/maintenances', label: m('মেরামত সূচি', 'Repair Schedule'), perm: 'asset.view' },
      { path: '/assets/sales', label: m('বিক্রয়', 'Sales'), perm: 'asset.view' },
      { path: '/qr/scan', label: m('QR স্ক্যানার', 'QR Scanner') },
      { path: '/qr/history', label: m('QR ইতিহাস', 'QR History') },
      { path: '/assets/reports', label: m('সম্পদের রিপোর্ট', 'Asset Reports'), perm: 'asset.view' },
    ],
  },
  {
    key: 'g-accounting',
    label: m('হিসাব', 'Accounting'),
    icon: <AccountBookOutlined />,
    children: [
      { path: '/accounting/summary', label: m('আর্থিক সারসংক্ষেপ', 'Financial Summary'), perm: 'accounting.view' },
      { path: '/accounting/accounts', label: m('হিসাবের তালিকা', 'Chart of Accounts'), perm: 'accounting.view' },
      { path: '/accounting/journals/new', label: m('জার্নাল এন্ট্রি', 'Journal Entries'), perm: 'accounting.create' },
      { path: '/accounting/periods', label: m('হিসাবকাল বন্ধ', 'Period Close'), perm: 'accounting.view' },
      { path: '/accounting/journals/new?type=opening', label: m('প্রারম্ভিক নগদ জের', 'Opening Cash Balance'), perm: 'accounting.create' },
      { path: '/accounting/source-vs-ledger', label: m('উৎস বনাম খতিয়ান', 'Source vs Ledger'), perm: 'accounting.view' },
      { path: '/accounting/irrigation-cash-bank', label: m('সেচের নগদ ও ব্যাংক', 'Irrigation Cash & Bank'), perm: ACC },
      { path: '/accounting/bank-reconciliations', label: m('মাসিক ব্যাংক মিলকরণ', 'Monthly Reconciliation'), perm: 'bank.view' },
      { path: '/funds/share/audit', label: m('শেয়ার মূলধন মিলকরণ', 'Share Capital Reconciliation'), perm: 'share.view' },
      { path: '/accounting/ledger-integrity', label: m('লেজার সঠিকতা', 'Ledger Integrity'), perm: 'accounting.view' },
      { path: '/accounting/bank-accounts', label: m('ব্যাংক হিসাব', 'Bank Accounts'), perm: 'bank.view' },
      { path: '/accounting/journals', label: m('ভাউচার', 'Vouchers'), perm: 'accounting.view' },
      { path: '/accounting/public-payments', label: m('অনলাইন পেমেন্ট অনুরোধ', 'Public Payment Requests'), perm: 'payment.view' },
      { path: '/accounting/payment-reconciliation', label: m('পেমেন্ট মিলকরণ', 'Payment Reconciliation'), perm: 'payment.view' },
    ],
  },
  {
    key: 'g-reports',
    label: m('রিপোর্ট', 'Reports'),
    icon: <BarChartOutlined />,
    children: [
      { path: '/reports/collections', label: m('আদায়ের রিপোর্ট', 'Collection Reports'), perm: 'payment.view' },
      { path: '/reports/dues', label: m('বকেয়ার রিপোর্ট', 'Due Reports'), perm: ['irrigation.view', 'loan.view'] },
      { path: '/reports/audit', label: m('অডিট রিপোর্ট', 'Audit Reports'), perm: 'audit.view' },
    ],
  },
  {
    key: 'g-audit',
    label: m('অডিট ও পর্যবেক্ষণ', 'Audit & Monitoring'),
    icon: <AuditOutlined />,
    children: [
      { path: '/audit/logs', label: m('সিস্টেম অডিট লগ', 'System Audit Log'), perm: 'audit.view' },
      { path: '/audit/integrity-scan', label: m('ডেটা সঠিকতা স্ক্যান', 'Data Integrity Scan'), perm: 'audit.view' },
      { path: '/cash/day-close', label: m('দৈনিক মিলকরণ', 'Day Reconciliation'), perm: 'cash.view' },
    ],
  },
  {
    key: 'g-admin',
    label: m('প্রশাসন', 'Admin'),
    icon: <TeamOutlined />,
    children: [
      { path: '/admin/users', label: m('ইউজার', 'Users'), perm: 'user.view' },
      { path: '/admin/roles', label: m('রোল', 'Roles'), perm: 'role.view' },
      { path: '/admin/permissions', label: m('অনুমতি', 'Permissions'), perm: 'role.view' },
      { path: '/masters/patwaris', label: m('পাটোয়ারী ব্যবস্থাপনা', 'Patwari Management'), perm: 'patwari.view' },
      { path: '/data-health', label: m('মৌজা ডেটা হেলথ', 'Mouza Data Health'), perm: 'land.view' },
      { path: '/accounting/ledger-integrity', label: m('লেজার সঠিকতা', 'Ledger Integrity'), perm: 'accounting.view' },
      { path: '/admin/receipt-serials', label: m('রশিদ সিরিয়াল প্রশাসন', 'Receipt Serial Admin'), perm: 'settings.admin' },
    ],
  },
  {
    key: 'g-tools',
    label: m('টুলস ও ইমপোর্ট', 'Tools & Import'),
    icon: <ImportOutlined />,
    children: [
      { path: '/imports?type=farmers', label: m('কৃষক ইমপোর্ট', 'Farmer Import'), perm: 'import.create' },
      { path: '/imports?type=lands', label: m('জমি ইমপোর্ট', 'Land Import'), perm: 'import.create' },
      { path: '/imports/savings-opening', label: m('সঞ্চয়ের প্রারম্ভিক ইমপোর্ট', 'Savings Opening Import'), perm: 'import.create' },
      { path: '/imports/share-opening', label: m('শেয়ারের প্রারম্ভিক ইমপোর্ট', 'Share Opening Import'), perm: 'import.create' },
      { path: '/imports/loan-opening', label: m('ঋণের প্রারম্ভিক ইমপোর্ট', 'Loan Opening Import'), perm: 'import.create' },
      { path: '/imports/payments', label: m('পেমেন্ট ইমপোর্ট', 'Payment Import'), perm: 'import.create' },
      { path: '/imports/legacy-irrigation', label: m('পুরোনো সেচ ডেটা ইমপোর্ট', 'Legacy Irrigation Import'), perm: 'import.create' },
      { path: '/imports/audit', label: m('ইমপোর্ট অডিট', 'Import Audit'), perm: 'import.create' },
    ],
  },
  {
    key: 'g-settings',
    label: m('সেটিংস', 'Settings'),
    icon: <SettingOutlined />,
    children: [
      { path: '/settings/general', label: m('সাধারণ সেটিংস', 'General Settings'), perm: 'settings.admin' },
      { path: '/settings/branding', label: m('ব্র্যান্ডিং ও লোগো', 'Branding & Logo'), perm: 'settings.admin' },
      { path: '/settings/receipt', label: m('রশিদ সেটিংস', 'Receipt Settings'), perm: 'settings.admin' },
      { path: '/settings/sms', label: m('SMS সেটিংস', 'SMS Settings'), perm: 'settings.admin' },
      { path: '/settings/sms-templates', label: m('SMS টেমপ্লেট', 'SMS Templates'), perm: 'settings.admin' },
      { path: '/settings/sms-logs', label: m('SMS লগ', 'SMS Logs'), perm: 'settings.admin' },
      { path: '/settings/financial-year', label: m('অর্থবছর', 'Financial Year'), perm: 'settings.admin' },
      { path: '/settings/preferences', label: m('সিস্টেম পছন্দসমূহ', 'System Preferences'), perm: 'settings.admin' },
      { path: '/settings/license', label: m('লাইসেন্স ও ইনস্টলেশন', 'License & Installation'), perm: 'settings.admin' },
    ],
  },
]

const HOME = '/'
const leafKey = (g: Group, l: Leaf) => `${g.key}|${l.path}`

/** The menu path that best matches the current URL: exact path+query, then exact path, then the longest parent path. */
function bestPath(pathname: string, search: string): string | null {
  let best: string | null = null
  let score = 0
  for (const g of GROUPS)
    for (const l of g.children) {
      const [p, q] = l.path.split('?')
      let s = 0
      if (q !== undefined) s = pathname === p && search === `?${q}` ? 3000 : 0
      else if (pathname === p) s = 2000
      else if (pathname.startsWith(p + '/')) s = 1000 + p.length
      if (s > score) {
        score = s
        best = l.path
      }
    }
  return best
}

const APP_VERSION = '1.0.0'

export default function AppLayout() {
  const { user, can, logout } = useAuth()
  const { data: settings } = usePublicSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isMobile = !screens.lg

  // shared office computers: sign out after the configured minutes without mouse/keyboard activity
  const idleMinutes = settings?.idle_logout_minutes ?? 0
  useEffect(() => {
    if (!idleMinutes) return
    let timer = 0
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => logout().then(() => navigate('/login?idle=1')), idleMinutes * 60_000)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [idleMinutes, logout, navigate])

  const license = user?.license
  const banner =
    license?.locked ? (
      <Alert
        type="error"
        banner
        title={tx('লাইসেন্সের মেয়াদ শেষ — সিস্টেম এখন শুধু দেখার জন্য। নতুন তথ্য যোগ বা পরিবর্তন করা যাবে না।')}
        action={<Link to="/settings/license">{tx('লাইসেন্স')}</Link>}
      />
    ) : license?.state === 'expiring' ? (
      <Alert
        type="warning"
        banner
        closable
        title={tx('লাইসেন্সের মেয়াদ {{p0}} তারিখে শেষ হবে (আর {{p1}} দিন)। সময়মতো নবায়ন করুন।', { p0: fmtDate(license.expires), p1: digits(license.days_left ?? 0) })}
      />
    ) : null

  const { data: pending } = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: async () => (await api.get<{ count: number }>('/approvals/pending-count')).data.count,
    refetchInterval: 60_000,
  })

  const items = useMemo(() => {
    const allowed = (n: Leaf) => (n.superOnly ? !!user?.is_super_admin : !n.perm || can(n.perm))
    const groups: MenuProps['items'] = GROUPS.map((g) => {
      const children = g.children.filter(allowed).map((l) => ({
        key: leafKey(g, l),
        label:
          l.path === '/approvals' && pending ? (
            <span>
              {l.label} <Badge count={digits(pending)} size="small" style={{ marginInlineStart: 6 }} />
            </span>
          ) : (
            l.label
          ),
      }))
      return children.length ? { key: g.key, label: g.label, icon: g.icon, children } : null
    }).filter(Boolean)
    return [{ key: HOME, label: m('ড্যাশবোর্ড', 'Dashboard'), icon: <DashboardOutlined /> }, ...(groups ?? [])]
  }, [can, user, pending])

  const best = location.pathname === HOME ? null : bestPath(location.pathname, location.search)
  const selectedKeys = best ? GROUPS.flatMap((g) => g.children.filter((l) => l.path === best).map((l) => leafKey(g, l))) : location.pathname === HOME ? [HOME] : []
  const openKeys = GROUPS.filter((g) => g.children.some((l) => l.path === best)).map((g) => g.key)

  const menu = (
    <Menu
      mode="inline"
      theme="dark"
      selectedKeys={selectedKeys}
      defaultOpenKeys={openKeys}
      items={items}
      onClick={({ key }) => {
        navigate(key === HOME ? HOME : key.slice(key.indexOf('|') + 1))
        setDrawerOpen(false)
      }}
    />
  )

  const brand = (
    <div style={{ padding: '16px', color: '#fff', fontWeight: 600, fontSize: 16, lineHeight: 1.3 }}>
      {nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }) || tx('সমবায় ERP')}
    </div>
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider width={250} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
          {brand}
          {menu}
        </Sider>
      )}
      {isMobile && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} placement="left" size={270} styles={{ body: { padding: 0, background: '#001529' } }} closable={false}>
          {brand}
          {menu}
        </Drawer>
      )}
      <Layout>
        <Header
          style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #eee' }}
          className="no-print"
        >
          {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label={tx('মেনু')} />}
          <div style={{ flex: 1 }} />
          <LanguageToggle signedIn />
          <Link to="/approvals">
            <Badge count={pending ? digits(pending) : 0}>
              <CheckSquareOutlined style={{ fontSize: 20 }} />
            </Badge>
          </Link>
          <Dropdown
            menu={{
              items: [
                { key: 'profile', icon: <UserOutlined />, label: tx('আমার প্রোফাইল'), onClick: () => navigate('/profile') },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: tx('লগআউট'), danger: true, onClick: () => logout().then(() => navigate('/login')) },
              ],
            }}
          >
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              {!isMobile && <span>{nameOf(user)}</span>}
            </Button>
          </Dropdown>
        </Header>
        {banner && <div className="no-print">{banner}</div>}
        <Content style={{ padding: isMobile ? 16 : 24 }}>
          <Suspense fallback={<Spin style={{ display: 'block', marginTop: 48 }} />}>
            <Outlet />
          </Suspense>
        </Content>
        <Footer style={{ textAlign: 'center', padding: '12px 16px' }} className="no-print">
          <Typography.Text type="secondary">{tx('সমবায় সমিতি ও কৃষি সেচ ERP · সংস্করণ')}{' '}{digits(APP_VERSION)}</Typography.Text>
        </Footer>
      </Layout>
    </Layout>
  )
}
