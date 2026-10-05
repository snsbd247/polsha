import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Drawer, Modal, Spin } from 'antd'
import {
  ArrowRightOutlined,
  BarChartOutlined,
  ClockCircleFilled,
  CreditCardFilled,
  CustomerServiceFilled,
  EnvironmentFilled,
  FacebookFilled,
  FileSearchOutlined,
  HomeFilled,
  InstagramOutlined,
  LeftOutlined,
  MailFilled,
  MenuOutlined,
  MinusOutlined,
  PhoneFilled,
  PlusOutlined,
  QrcodeOutlined,
  QuestionCircleFilled,
  RightOutlined,
  SoundFilled,
  ThunderboltFilled,
  UserOutlined,
  YoutubeFilled,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { digits } from '../../lib/format'
import { logoUrl, usePublicSettings } from '../../lib/settings'
import { lang, nameOf, setLang, t as tx } from '../../lib/i18n'
import { pick, sitePhotoUrl, usePublicSite, type SiteNotice, type SiteStat } from '../../lib/website'
import './landing.css'

/**
 * Public website at "/" for visitors (signed-in users still land on the dashboard).
 * Text and photos come from Settings → Website; the stock photos in /site are used
 * until the society uploads its own. Empty sections are left out.
 */
const asset = (name: string) => `${import.meta.env.BASE_URL}landing-img/${name}`
const DEFAULT_SLIDES = [asset('hero.jpg'), asset('slide2.jpg'), asset('cta.jpg')]

/* ---------- small drawn icons (the icon font has no farmer, field or drop) ---------- */
const Svg = ({ children, vb = '0 0 48 48' }: { children: ReactNode; vb?: string }) => (
  <svg viewBox={vb} fill="currentColor" aria-hidden="true">
    {children}
  </svg>
)
const FarmerIcon = () => (
  <Svg>
    <path d="M14 13c0-1.5 4-6 10-6s10 4.5 10 6l4 1v2H10v-2z" />
    <circle cx="24" cy="21" r="6" />
    <path d="M12 44V35c0-5 4-8 8-8h8c4 0 8 3 8 8v9H12z" />
    <path d="M22 28h4l-1 6h-2z" fill="#fff" opacity=".6" />
  </Svg>
)
const FieldIcon = () => (
  <Svg>
    <circle cx="24" cy="24" r="22" />
    <path d="M8 22c6-5 12-5 16 0s10 5 16 0M7 29c6-5 12-5 17 0s11 5 17 0M10 36c5-4 10-4 14 0s9 4 14 0" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
  </Svg>
)
const HouseIcon = () => (
  <Svg>
    <path d="M24 5 3 24h6v19h11V31h8v12h11V24h6z" />
  </Svg>
)
const DropIcon = () => (
  <Svg>
    <path d="M24 3S9 20 9 30a15 15 0 0 0 30 0C39 20 24 3 24 3z" />
    <path d="M17 30a7 7 0 0 0 7 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".7" />
  </Svg>
)
const PeopleIcon = () => (
  <Svg>
    <circle cx="24" cy="12" r="6" />
    <circle cx="10" cy="17" r="5" />
    <circle cx="38" cy="17" r="5" />
    <path d="M14 42V31c0-5 4-9 10-9s10 4 10 9v11z" />
    <path d="M2 40v-8c0-4 3-7 8-7 2 0 3 .5 4.5 1.3C12.6 28 12 30 12 32v8zM46 40v-8c0-4-3-7-8-7-2 0-3 .5-4.5 1.3C35.4 28 36 30 36 32v8z" />
  </Svg>
)
const LeafIcon = () => (
  <Svg>
    <path d="M40 6C20 6 10 16 10 30c0 3 .6 5.5 1.6 7.6C15 26 22 20 32 16 24 22 17 30 13 42l4 1c1-3 2-5.5 3.4-8C34 36 42 26 40 6z" />
  </Svg>
)
const TargetIcon = () => (
  <Svg>
    <circle cx="22" cy="26" r="17" fill="none" stroke="currentColor" strokeWidth="4" />
    <circle cx="22" cy="26" r="9" fill="none" stroke="currentColor" strokeWidth="4" />
    <circle cx="22" cy="26" r="3" />
    <path d="M23 25 40 8M34 6l7 1 1 7-6 1-3-3z" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
  </Svg>
)
const HandshakeIcon = () => (
  <Svg>
    <path d="M2 16 10 10l7 3h7l-6 6c-1.5 1.5-1.5 3.5 0 5s3.5 1.5 5 0l5-5 12 11-3 3-2-2-3 3-2-2-3 3-2-2-3 3-11-11-5 2z" />
    <path d="M46 16l-8-6-6 3-9 9c-.8.8-.8 2 0 2.6.8.8 2 .8 2.6 0L31 19l12 11 3-2z" />
  </Svg>
)
const DiamondIcon = () => (
  <Svg>
    <path d="M12 6h24l10 12-22 26L2 18z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
    <path d="M2 18h44M17 6l-4 12 11 26 11-26-4-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
  </Svg>
)
const BarsIcon = () => (
  <Svg>
    <rect x="5" y="26" width="9" height="17" rx="1" fill="#16a34a" />
    <rect x="19" y="16" width="9" height="27" rx="1" fill="#1677d2" />
    <rect x="33" y="6" width="9" height="37" rx="1" fill="#1677d2" />
  </Svg>
)
const PlantHandIcon = () => (
  <Svg vb="0 0 64 64">
    <path d="M32 34V20" stroke="currentColor" strokeWidth="3" fill="none" />
    <path d="M32 24c-2-8-9-12-17-11 1 8 8 12 17 11zM32 20c2-9 10-13 19-12-1 9-9 13-19 12z" />
    <path d="M4 46h10l10-6c3-2 6-2 9 0l6 3c2 1 2 4-1 4H26M38 47l14-7c3-1.5 6 0 6 2.5L42 54c-3 2-6 2-9 2H18l-6 3H4z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
  </Svg>
)

type Info = { title: string; body: ReactNode }

/** Fuller descriptions shown when "Learn More" is pressed on a service card. */
const SERVICES = [
  {
    key: 'irrigation',
    photo: asset('svc-irrigation.jpg'),
    icon: <LeafIcon />,
    title: tx('সেচ সেবা'),
    text: tx('কৃষি উন্নয়নের জন্য দক্ষ পানি ব্যবস্থাপনা।'),
    more: tx('প্রতিটি মৌসুমে জমির পরিমাণ ও ধরন অনুযায়ী সেচের পানি দেওয়া হয়। সেচ চার্জ মৌসুম শুরুর আগে জানানো হয় এবং প্রতিটি জমার রশিদ দেওয়া হয়।'),
  },
  {
    key: 'water',
    photo: asset('svc-water.jpg'),
    icon: <HomeFilled />,
    title: tx('আবাসিক পানি সরবরাহ'),
    text: tx('পরিবারের জন্য নিরাপদ ও নির্ভরযোগ্য পানি সরবরাহ।'),
    more: tx('বাড়িতে বাড়িতে নিরাপদ পানির সংযোগ। সংযোগের ধরন অনুযায়ী নির্দিষ্ট মাসিক বিল, যা অফিসে, মাঠকর্মীর কাছে বা বিকাশ/নগদে দেওয়া যায়।'),
  },
  {
    key: 'member',
    photo: asset('svc-member.jpg'),
    icon: <PeopleIcon />,
    title: tx('সদস্য সেবা'),
    text: tx('সঞ্চয়, ঋণ ও অন্যান্য সুবিধা দিয়ে সদস্যদের পাশে থাকা।'),
    more: tx('সদস্যদের নিয়মিত সঞ্চয় ও বছর শেষে মুনাফা, কৃষি ও জরুরি প্রয়োজনে সহজ কিস্তিতে ঋণ, এবং শেয়ারের বার্ষিক লভ্যাংশ।'),
  },
  {
    key: 'accounts',
    photo: asset('svc-accounting.jpg'),
    icon: <BarChartOutlined />,
    title: tx('হিসাব ও ব্যবস্থাপনা'),
    text: tx('স্বচ্ছ ও দক্ষ ব্যবস্থাপনা পদ্ধতি।'),
    more: tx('প্রতিটি টাকার হিসাব ডাবল-এন্ট্রি খাতায় রাখা হয়। প্রতিটি রশিদে QR কোড থাকে, আর বার্ষিক হিসাব সাধারণ সভায় উপস্থাপন করা হয়।'),
  },
]

const ALL_SERVICES = [
  ...SERVICES.map((s) => ({ title: s.title, text: s.more })),
  { title: tx('অনলাইন পেমেন্ট'), text: tx('বিকাশ/নগদে বিল পরিশোধ, অফিসে আসার দরকার নেই') },
  { title: tx('সম্পদ ব্যবস্থাপনা'), text: tx('পাম্প, পাইপলাইন ও অন্যান্য সম্পদের রক্ষণাবেক্ষণ ও হিসাব') },
]

const STAT_ICON: Record<string, ReactNode> = {
  farmers: <FarmerIcon />,
  irrigated_acres: <FieldIcon />,
  water_connections: <HouseIcon />,
  years: <ClockCircleFilled />,
  reliable: <DropIcon />,
  healthy: <PeopleIcon />,
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** "Reliable Water\nfor [Agriculture]" → lines, with the bracketed words in green. */
function HeroTitle({ text }: { text: string }) {
  return (
    <h1>
      {text.split('\n').map((line, i) => (
        <span key={i} className="ld-h1-line">
          {line.split(/(\[[^\]]+\])/).map((part, j) => (part.startsWith('[') && part.endsWith(']') ? <em key={j}>{part.slice(1, -1)}</em> : part))}
        </span>
      ))}
    </h1>
  )
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_BN = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে']
function noticeDate(iso: string) {
  const [y, m, d] = iso.split('-')
  const month = (lang === 'en' ? MONTHS_EN : MONTHS_BN)[Number(m) - 1] ?? m
  return { day: digits(d), rest: `${month} ${digits(y)}` }
}

/** Red for notices, blue for events/meetings, green for everything else. */
function tagTone(tag: string) {
  const t = tag.toLowerCase()
  if (/notice|নোটিশ|জরুরি|urgent/.test(t)) return 'red'
  if (/event|meeting|সভা|অনুষ্ঠান/.test(t)) return 'blue'
  return 'green'
}

export default function LandingPage() {
  const { user } = useAuth()
  const { data: settings } = usePublicSettings()
  const { data: site, isLoading } = usePublicSite()
  const [menuOpen, setMenuOpen] = useState(false)
  const [slide, setSlide] = useState(0)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [allFaqs, setAllFaqs] = useState(false)
  const [info, setInfo] = useState<Info | null>(null)
  const [aboutMore, setAboutMore] = useState(false)

  const slides = site?.hero_photos?.length ? site.hero_photos.map(sitePhotoUrl) : DEFAULT_SLIDES
  useEffect(() => {
    if (slides.length < 2) return
    const id = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 6000)
    return () => window.clearInterval(id)
  }, [slides.length, slide])

  if (isLoading) return <Spin fullscreen />
  // switched off in Settings → Website: visitors go straight to the login page as before
  if (site && !site.enabled && !user) return <Navigate to="/login" replace />

  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }) || tx('সমবায় সমিতি')
  const year = digits(new Date().getFullYear())
  const brandTitle = pick(site?.brand_title) || society
  const brandSub = pick(site?.brand_subtitle)
  const brandTag = pick(site?.brand_tagline)
  const logo = settings?.logo ? logoUrl() : asset('emblem.png')

  const address = pick(site?.address)
  const hours = pick(site?.hours)
  const workArea = pick(site?.work_area)
  const phone = site?.phone ?? ''
  const email = site?.email ?? ''
  const telHref = `tel:${phone.replace(/[^\d+]/g, '')}`
  const social = [
    { key: 'facebook', href: site?.facebook, icon: <FacebookFilled />, label: 'Facebook' },
    { key: 'youtube', href: site?.youtube, icon: <YoutubeFilled />, label: 'YouTube' },
    { key: 'instagram', href: site?.instagram, icon: <InstagramOutlined />, label: 'Instagram' },
  ].filter((s) => s.href)
  const notices = site?.notices ?? []
  const faqs = site?.faqs ?? []
  const shownFaqs = allFaqs ? faqs : faqs.slice(0, 8)
  const committee = site?.committee ?? []
  const gallery = site?.gallery ?? []
  const facts = [
    site?.founded_year && { label: tx('প্রতিষ্ঠা'), value: digits(site.founded_year) },
    site?.registration_no && { label: tx('নিবন্ধন নং'), value: digits(site.registration_no) },
    workArea && { label: tx('কর্ম এলাকা'), value: workArea },
  ].filter(Boolean) as { label: string; value: string }[]

  // live numbers first, then the two promises, five in all
  const live = site?.stats ?? []
  const byKey = (k: SiteStat['key']) => live.find((s) => s.key === k)?.value ?? 0
  const people = Math.max(byKey('farmers'), byKey('members'))
  const statItems = [
    people > 0 && { key: 'farmers', big: `${digits(people.toLocaleString('en-IN'))}+`, small: tx('কৃষক ও সদস্য') },
    byKey('irrigated_acres') > 0 && { key: 'irrigated_acres', big: `${digits(byKey('irrigated_acres').toLocaleString('en-IN'))}+`, small: tx('একর সেচের জমি') },
    byKey('water_connections') > 0 && { key: 'water_connections', big: `${digits(byKey('water_connections').toLocaleString('en-IN'))}+`, small: tx('আবাসিক সংযোগ') },
    byKey('years') > 0 && { key: 'years', big: `${digits(byKey('years'))}+`, small: tx('বছরের সেবা') },
    { key: 'reliable', big: tx('নির্ভরযোগ্য'), small: tx('পানি সরবরাহ') },
    { key: 'healthy', big: tx('সুস্থ'), small: tx('সমাজ') },
  ].filter(Boolean) as { key: string; big: string; small: string }[]
  const stats = live.length ? [...statItems.slice(0, statItems.length - 2).slice(0, 3), ...statItems.slice(-2)] : []

  const nav = [
    { id: 'top', label: tx('হোম'), show: true },
    { id: 'about', label: tx('আমাদের সম্পর্কে'), show: true },
    { id: 'services', label: tx('আমাদের সেবা'), show: true },
    { id: 'notices', label: tx('নোটিশ'), show: notices.length > 0 },
    { id: 'gallery', label: tx('গ্যালারি'), show: gallery.length > 0 },
    { id: 'faq', label: tx('প্রশ্নোত্তর'), show: faqs.length > 0 },
    { id: 'contact', label: tx('যোগাযোগ করুন'), show: true },
  ].filter((n) => n.show)

  const go = (id: string) => {
    setMenuOpen(false)
    if (id === 'top') window.scrollTo({ top: 0, behavior: 'smooth' })
    else scrollTo(id)
  }
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

  const contactBody = (
    <ul className="ld-info-list">
      {phone && (
        <li>
          <PhoneFilled /> <a href={telHref}>{digits(phone)}</a>
        </li>
      )}
      {email && (
        <li>
          <MailFilled /> <a href={`mailto:${email}`}>{email}</a>
        </li>
      )}
      {address && (
        <li>
          <EnvironmentFilled /> <span>{address}</span>
        </li>
      )}
      {hours && (
        <li>
          <ClockCircleFilled /> <span>{hours}</span>
        </li>
      )}
    </ul>
  )
  const showNotice = (n: SiteNotice) => {
    const d = noticeDate(n.date)
    setInfo({
      title: pick(n.title),
      body: (
        <p className="ld-info-text">
          {d.day} {d.rest}
          {pick(n.tag) && <span className={`ld-tag ld-tag-${tagTone(pick(n.tag))}`}>{pick(n.tag)}</span>}
        </p>
      ),
    })
  }

  const quick = [
    { tone: 'red', icon: <CreditCardFilled />, title: tx('অনলাইনে বিল দিন'), text: tx('সেচ, পানি ও ঋণের কিস্তি বিকাশ/নগদে পরিশোধ করুন'), to: '/pay' },
    { tone: 'blue', icon: <FileSearchOutlined />, title: tx('পেমেন্টের অবস্থা দেখুন'), text: tx('অনুরোধ নম্বর ও মোবাইল নম্বর দিয়ে পেমেন্টের অবস্থা দেখুন'), to: '/pay?tab=status' },
    {
      tone: 'green',
      icon: <QrcodeOutlined />,
      title: tx('রশিদ যাচাই করুন'),
      text: tx('রশিদের QR কোড ফোনের ক্যামেরায় স্ক্যান করুন'),
      onClick: () => setInfo({ title: tx('রশিদ যাচাই করুন'), body: <p className="ld-info-text">{tx('প্রতিটি রশিদে একটি QR কোড আছে। ফোনের ক্যামেরা দিয়ে কোডটি স্ক্যান করলে সমিতির খাতায় থাকা রশিদটি খুলবে — টাকার পরিমাণ ও তারিখ মিলিয়ে দেখুন।')}</p> }),
    },
    {
      tone: 'purple',
      icon: <CustomerServiceFilled />,
      title: tx('সেবার অনুরোধ'),
      text: tx('সেবার অনুরোধ বা অভিযোগ জানান'),
      onClick: () => setInfo({ title: tx('সেবার অনুরোধ'), body: <><p className="ld-info-text">{tx('নতুন সংযোগ, মেরামত বা অভিযোগের জন্য সমিতির অফিসে যোগাযোগ করুন:')}</p>{contactBody}</> }),
    },
  ]

  return (
    <div className="ld" id="top">
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
          <button type="button" className="ld-brand" onClick={() => go('top')}>
            <img src={logo} alt="" />
            <span>
              <b>{brandTitle}</b>
              {brandSub && <strong>{brandSub}</strong>}
              {brandTag && <small>{brandTag}</small>}
            </span>
          </button>
          <nav className="ld-nav">
            {nav.map((n, i) => (
              <button type="button" key={n.id} className={i === 0 ? 'active' : ''} onClick={() => go(n.id)}>
                {n.label}
              </button>
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
            <button type="button" key={n.id} onClick={() => go(n.id)}>
              {n.label}
            </button>
          ))}
          <Link to={user ? '/' : '/login'} className="ld-login">
            <UserOutlined /> {user ? tx('ড্যাশবোর্ড') : tx('সদস্য / গ্রাহক লগইন')}
          </Link>
        </div>
      </Drawer>

      {/* hero */}
      <section className="ld-hero">
        {slides.map((src, i) => (
          <div key={src} className={`ld-slide${i === slide ? ' on' : ''}`} style={{ backgroundImage: `url("${src}")` } as CSSProperties} />
        ))}
        <div className="ld-hero-shade" />
        <div className="ld-wrap ld-hero-in">
          <div className="ld-hero-text">
            {pick(site?.hero_kicker) && <span className="ld-kicker ld-kicker-light">{pick(site?.hero_kicker)}</span>}
            <HeroTitle text={pick(site?.hero_title) || society} />
            {pick(site?.tagline) && <p>{pick(site?.tagline)}</p>}
            <div className="ld-hero-btns">
              <button type="button" className="ld-btn ld-btn-green" onClick={() => scrollTo('services')}>
                {tx('আমাদের সেবা')} <ArrowRightOutlined />
              </button>
              <button type="button" className="ld-btn ld-btn-white" onClick={() => scrollTo('about')}>
                {tx('আরও জানুন')} <ArrowRightOutlined />
              </button>
            </div>
          </div>
          <div className="ld-hero-cards">
            {[
              { icon: <LeafIcon />, tone: 'green', label: tx('সেচ সেবা'), id: 'services' },
              { icon: <HomeFilled />, tone: 'blue', label: tx('আবাসিক পানি সরবরাহ'), id: 'services' },
              { icon: <PeopleIcon />, tone: 'green', label: tx('সদস্য সেবা'), id: 'services' },
              { icon: <BarsIcon />, tone: 'multi', label: tx('স্বচ্ছ ব্যবস্থাপনা'), id: 'about' },
            ].map((c) => (
              <button type="button" key={c.label} className="ld-hero-card" onClick={() => scrollTo(c.id)}>
                <span className={`ld-hc-ic ld-hc-${c.tone}`}>{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
        {slides.length > 1 && (
          <>
            <button type="button" className="ld-arrow ld-arrow-l" aria-label={tx('আগের ছবি')} onClick={() => setSlide((slide + slides.length - 1) % slides.length)}>
              <LeftOutlined />
            </button>
            <button type="button" className="ld-arrow ld-arrow-r" aria-label={tx('পরের ছবি')} onClick={() => setSlide((slide + 1) % slides.length)}>
              <RightOutlined />
            </button>
            <div className="ld-dots">
              {slides.map((src, i) => (
                <button type="button" key={src} className={i === slide ? 'on' : ''} aria-label={`${i + 1}`} onClick={() => setSlide(i)} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* quick services */}
      <section className="ld-quick">
        <div className="ld-wrap">
          <div className="ld-quick-head">
            <span className="ld-quick-bolt">
              <ThunderboltFilled />
            </span>
            <div>
              <h2>{tx('দ্রুত সেবা')}</h2>
              <p>{tx('গুরুত্বপূর্ণ সেবা দ্রুত ও সহজে নিন')}</p>
            </div>
          </div>
          <div className="ld-quick-grid">
            {quick.map((q) => {
              const inner = (
                <>
                  <span className="ld-q-ic">{q.icon}</span>
                  <span className="ld-q-body">
                    <b>{q.title}</b>
                    <small>{q.text}</small>
                  </span>
                  <span className="ld-q-go">
                    <ArrowRightOutlined />
                  </span>
                </>
              )
              return q.to ? (
                <Link key={q.title} to={q.to} className={`ld-q ld-q-${q.tone}`}>
                  {inner}
                </Link>
              ) : (
                <button type="button" key={q.title} className={`ld-q ld-q-${q.tone}`} onClick={q.onClick}>
                  {inner}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* numbers */}
      {stats.length > 0 && (
        <section className="ld-stats">
          <div className="ld-wrap ld-stats-in">
            {stats.map((s) => (
              <div key={s.key} className={`ld-stat ld-stat-${s.key}`}>
                <span className="ld-stat-ic">{STAT_ICON[s.key]}</span>
                <span>
                  <b>{s.big}</b>
                  <small>{s.small}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* about */}
      <section id="about" className="ld-about">
        <div className="ld-wrap ld-about-in">
          <div className="ld-about-text">
            <span className="ld-kicker">{tx('আমাদের সম্পর্কে')}</span>
            <h2>{pick(site?.about_title) || society}</h2>
            {pick(site?.intro) && <p className={aboutMore ? '' : 'ld-clamp'}>{pick(site?.intro)}</p>}
            {aboutMore && facts.length > 0 && (
              <ul className="ld-facts">
                {facts.map((f) => (
                  <li key={f.label}>
                    {f.label}: <b>{f.value}</b>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="ld-btn ld-btn-green" onClick={() => (aboutMore && committee.length ? scrollTo('committee') : setAboutMore(!aboutMore))}>
              {aboutMore ? (committee.length ? tx('পরিচালনা কমিটি') : tx('কম দেখুন')) : tx('আরও পড়ুন')} <ArrowRightOutlined />
            </button>
          </div>
          <div className="ld-about-media">
            <img src={site?.about_photo ? sitePhotoUrl(site.about_photo) : asset('about.jpg')} alt={society} />
            <div className="ld-vmv">
              {[
                { icon: <TargetIcon />, title: tx('আমাদের লক্ষ্য'), text: pick(site?.vision) },
                { icon: <HandshakeIcon />, title: tx('আমাদের উদ্দেশ্য'), text: pick(site?.mission) },
                { icon: <DiamondIcon />, title: tx('আমাদের মূল্যবোধ'), text: pick(site?.values) },
              ]
                .filter((v) => v.text)
                .map((v) => (
                  <div key={v.title} className="ld-vmv-row">
                    <span className="ld-vmv-ic">{v.icon}</span>
                    <span>
                      <b>{v.title}</b>
                      <small>{v.text}</small>
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>

      {/* services */}
      <section id="services" className="ld-services">
        <div className="ld-wrap">
          <div className="ld-services-head">
            <div>
              <span className="ld-kicker">{tx('আমাদের সেবা')}</span>
              <h2>{tx('আমরা যা করি')}</h2>
              <p>{tx('কৃষি ও আবাসিক ব্যবহারের জন্য সমন্বিত পানি ব্যবস্থাপনা সেবা, একটি টেকসই ও সমৃদ্ধ সমাজের জন্য।')}</p>
            </div>
            <button
              type="button"
              className="ld-btn ld-btn-outline"
              onClick={() =>
                setInfo({
                  title: tx('সব সেবা'),
                  body: (
                    <ul className="ld-all-services">
                      {ALL_SERVICES.map((s) => (
                        <li key={s.title}>
                          <b>{s.title}</b>
                          <span>{s.text}</span>
                        </li>
                      ))}
                    </ul>
                  ),
                })
              }
            >
              {tx('সব সেবা দেখুন')} <ArrowRightOutlined />
            </button>
          </div>
          <div className="ld-svc-grid">
            {SERVICES.map((s) => (
              <div key={s.key} className={`ld-svc ld-svc-${s.key}`}>
                <img src={s.photo} alt="" loading="lazy" />
                <div className="ld-svc-body">
                  <span className="ld-svc-ic">{s.icon}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                  <button type="button" className="ld-more" onClick={() => setInfo({ title: s.title, body: <p className="ld-info-text">{s.more}</p> })}>
                    {tx('আরও জানুন')} <ArrowRightOutlined />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* notices + faq */}
      {(notices.length > 0 || faqs.length > 0) && (
        <section className="ld-nf">
          <div className={`ld-wrap ld-nf-in${notices.length && faqs.length ? '' : ' ld-nf-solo'}`}>
            {notices.length > 0 && (
              <div id="notices">
                <div className="ld-nf-head">
                  <h2>
                    <SoundFilled className="ld-nf-ic ld-nf-mega" /> {tx('সাম্প্রতিক নোটিশ')}
                  </h2>
                  {notices.length > 4 && (
                    <button
                      type="button"
                      className="ld-more"
                      onClick={() =>
                        setInfo({
                          title: tx('সব নোটিশ'),
                          body: (
                            <div className="ld-notices">
                              {notices.map((n, i) => (
                                <NoticeRow key={i} n={n} onClick={() => showNotice(n)} />
                              ))}
                            </div>
                          ),
                        })
                      }
                    >
                      {tx('সব দেখুন')} <ArrowRightOutlined />
                    </button>
                  )}
                </div>
                <div className="ld-notices">
                  {notices.slice(0, 4).map((n, i) => (
                    <NoticeRow key={i} n={n} onClick={() => showNotice(n)} />
                  ))}
                </div>
              </div>
            )}
            {faqs.length > 0 && (
              <div id="faq">
                <div className="ld-nf-head">
                  <h2>
                    <QuestionCircleFilled className="ld-nf-ic" /> {tx('সচরাচর জিজ্ঞাসা')}
                  </h2>
                  {faqs.length > 8 && (
                    <button type="button" className="ld-more" onClick={() => setAllFaqs(!allFaqs)}>
                      {allFaqs ? tx('কম দেখুন') : tx('সব দেখুন')} <ArrowRightOutlined />
                    </button>
                  )}
                </div>
                <div className="ld-faqs">
                  {shownFaqs.map((f, i) => (
                    <div key={i} className={`ld-faq${openFaq === i ? ' open' : ''}`}>
                      <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                        <span>{pick(f.q)}</span>
                        {openFaq === i ? <MinusOutlined /> : <PlusOutlined />}
                      </button>
                      {openFaq === i && <p>{pick(f.a)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* committee */}
      {committee.length > 0 && (
        <section id="committee" className="ld-plain">
          <div className="ld-wrap">
            <span className="ld-kicker">{tx('পরিচালনা কমিটি')}</span>
            <h2 className="ld-plain-title">{tx('যাঁরা সমিতি পরিচালনা করছেন')}</h2>
            <div className="ld-committee">
              {committee.map((c, i) => (
                <div className="ld-person" key={i}>
                  {c.photo ? <img className="ld-avatar" src={sitePhotoUrl(c.photo)} alt={pick(c.name)} /> : <span className="ld-avatar"><UserOutlined /></span>}
                  <b>{pick(c.name)}</b>
                  <small>{pick(c.role)}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* gallery */}
      {gallery.length > 0 && (
        <section id="gallery" className="ld-plain ld-plain-tint">
          <div className="ld-wrap">
            <span className="ld-kicker">{tx('গ্যালারি')}</span>
            <h2 className="ld-plain-title">{tx('আমাদের কার্যক্রম')}</h2>
            <div className="ld-gallery">
              {gallery.map((g, i) => (
                <figure key={i}>
                  <img src={sitePhotoUrl(g.photo)} alt={pick(g.caption)} loading="lazy" />
                  {pick(g.caption) && <figcaption>{pick(g.caption)}</figcaption>}
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* call to action */}
      <section className="ld-cta" style={{ backgroundImage: `url("${asset('cta.jpg')}")` }}>
        <div className="ld-wrap ld-cta-in">
          <span className="ld-cta-ic">
            <PlantHandIcon />
          </span>
          <div>
            <h2>{tx('আসুন, পানি-নিরাপদ ও সমৃদ্ধ সমাজ একসাথে গড়ি')}</h2>
            <p>{tx('টেকসই পানি ব্যবস্থাপনায় আমাদের সাথে যুক্ত হোন, একটি সুন্দর আগামীর জন্য।')}</p>
          </div>
          <button type="button" className="ld-btn ld-btn-green" onClick={() => setInfo({ title: tx('সদস্য হোন'), body: <><p className="ld-info-text">{tx('যেকোনো সক্রিয় কৃষক ভর্তি ফি দিয়ে সদস্যপদের আবেদন করতে পারেন। কমিটির অনুমোদনের পর সদস্য নম্বর দেওয়া হয়। বিস্তারিত জানতে যোগাযোগ করুন:')}</p>{contactBody}</> })}>
            {tx('সদস্য হোন')} <ArrowRightOutlined />
          </button>
        </div>
      </section>

      {/* footer */}
      <footer id="contact" className="ld-foot">
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
              <button type="button" key={n.id} onClick={() => go(n.id)}>
                {n.label}
              </button>
            ))}
          </div>
          <div>
            <h4>{tx('আমাদের সেবা')}</h4>
            {[tx('সেচ সেবা'), tx('পানি সরবরাহ সেবা'), tx('সদস্য সেবা'), tx('হিসাব ও ব্যবস্থাপনা'), tx('সম্পদ ব্যবস্থাপনা'), tx('রিপোর্ট ও স্বচ্ছতা')].map((l) => (
              <button type="button" key={l} onClick={() => go('services')}>
                {l}
              </button>
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
            {site?.map_url && (
              <a href={site.map_url} target="_blank" rel="noreferrer">
                <EnvironmentFilled /> {tx('ম্যাপে দেখুন')}
              </a>
            )}
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
              © {year} {society}। {tx('সর্বস্বত্ব সংরক্ষিত।')}
            </span>
            <span className="ld-foot-bar-links">
              <Link to="/pay">{tx('অনলাইন পেমেন্ট')}</Link>
              <Link to="/login">{tx('কর্মীদের লগইন')}</Link>
              <button type="button" onClick={() => go('top')}>
                {tx('উপরে যান')}
              </button>
            </span>
          </div>
        </div>
      </footer>

      <Modal open={!!info} title={info?.title} footer={null} onCancel={() => setInfo(null)} destroyOnHidden>
        {info?.body}
      </Modal>
    </div>
  )
}

function NoticeRow({ n, onClick }: { n: SiteNotice; onClick: () => void }) {
  const d = noticeDate(n.date)
  const tag = pick(n.tag)
  return (
    <button type="button" className="ld-notice" onClick={onClick}>
      <span className="ld-notice-date">
        <b>{d.day}</b>
        <small>{d.rest}</small>
      </span>
      <span className="ld-notice-title">{pick(n.title)}</span>
      {tag && <span className={`ld-tag ld-tag-${tagTone(tag)}`}>{tag}</span>}
      <RightOutlined className="ld-notice-go" />
    </button>
  )
}
