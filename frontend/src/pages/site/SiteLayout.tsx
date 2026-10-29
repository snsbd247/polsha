import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Drawer, Spin } from 'antd'
import { ClockCircleFilled, EnvironmentFilled, FacebookFilled, InstagramOutlined, MailFilled, MenuOutlined, PhoneFilled, UserOutlined, YoutubeFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { digits } from '../../lib/format'
import { logoUrl, usePublicSettings } from '../../lib/settings'
import { lang, nameOf, setLang, t as tx } from '../../lib/i18n'
import { pick, usePublicSite } from '../../lib/website'
import { asset, SERVICES, SiteContext, type SiteCtx } from './kit'
import './landing.css'

/**
 * The public website's frame: top strip, header with the page menu, footer.
 * Each menu item is its own page (/about, /services, …). Visitors see the home
 * page at "/"; signed-in users still land on the dashboard there.
 */
export default function SiteLayout({ children }: { children?: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { data: settings } = usePublicSettings()
  const { data: site, isLoading } = usePublicSite()
  const [menuOpen, setMenuOpen] = useState(false)

  // a new page starts at the top, and any open menu closes
  useEffect(() => {
    window.scrollTo(0, 0)
    setMenuOpen(false)
  }, [pathname])

  const ctx = useMemo<SiteCtx>(() => {
    const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }) || tx('সমবায় সমিতি')
    const phone = site?.phone ?? ''
    return {
      site,
      settings,
      society,
      brandTitle: pick(site?.brand_title) || society,
      brandSub: pick(site?.brand_subtitle),
      brandTag: pick(site?.brand_tagline),
      logo: settings?.logo ? logoUrl() : asset('emblem.png'),
      phone,
      email: site?.email ?? '',
      address: pick(site?.address),
      hours: pick(site?.hours),
      telHref: `tel:${phone.replace(/[^\d+]/g, '')}`,
    }
  }, [site, settings])

  if (isLoading) return <Spin fullscreen />
  // switched off in Settings → Website: visitors go straight to the login page as before
  if (site && !site.enabled && !user) return <Navigate to="/login" replace />

  const { brandTitle, brandSub, brandTag, logo, phone, email, address, hours, telHref, society } = ctx
  const social = [
    { key: 'facebook', href: site?.facebook, icon: <FacebookFilled />, label: 'Facebook' },
    { key: 'youtube', href: site?.youtube, icon: <YoutubeFilled />, label: 'YouTube' },
    { key: 'instagram', href: site?.instagram, icon: <InstagramOutlined />, label: 'Instagram' },
  ].filter((s) => s.href)
  const nav = [
    { to: '/', label: tx('হোম'), end: true },
    { to: '/about', label: tx('আমাদের সম্পর্কে') },
    { to: '/services', label: tx('আমাদের সেবা') },
    { to: '/notices', label: tx('নোটিশ') },
    { to: '/gallery', label: tx('গ্যালারি') },
    { to: '/faq', label: tx('প্রশ্নোত্তর') },
    { to: '/contact', label: tx('যোগাযোগ করুন') },
  ]
  // "/site" is the home page too (kept for old links)
  const homeActive = pathname === '/' || pathname === '/site'
  const navClass = (to: string) => ({ isActive }: { isActive: boolean }) => ((to === '/' ? homeActive : isActive) ? 'active' : '')
  const switchLang = async () => {
    const next = lang === 'en' ? 'bn' : 'en'
    if (user) {
      try {
        await api.post('/me/locale', { locale: next })
      } catch {
        /* still switch locally */
      }
    }
    setLang(next)
  }
  const year = digits(new Date().getFullYear())

  return (
    <SiteContext.Provider value={ctx}>
      <div className="ld">
        {/* top bar */}
        <div className="ld-top">
          <div className="ld-wrap ld-top-in">
            {address && (
              <span className="ld-top-addr">
                <EnvironmentFilled /> {address}
              </span>
            )}
            <span className="ld-top-end">
              {phone && (
                <a href={telHref}>
                  <PhoneFilled /> {digits(phone)}
                </a>
              )}
              {email && (
                <a href={`mailto:${email}`} className="ld-hide-sm">
                  <MailFilled /> {email}
                </a>
              )}
              {social.map((s) => (
                <a key={s.key} href={s.href} target="_blank" rel="noreferrer" aria-label={s.label} className="ld-top-social">
                  {s.icon}
                </a>
              ))}
              <button type="button" className="ld-top-lang" onClick={switchLang}>
                {lang === 'en' ? 'বাংলা' : 'English'}
              </button>
            </span>
          </div>
        </div>

        {/* header */}
        <header className="ld-head">
          <div className="ld-wrap ld-head-in">
            <Link to="/" className="ld-brand">
              <img src={logo} alt="" />
              <span>
                <b>{brandTitle}</b>
                {brandSub && <strong>{brandSub}</strong>}
                {brandTag && <small>{brandTag}</small>}
              </span>
            </Link>
            <nav className="ld-nav">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={navClass(n.to)}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <Link to={user ? '/' : '/login'} className="ld-login">
              <UserOutlined /> {user ? tx('ড্যাশবোর্ড') : tx('সদস্য / গ্রাহক লগইন')}
            </Link>
            <button type="button" className="ld-burger" onClick={() => setMenuOpen(true)} aria-label={tx('মেন্যু')}>
              <MenuOutlined />
            </button>
          </div>
        </header>
        <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} placement="right" size={260} title={brandTitle}>
          <div className="ld-drawer">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={navClass(n.to)}>
                {n.label}
              </NavLink>
            ))}
            <Link to="/pay">{tx('অনলাইনে বিল দিন')}</Link>
            <Link to={user ? '/' : '/login'} className="ld-login">
              <UserOutlined /> {user ? tx('ড্যাশবোর্ড') : tx('সদস্য / গ্রাহক লগইন')}
            </Link>
          </div>
        </Drawer>

        <main>{children ?? <Outlet />}</main>

        {/* footer */}
        <footer className="ld-foot">
          <div className="ld-wrap ld-foot-in">
            <div className="ld-foot-brand">
              <div className="ld-foot-logo">
                <img src={logo} alt="" />
                <span>
                  <b>{brandTitle}</b>
                  {brandSub && <strong>{brandSub}</strong>}
                  {brandTag && <small>{brandTag}</small>}
                </span>
              </div>
              {address && (
                <p className="ld-foot-addr">
                  <EnvironmentFilled /> <span>{address}</span>
                </p>
              )}
            </div>
            <div>
              <h4>{tx('দ্রুত লিংক')}</h4>
              {nav.map((n) => (
                <Link key={n.to} to={n.to}>
                  {n.label}
                </Link>
              ))}
            </div>
            <div>
              <h4>{tx('আমাদের সেবা')}</h4>
              {SERVICES.map((s) => (
                <Link key={s.key} to={`/services/${s.key}`}>
                  {s.title}
                </Link>
              ))}
            </div>
            <div className="ld-foot-contact">
              <h4>{tx('যোগাযোগ করুন')}</h4>
              {phone && (
                <a href={telHref}>
                  <PhoneFilled /> {digits(phone)}
                </a>
              )}
              {email && (
                <a href={`mailto:${email}`}>
                  <MailFilled /> {email}
                </a>
              )}
              {hours && (
                <span>
                  <ClockCircleFilled /> {hours}
                </span>
              )}
              <Link to="/contact">
                <EnvironmentFilled /> {tx('ম্যাপ ও বার্তা পাঠান')}
              </Link>
            </div>
            {social.length > 0 && (
              <div>
                <h4>{tx('আমাদের অনুসরণ করুন')}</h4>
                <div className="ld-foot-social">
                  {social.map((s) => (
                    <a key={s.key} href={s.href} target="_blank" rel="noreferrer" aria-label={s.label} className={`ld-soc-${s.key}`}>
                      {s.icon}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="ld-foot-bar">
            <div className="ld-wrap ld-foot-bar-in">
              <span>
                © {year} {society}
                {lang === 'en' ? (society.endsWith('.') ? '' : '.') : '।'} {tx('সর্বস্বত্ব সংরক্ষিত।')}
              </span>
              <span className="ld-foot-bar-links">
                <Link to="/pay">{tx('অনলাইন পেমেন্ট')}</Link>
                <Link to="/login">{tx('কর্মীদের লগইন')}</Link>
                <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                  {tx('উপরে যান')}
                </button>
              </span>
            </div>
          </div>
        </footer>
      </div>
    </SiteContext.Provider>
  )
}
