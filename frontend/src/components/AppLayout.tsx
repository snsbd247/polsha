import { Suspense, useMemo, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Badge, Button, Drawer, Dropdown, Grid, Layout, Menu, Spin, Typography, type MenuProps } from 'antd'
import {
  AuditOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  EnvironmentOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { digits } from '../lib/format'
import { usePublicSettings } from '../lib/settings'

const { Header, Sider, Content, Footer } = Layout

type NavItem = { key: string; label: string; icon?: React.ReactNode; perm?: string | string[]; superOnly?: boolean; children?: NavItem[] }

const NAV: NavItem[] = [
  { key: '/', label: 'ড্যাশবোর্ড', icon: <DashboardOutlined /> },
  { key: '/approvals', label: 'অনুমোদন', icon: <CheckSquareOutlined /> },
  {
    key: 'masters',
    label: 'এলাকা ও মৌজা',
    icon: <EnvironmentOutlined />,
    children: [
      { key: '/masters/locations', label: 'এলাকা' },
      { key: '/masters/mouzas', label: 'মৌজা' },
    ],
  },
  { key: '/audit/logs', label: 'অডিট লগ', icon: <AuditOutlined />, perm: 'audit.view' },
  {
    key: 'admin',
    label: 'প্রশাসন',
    icon: <TeamOutlined />,
    children: [
      { key: '/admin/users', label: 'ইউজার', perm: 'user.view' },
      { key: '/admin/roles', label: 'রোল ও অনুমতি', perm: 'role.view' },
      { key: '/admin/approval-rules', label: 'অনুমোদনের নিয়ম', perm: 'approval.admin' },
      { key: '/admin/backups', label: 'ব্যাকআপ', superOnly: true },
    ],
  },
  {
    key: 'settings',
    label: 'সেটিংস',
    icon: <SettingOutlined />,
    children: [
      { key: '/settings/general', label: 'সাধারণ', perm: 'settings.admin' },
      { key: '/settings/sequences', label: 'সিরিয়াল নম্বর', perm: 'settings.admin' },
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
      {settings?.society_name_bn ?? 'সমবায় ERP'}
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
          {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="মেনু" />}
          <div style={{ flex: 1 }} />
          <Link to="/approvals">
            <Badge count={pending ? digits(pending) : 0}>
              <CheckSquareOutlined style={{ fontSize: 20 }} />
            </Badge>
          </Link>
          <Dropdown
            menu={{
              items: [
                { key: 'profile', icon: <UserOutlined />, label: 'আমার প্রোফাইল', onClick: () => navigate('/profile') },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: 'লগআউট', danger: true, onClick: () => logout().then(() => navigate('/login')) },
              ],
            }}
          >
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              {!isMobile && <span>{user?.name_bn}</span>}
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ padding: isMobile ? 16 : 24 }}>
          <Suspense fallback={<Spin style={{ display: 'block', marginTop: 48 }} />}>
            <Outlet />
          </Suspense>
        </Content>
        <Footer style={{ textAlign: 'center', padding: '12px 16px' }} className="no-print">
          <Typography.Text type="secondary">সমবায় সমিতি ও কৃষি সেচ ERP · সংস্করণ {digits('0.1.0')}</Typography.Text>
        </Footer>
      </Layout>
    </Layout>
  )
}
