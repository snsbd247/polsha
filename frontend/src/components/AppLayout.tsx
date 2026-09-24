import { Suspense, useMemo, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Badge, Button, Drawer, Dropdown, Grid, Layout, Menu, Spin, Typography, type MenuProps } from 'antd'
import {
  AccountBookOutlined,
  AuditOutlined,
  BankOutlined,
  BorderOuterOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  EnvironmentOutlined,
  ExperimentOutlined,
  IdcardOutlined,
  LogoutOutlined,
  SolutionOutlined,
  MenuOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { digits } from '../lib/format'
import { usePublicSettings } from '../lib/settings'
import { nameOf, t as tx } from '../lib/i18n'
import LanguageToggle from './LanguageToggle'

const { Header, Sider, Content, Footer } = Layout

type NavItem = { key: string; label: string; icon?: React.ReactNode; perm?: string | string[]; superOnly?: boolean; children?: NavItem[] }

const NAV: NavItem[] = [
  { key: '/', label: tx('ড্যাশবোর্ড'), icon: <DashboardOutlined /> },
  { key: '/approvals', label: tx('অনুমোদন'), icon: <CheckSquareOutlined /> },
  {
    key: 'farmers-menu',
    label: tx('কৃষক'),
    icon: <IdcardOutlined />,
    children: [
      { key: '/farmers', label: tx('কৃষক তালিকা'), perm: 'farmer.view' },
      { key: '/farmers/new', label: tx('নতুন কৃষক'), perm: 'farmer.create' },
      { key: '/farmers/duplicates', label: tx('ডুপ্লিকেট পর্যালোচনা'), perm: 'farmer.view' },
      { key: '/households', label: tx('খানা'), perm: 'farmer.view' },
    ],
  },
  {
    key: 'members-menu',
    label: tx('সদস্য'),
    icon: <SolutionOutlined />,
    children: [
      { key: '/membership/applications', label: tx('সদস্যপদ আবেদন'), perm: 'membership.view' },
      { key: '/members', label: tx('সদস্য তালিকা'), perm: 'member.view' },
      { key: '/members/admission-register', label: tx('ভর্তি রেজিস্টার'), perm: 'member.view' },
      { key: '/members/voters', label: tx('ভোটার তালিকা'), perm: 'member.view' },
    ],
  },
  {
    key: 'lands-menu',
    label: tx('জমি'),
    icon: <BorderOuterOutlined />,
    children: [
      { key: '/lands', label: tx('জমির তালিকা'), perm: 'land.view' },
      { key: '/lands/new', label: tx('নতুন জমি'), perm: 'land.create' },
      { key: '/data-health', label: 'Data Health', perm: 'land.view' },
      { key: '/imports', label: 'Import (Excel/CSV)', perm: 'import.create' },
    ],
  },
  {
    key: 'irrigation-menu',
    label: tx('সেচ ও রশিদ'),
    icon: <ExperimentOutlined />,
    children: [
      { key: '/payments/collect', label: tx('টাকা আদায়'), perm: 'payment.create' },
      { key: '/payments/receipts', label: tx('টাকার রশিদ'), perm: 'payment.view' },
      { key: '/irrigation/invoices', label: tx('সেচ ইনভয়েস'), perm: 'irrigation.view' },
      { key: '/irrigation/dues', label: tx('বকেয়া তালিকা'), perm: 'irrigation.view' },
      { key: '/irrigation/seasons', label: tx('মৌসুম'), perm: 'irrigation.view' },
      { key: '/irrigation/rates', label: tx('সেচের রেট'), perm: 'irrigation.view' },
      { key: '/irrigation/rate-audit', label: tx('রেট অডিট'), perm: 'irrigation.view' },
      { key: '/irrigation/mismatch', label: tx('বকেয়া মিলকরণ'), perm: 'irrigation.view' },
    ],
  },
  {
    key: 'funds-menu',
    label: tx('সঞ্চয় ও শেয়ার'),
    icon: <WalletOutlined />,
    children: [
      { key: '/funds/savings/accounts', label: tx('সঞ্চয় হিসাব'), perm: 'savings.view' },
      { key: '/funds/savings/transactions', label: tx('সঞ্চয়ের লেনদেন'), perm: 'savings.view' },
      { key: '/funds/savings/audit', label: tx('সঞ্চয় অডিট'), perm: 'savings.view' },
      { key: '/funds/share/accounts', label: tx('শেয়ার মূলধন বিবরণী'), perm: 'share.view' },
      { key: '/funds/share/transactions', label: tx('শেয়ারের লেনদেন'), perm: 'share.view' },
      { key: '/funds/share/audit', label: tx('শেয়ার মূলধন মিলকরণ'), perm: 'share.view' },
      { key: '/funds/distributions', label: tx('মুনাফা ও লভ্যাংশ'), perm: ['savings.view', 'share.view'] },
    ],
  },
  {
    key: 'loans-menu',
    label: tx('ঋণ'),
    icon: <BankOutlined />,
    children: [
      { key: '/loans', label: tx('ঋণের তালিকা'), perm: 'loan.view' },
      { key: '/loans/new', label: tx('ঋণের আবেদন'), perm: 'loan.create' },
      { key: '/loans/payments', label: tx('ঋণ পরিশোধ ও রশিদ'), perm: 'loan.view' },
      { key: '/loans/dues', label: tx('ঋণের বকেয়া ও Aging'), perm: 'loan.view' },
      { key: '/loans/products', label: tx('ঋণের ধরন'), perm: 'loan.view' },
      { key: '/loans/audit', label: tx('ঋণ অডিট'), perm: 'loan.view' },
    ],
  },
  {
    key: 'masters',
    label: tx('এলাকা ও মৌজা'),
    icon: <EnvironmentOutlined />,
    children: [
      { key: '/masters/locations', label: tx('এলাকা') },
      { key: '/masters/mouzas', label: tx('মৌজা') },
      { key: '/masters/patwaris', label: tx('পাতওয়ারী'), perm: 'patwari.view' },
    ],
  },
  {
    key: 'accounting-menu',
    label: tx('হিসাব ও তহবিল'),
    icon: <AccountBookOutlined />,
    children: [
      { key: '/accounting/funds', label: tx('নগদ ও ব্যাংক অবস্থান'), perm: ['cash.view', 'bank.view'] },
      { key: '/accounting/ledger', label: tx('ক্যাশ বই / খতিয়ান'), perm: ['accounting.view', 'cash.view', 'bank.view'] },
      { key: '/accounting/bank-accounts', label: tx('ব্যাংক হিসাব'), perm: 'bank.view' },
      { key: '/accounting/journals', label: tx('ভাউচার'), perm: 'accounting.view' },
      { key: '/accounting/accounts', label: tx('হিসাবের তালিকা'), perm: 'accounting.view' },
      { key: '/accounting/trial-balance', label: tx('রেওয়ামিল'), perm: 'accounting.view' },
      { key: '/accounting/periods', label: tx('হিসাবকাল'), perm: 'accounting.view' },
    ],
  },
  { key: '/audit/logs', label: tx('অডিট লগ'), icon: <AuditOutlined />, perm: 'audit.view' },
  {
    key: 'admin',
    label: tx('প্রশাসন'),
    icon: <TeamOutlined />,
    children: [
      { key: '/admin/users', label: tx('ইউজার'), perm: 'user.view' },
      { key: '/admin/roles', label: tx('রোল ও অনুমতি'), perm: 'role.view' },
      { key: '/admin/approval-rules', label: tx('অনুমোদনের নিয়ম'), perm: 'approval.admin' },
      { key: '/admin/backups', label: tx('ব্যাকআপ'), superOnly: true },
    ],
  },
  {
    key: 'settings',
    label: tx('সেটিংস'),
    icon: <SettingOutlined />,
    children: [
      { key: '/settings/general', label: tx('সাধারণ'), perm: 'settings.admin' },
      { key: '/settings/sequences', label: tx('সিরিয়াল নম্বর'), perm: 'settings.admin' },
      { key: '/settings/land-types', label: tx('জমির ধরন'), perm: 'settings.admin' },
      { key: '/settings/irrigation-types', label: tx('সেচের ধরন'), perm: 'settings.admin' },
    ],
  },
]

export default function AppLayout() {
  const { user, can, logout } = useAuth()
  const { data: settings } = usePublicSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isMobile = !screens.lg

  const { data: pending } = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: async () => (await api.get<{ count: number }>('/approvals/pending-count')).data.count,
    refetchInterval: 60_000,
  })

  const items = useMemo(() => {
    const allowed = (n: NavItem) => (n.superOnly ? !!user?.is_super_admin : !n.perm || can(n.perm))
    const build = (list: NavItem[]): MenuProps['items'] =>
      list
        .filter(allowed)
        .map((n) => {
          if (n.children) {
            const children = build(n.children)
            return children && children.length ? { key: n.key, label: n.label, icon: n.icon, children } : null
          }
          const label =
            n.key === '/approvals' && pending ? (
              <span>
                {n.label} <Badge count={digits(pending)} size="small" style={{ marginInlineStart: 6 }} />
              </span>
            ) : (
              n.label
            )
          return { key: n.key, label, icon: n.icon }
        })
        .filter(Boolean)
    return build(NAV)
  }, [can, user, pending])

  const selected = '/' + location.pathname.split('/').filter(Boolean).slice(0, 2).join('/')
  const openKeys = NAV.filter((n) => n.children?.some((c) => selected.startsWith(c.key))).map((n) => n.key)

  const menu = (
    <Menu
      mode="inline"
      theme="dark"
      selectedKeys={[selected === '/' ? '/' : selected]}
      defaultOpenKeys={openKeys}
      items={items}
      onClick={({ key }) => {
        navigate(key)
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
        <Sider width={240} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
          {brand}
          {menu}
        </Sider>
      )}
      {isMobile && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} placement="left" size={260} styles={{ body: { padding: 0, background: '#001529' } }} closable={false}>
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
        <Content style={{ padding: isMobile ? 16 : 24 }}>
          <Suspense fallback={<Spin style={{ display: 'block', marginTop: 48 }} />}>
            <Outlet />
          </Suspense>
        </Content>
        <Footer style={{ textAlign: 'center', padding: '12px 16px' }} className="no-print">
          <Typography.Text type="secondary">{tx('সমবায় সমিতি ও কৃষি সেচ ERP · সংস্করণ')}{' '}{digits('0.1.0')}</Typography.Text>
        </Footer>
      </Layout>
    </Layout>
  )
}
