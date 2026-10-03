import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import { HomeOutlined, RightOutlined } from '@ant-design/icons'
import { t as tx } from '../lib/i18n'
import '../pages/farmers/farmer-list.css'
import PageTabs from './PageTabs'

/**
 * Breadcrumb, title and buttons of the approved designs for pages that are
 * not a list (forms, detail pages); the blue accent is the designs' own.
 */
export default function PageFrame({ crumbs, title, subtitle, actions, className, children }: { crumbs: { label: string; to?: string }[]; title: string; subtitle?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className={`fl ${className ?? ''}`}>
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          {crumbs.map((c) => (
            <span key={c.label} style={{ display: 'contents' }}>
              <RightOutlined className="fl-crumb-sep" />
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
        <PageTabs />
        <div className="fl-head">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="fl-head-btns">{actions}</div>}
        </div>
        {children}
      </div>
    </ConfigProvider>
  )
}
