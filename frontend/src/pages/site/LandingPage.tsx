import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Button, Drawer, Spin } from 'antd'
import {
  BankOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  CloudOutlined,
  CreditCardOutlined,
  EnvironmentOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  LoginOutlined,
  MailOutlined,
  MenuOutlined,
  NotificationOutlined,
  PhoneOutlined,
  PieChartOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { digits } from '../../lib/format'
import { DEFAULT_BRAND, logoUrl, usePublicSettings } from '../../lib/settings'
import { nameOf, t as tx } from '../../lib/i18n'
import { pick, sitePhotoUrl, usePublicSite, type SiteStat } from '../../lib/website'
import LanguageToggle from '../../components/LanguageToggle'
import './landing.css'

/**
 * Public website at "/" for visitors (signed-in users still land on the dashboard).
 * Text and photos come from Settings → Website; empty sections are left out.
 */
const SERVICES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <CloudOutlined />, title: tx('সেচ'), text: tx('মৌসুমভিত্তিক সেচের পানি; জমির পরিমাণ ও ধরন অনুযায়ী স্বচ্ছ বিল') },
  { icon: <ExperimentOutlined />, title: tx('পানি সরবরাহ'), text: tx('বাড়িতে বাড়িতে নিরাপদ খাবার পানি; সংযোগের ধরন অনুযায়ী নির্দিষ্ট মাসিক বিল') },
  { icon: <WalletOutlined />, title: tx('সঞ্চয়'), text: tx('সদস্যদের নিয়মিত সঞ্চয় ও বছর শেষে মুনাফা') },
  { icon: <BankOutlined />, title: tx('ঋণ'), text: tx('কৃষি ও জরুরি প্রয়োজনে সহজ কিস্তিতে ঋণ') },
  { icon: <PieChartOutlined />, title: tx('শেয়ার'), text: tx('সমিতির মালিকানায় অংশ ও বার্ষিক লভ্যাংশ') },
  { icon: <CreditCardOutlined />, title: tx('অনলাইন পেমেন্ট'), text: tx('বিকাশ/নগদে বিল পরিশোধ, অফিসে আসার দরকার নেই') },
]

const STAT_LABEL: Record<SiteStat['key'], string> = {
  members: tx('সক্রিয় সদস্য'),
  farmers: tx('কৃষক'),
  irrigated_acres: tx('একর সেচকৃত জমি'),
  years: tx('বছরের সেবা'),
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const initials = (name: string) =>
  name
    .replace(/^(মোঃ|মোছাঃ|মো\.|Md\.?|Mst\.?)\s*/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')

function fmtNoticeDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return digits(`${d}/${m}/${y}`)
}

export default function LandingPage() {
  const { user } = useAuth()
  const { data: settings } = usePublicSettings()
  const { data: site, isLoading } = usePublicSite()
  const [menuOpen, setMenuOpen] = useState(false)

  if (isLoading) return <Spin fullscreen />
  // switched off in Settings → Website: visitors go straight to the login page as before
  if (site && !site.enabled && !user) return <Navigate to="/login" replace />

  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }) || tx('সমবায় সমিতি')
  const style = { '--brand': settings?.brand_color || DEFAULT_BRAND } as CSSProperties
  const year = digits(new Date().getFullYear())

  const tagline = pick(site?.tagline)
  const intro = pick(site?.intro)
  const address = pick(site?.address)
  const hours = pick(site?.hours)
  const workArea = pick(site?.work_area)
  const phone = site?.phone ?? ''
  const email = site?.email ?? ''
  const facts = [
    site?.founded_year && { label: tx('প্রতিষ্ঠা'), value: digits(site.founded_year) },
    site?.registration_no && { label: tx('নিবন্ধন নং'), value: digits(site.registration_no) },
    workArea && { label: tx('কর্ম এলাকা'), value: workArea },
  ].filter(Boolean) as { label: string; value: string }[]
  const stats = site?.stats ?? []
  const notices = site?.notices ?? []
  const committee = site?.committee ?? []
  const gallery = site?.gallery ?? []
  const hasContact = !!(address || phone || email || hours || site?.map_url)

  const nav = [
    { id: 'about', label: tx('আমাদের সম্পর্কে'), show: true },
    { id: 'services', label: tx('সেবাসমূহ'), show: true },
    { id: 'notices', label: tx('নোটিশ'), show: notices.length > 0 },
    { id: 'committee', label: tx('কমিটি'), show: committee.length > 0 },
    { id: 'contact', label: tx('যোগাযোগ'), show: hasContact },
  ].filter((n) => n.show)

  const go = (id: string) => {
    setMenuOpen(false)
    scrollTo(id)
  }
  const account = user ? (
    <Link to="/">
      <Button type="primary" icon={<UserOutlined />}>
        {tx('ড্যাশবোর্ড')}
      </Button>
    </Link>
  ) : (
    <Link to="/login">
      <Button type="primary" icon={<LoginOutlined />}>
        {tx('লগইন')}
      </Button>
    </Link>
  )

  return (
    <div className="ld" style={style}>
      {(phone || email || hours) && (
        <div className="ld-strip">
          <div className="ld-wrap ld-strip-in">
            {phone && (
              <span>
                <PhoneOutlined /> {digits(phone)}
              </span>
            )}
            {email && (
              <span className="ld-hide-sm">
                <MailOutlined /> {email}
              </span>
            )}
            {hours && (
              <span className="ld-strip-end ld-hide-sm">
                <CalendarOutlined /> {hours}
              </span>
            )}
          </div>
        </div>
      )}

      <header className="ld-head">
        <div className="ld-wrap ld-head-in">
          <button type="button" className="ld-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            {settings?.logo ? <img src={logoUrl()} alt="" /> : <span className="ld-mark">{initials(society)}</span>}
            <span className="ld-brand-name">{society}</span>
          </button>
          <nav className="ld-nav">
            {nav.map((n) => (
              <button type="button" key={n.id} onClick={() => go(n.id)}>
                {n.label}
              </button>
            ))}
          </nav>
          <div className="ld-head-end">
            <span className="ld-hide-sm">
              <LanguageToggle signedIn={!!user} />
            </span>
            {account}
            <Button className="ld-burger" icon={<MenuOutlined />} onClick={() => setMenuOpen(true)} aria-label={tx('মেন্যু')} />
          </div>
        </div>
      </header>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} placement="right" size={260} title={society}>
        <div className="ld-drawer">
          {nav.map((n) => (
            <button type="button" key={n.id} onClick={() => go(n.id)}>
              {n.label}
            </button>
          ))}
          <div style={{ marginTop: 16 }}>
            <LanguageToggle signedIn={!!user} />
          </div>
        </div>
      </Drawer>

      <section className="ld-hero">
        <div className="ld-wrap ld-hero-in">
          <div className="ld-hero-text">
            <span className="ld-chip">
              <SafetyCertificateOutlined /> {tx('নিবন্ধিত সমবায় সমিতি')}
            </span>
            <h1>{society}</h1>
            {tagline && <p>{tagline}</p>}
            <div className="ld-hero-btns">
              <Link to="/pay">
                <Button size="large" className="ld-btn-light" icon={<CreditCardOutlined />}>
                  {tx('অনলাইনে বিল দিন')}
                </Button>
              </Link>
              <Button size="large" ghost onClick={() => scrollTo('services')}>
                {tx('আমাদের সেবা')}
              </Button>
            </div>
          </div>
          <div className="ld-quick">
            <h3>{tx('দ্রুত সেবা')}</h3>
            <Link to="/pay" className="ld-quick-row">
              <CreditCardOutlined />
              <span>
                <b>{tx('অনলাইনে বিল জমা')}</b>
                <small>{tx('সেচ, পানি, ঋণের কিস্তি — বিকাশ/নগদে')}</small>
              </span>
            </Link>
            <Link to="/pay" className="ld-quick-row">
              <FileSearchOutlined />
              <span>
                <b>{tx('পেমেন্টের অবস্থা')}</b>
                <small>{tx('অনুরোধ নং ও মোবাইল দিয়ে দেখুন')}</small>
              </span>
            </Link>
            <div className="ld-quick-row ld-quick-static">
              <QrcodeOutlined />
              <span>
                <b>{tx('রশিদ যাচাই')}</b>
                <small>{tx('রশিদের QR কোড ফোনের ক্যামেরায় স্ক্যান করুন')}</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      {stats.length > 0 && (
        <section className="ld-stats">
          <div className={`ld-wrap ld-stats-in ld-stats-${Math.min(stats.length, 4)}`}>
            {stats.map((s) => (
              <div key={s.key}>
                <b>{digits(s.value.toLocaleString('en-IN'))}</b>
                <span>{STAT_LABEL[s.key]}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="about" className="ld-sec">
        <div className="ld-wrap ld-about">
          {site?.about_photo ? (
            <img className="ld-about-pic ld-about-img" src={sitePhotoUrl(site.about_photo)} alt={society} />
          ) : (
            <div className="ld-about-pic">
              <span className="ld-about-mark">{initials(society)}</span>
            </div>
          )}
          <div>
            <span className="ld-eyebrow">{tx('আমাদের সম্পর্কে')}</span>
            <h2>{tx('গ্রামের মানুষের নিজের প্রতিষ্ঠান')}</h2>
            {intro && <p>{intro}</p>}
            {facts.length > 0 && (
              <ul className="ld-facts">
                {facts.map((f) => (
                  <li key={f.label}>
                    <CheckCircleFilled />
                    <span>
                      {f.label}: <b>{f.value}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section id="services" className="ld-sec ld-sec-tint">
        <div className="ld-wrap">
          <div className="ld-sec-head">
            <span className="ld-eyebrow">{tx('সেবাসমূহ')}</span>
            <h2>{tx('আমরা যা করি')}</h2>
          </div>
          <div className="ld-services">
            {SERVICES.map((s) => (
              <div className="ld-service" key={s.title}>
                <span className="ld-service-ic">{s.icon}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {notices.length > 0 && (
        <section id="notices" className="ld-sec">
          <div className="ld-wrap">
            <div className="ld-sec-head">
              <span className="ld-eyebrow">{tx('নোটিশ বোর্ড')}</span>
              <h2>{tx('সাম্প্রতিক ঘোষণা')}</h2>
            </div>
            <div className="ld-notices">
              {notices.map((n, i) => (
                <div className="ld-notice" key={`${n.date}-${i}`}>
                  <div className="ld-notice-date">
                    <NotificationOutlined />
                    {fmtNoticeDate(n.date)}
                  </div>
                  <p>{pick(n.title)}</p>
                  {pick(n.tag) && <span className="ld-tag">{pick(n.tag)}</span>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {committee.length > 0 && (
        <section id="committee" className="ld-sec ld-sec-tint">
          <div className="ld-wrap">
            <div className="ld-sec-head">
              <span className="ld-eyebrow">{tx('পরিচালনা কমিটি')}</span>
              <h2>{tx('যাঁরা সমিতি পরিচালনা করছেন')}</h2>
            </div>
            <div className="ld-committee">
              {committee.map((c, i) => (
                <div className="ld-person" key={i}>
                  {c.photo ? <img className="ld-avatar" src={sitePhotoUrl(c.photo)} alt={pick(c.name)} /> : <span className="ld-avatar">{initials(pick(c.name))}</span>}
                  <b>{pick(c.name)}</b>
                  <span className="ld-role">{pick(c.role)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {gallery.length > 0 && (
        <section className="ld-sec">
          <div className="ld-wrap">
            <div className="ld-sec-head">
              <span className="ld-eyebrow">{tx('গ্যালারি')}</span>
              <h2>{tx('আমাদের কার্যক্রম')}</h2>
            </div>
            <div className="ld-gallery">
              {gallery.map((g, i) => (
                <figure key={i} className="ld-photo">
                  <img src={sitePhotoUrl(g.photo)} alt={pick(g.caption)} loading="lazy" />
                  {pick(g.caption) && <figcaption>{pick(g.caption)}</figcaption>}
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {hasContact && (
        <section id="contact" className="ld-sec ld-sec-tint">
          <div className={`ld-wrap ld-contact${site?.map_url ? '' : ' ld-contact-solo'}`}>
            <div>
              <span className="ld-eyebrow">{tx('যোগাযোগ')}</span>
              <h2>{tx('আমাদের সাথে যোগাযোগ করুন')}</h2>
              <ul className="ld-contact-list">
                {address && (
                  <li>
                    <EnvironmentOutlined />
                    <span>{address}</span>
                  </li>
                )}
                {phone && (
                  <li>
                    <PhoneOutlined />
                    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{digits(phone)}</a>
                  </li>
                )}
                {email && (
                  <li>
                    <MailOutlined />
                    <a href={`mailto:${email}`}>{email}</a>
                  </li>
                )}
                {hours && (
                  <li>
                    <CalendarOutlined />
                    <span>{hours}</span>
                  </li>
                )}
              </ul>
            </div>
            {site?.map_url && <iframe className="ld-map" src={site.map_url} title={tx('গুগল ম্যাপ')} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
          </div>
        </section>
      )}

      <footer className="ld-foot">
        <div className="ld-wrap ld-foot-in">
          <div>
            <b>{society}</b>
            {address && <p>{address}</p>}
          </div>
          <div className="ld-foot-links">
            {nav.map((n) => (
              <button type="button" key={n.id} onClick={() => scrollTo(n.id)}>
                {n.label}
              </button>
            ))}
            <Link to="/pay">{tx('অনলাইন পেমেন্ট')}</Link>
            <Link to="/login">{tx('কর্মীদের লগইন')}</Link>
          </div>
        </div>
        <div className="ld-wrap ld-copy">
          © {year} {society}
        </div>
      </footer>
    </div>
  )
}
