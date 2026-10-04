import { useEffect, useRef, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import { CalendarOutlined, ControlOutlined, FileTextOutlined, GlobalOutlined, HomeOutlined, MessageOutlined, PictureOutlined, RightOutlined, SafetyCertificateOutlined, SettingOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { t as tx } from '../../lib/i18n'
import './settings.css'

const TABS = [
  { to: '/settings/general', icon: <ControlOutlined />, label: tx('সাধারণ সেটিংস'), perm: 'settings.admin' },
  { to: '/settings/branding', icon: <PictureOutlined />, label: tx('ব্র্যান্ডিং ও লোগো'), perm: 'settings.admin' },
  { to: '/settings/receipt', icon: <FileTextOutlined />, label: tx('রশিদ সেটিংস'), perm: 'settings.admin' },
  { to: '/settings/financial-year', icon: <CalendarOutlined />, label: tx('অর্থবছর'), perm: 'settings.admin' },
  { to: '/settings/sms', icon: <MessageOutlined />, label: tx('SMS সেটিংস'), perm: ['settings.admin', 'sms.admin'] },
  { to: '/settings/preferences', icon: <SettingOutlined />, label: tx('সিস্টেম পছন্দসমূহ'), perm: 'settings.admin' },
  { to: '/settings/website', icon: <GlobalOutlined />, label: tx('ওয়েবসাইট'), perm: 'settings.admin' },
  { to: '/settings/license', icon: <SafetyCertificateOutlined />, label: tx('লাইসেন্স ও ইনস্টলেশন'), perm: 'settings.admin' },
]

/**
 * Frame shared by the settings screens: breadcrumb, title, one-line purpose
 * and the tab row that moves between them (each tab is its own page).
 */
export default function SettingsShell({ title, subtitle, extra, children }: { title: string; subtitle: string; extra?: ReactNode; children: ReactNode }) {
  const { can } = useAuth()
  const tabs = useRef<HTMLElement>(null)
  // eight tabs overflow a narrow screen: bring the open one into view
  useEffect(() => {
    const active = tabs.current?.querySelector<HTMLElement>('a.active')
    if (tabs.current && active) tabs.current.scrollLeft = active.offsetLeft - (tabs.current.clientWidth - active.offsetWidth) / 2
  }, [])
  return (
    // the approved design uses a blue accent on these pages, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
    <div className="st">
      <nav className="st-crumb">
        <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
          <HomeOutlined />
        </Link>
        <RightOutlined className="st-crumb-sep" />
        <Link to="/settings/general">{tx('সেটিংস')}</Link>
        <RightOutlined className="st-crumb-sep" />
        <span>{title}</span>
      </nav>
      <div className="st-panel">
        <div className="st-head">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {extra && <div className="st-head-extra">{extra}</div>}
        </div>
        <nav className="st-tabs" ref={tabs}>
          {TABS.filter((t) => (Array.isArray(t.perm) ? t.perm.some((p) => can(p)) : can(t.perm))).map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {t.icon}
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="st-body">{children}</div>
      </div>
    </div>
    </ConfigProvider>
  )
}

/** Card with the light-blue title band used on the settings screens. */
export function SettingsCard({ icon, title, subtitle, extra, className, children }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; extra?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`st-card ${className ?? ''}`}>
      <header className="st-card-head">
        <span className="st-card-icon">{icon}</span>
        <div className="st-card-titles">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {extra}
      </header>
      <div className="st-card-body">{children}</div>
    </section>
  )
}
