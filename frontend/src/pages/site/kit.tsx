import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BankFilled, ClockCircleFilled, CreditCardFilled, HomeFilled, HomeOutlined, PieChartFilled, RightOutlined, WalletFilled } from '@ant-design/icons'
import { digits } from '../../lib/format'
import { lang, t as tx } from '../../lib/i18n'
import type { PublicSettings } from '../../lib/settings'
import { pick, type PublicSite, type SiteNotice, type SiteStat } from '../../lib/website'

/*
 * Pieces every page of the public website shares: the site's data, the stock
 * photos, the drawn icons, the services catalogue, the page banner and the notice row.
 */

export const asset = (name: string) => `${import.meta.env.BASE_URL}landing-img/${name}`

/* ---------- what every page reads ---------- */
export type SiteCtx = {
  site: PublicSite | undefined
  settings: PublicSettings | undefined
  society: string
  brandTitle: string
  brandSub: string
  brandTag: string
  logo: string
  phone: string
  email: string
  address: string
  hours: string
  telHref: string
}
export const SiteContext = createContext<SiteCtx | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useSite() {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error('useSite must be used inside SiteLayout')
  return ctx
}

/** The browser tab (and search engines) name each page. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageTitle(title: string | null) {
  const { brandTitle } = useSite()
  useEffect(() => {
    document.title = title ? `${title} — ${brandTitle}` : brandTitle
  }, [title, brandTitle])
}

/* ---------- small drawn icons (the icon font has no farmer, field or drop) ---------- */
const Svg = ({ children, vb = '0 0 48 48' }: { children: ReactNode; vb?: string }) => (
  <svg viewBox={vb} fill="currentColor" aria-hidden="true">
    {children}
  </svg>
)
export const FarmerIcon = () => (
  <Svg>
    <path d="M14 13c0-1.5 4-6 10-6s10 4.5 10 6l4 1v2H10v-2z" />
    <circle cx="24" cy="21" r="6" />
    <path d="M12 44V35c0-5 4-8 8-8h8c4 0 8 3 8 8v9H12z" />
    <path d="M22 28h4l-1 6h-2z" fill="#fff" opacity=".6" />
  </Svg>
)
export const FieldIcon = () => (
  <Svg>
    <circle cx="24" cy="24" r="22" />
    <path d="M8 22c6-5 12-5 16 0s10 5 16 0M7 29c6-5 12-5 17 0s11 5 17 0M10 36c5-4 10-4 14 0s9 4 14 0" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
  </Svg>
)
export const HouseIcon = () => (
  <Svg>
    <path d="M24 5 3 24h6v19h11V31h8v12h11V24h6z" />
  </Svg>
)
export const DropIcon = () => (
  <Svg>
    <path d="M24 3S9 20 9 30a15 15 0 0 0 30 0C39 20 24 3 24 3z" />
    <path d="M17 30a7 7 0 0 0 7 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".7" />
  </Svg>
)
export const PeopleIcon = () => (
  <Svg>
    <circle cx="24" cy="12" r="6" />
    <circle cx="10" cy="17" r="5" />
    <circle cx="38" cy="17" r="5" />
    <path d="M14 42V31c0-5 4-9 10-9s10 4 10 9v11z" />
    <path d="M2 40v-8c0-4 3-7 8-7 2 0 3 .5 4.5 1.3C12.6 28 12 30 12 32v8zM46 40v-8c0-4-3-7-8-7-2 0-3 .5-4.5 1.3C35.4 28 36 30 36 32v8z" />
  </Svg>
)
export const LeafIcon = () => (
  <Svg>
    <path d="M40 6C20 6 10 16 10 30c0 3 .6 5.5 1.6 7.6C15 26 22 20 32 16 24 22 17 30 13 42l4 1c1-3 2-5.5 3.4-8C34 36 42 26 40 6z" />
  </Svg>
)
export const TargetIcon = () => (
  <Svg>
    <circle cx="22" cy="26" r="17" fill="none" stroke="currentColor" strokeWidth="4" />
    <circle cx="22" cy="26" r="9" fill="none" stroke="currentColor" strokeWidth="4" />
    <circle cx="22" cy="26" r="3" />
    <path d="M23 25 40 8M34 6l7 1 1 7-6 1-3-3z" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
  </Svg>
)
export const HandshakeIcon = () => (
  <Svg>
    <path d="M2 16 10 10l7 3h7l-6 6c-1.5 1.5-1.5 3.5 0 5s3.5 1.5 5 0l5-5 12 11-3 3-2-2-3 3-2-2-3 3-2-2-3 3-11-11-5 2z" />
    <path d="M46 16l-8-6-6 3-9 9c-.8.8-.8 2 0 2.6.8.8 2 .8 2.6 0L31 19l12 11 3-2z" />
  </Svg>
)
export const DiamondIcon = () => (
  <Svg>
    <path d="M12 6h24l10 12-22 26L2 18z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
    <path d="M2 18h44M17 6l-4 12 11 26 11-26-4-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
  </Svg>
)
export const BarsIcon = () => (
  <Svg>
    <rect x="5" y="26" width="9" height="17" rx="1" fill="#16a34a" />
    <rect x="19" y="16" width="9" height="27" rx="1" fill="#1677d2" />
    <rect x="33" y="6" width="9" height="37" rx="1" fill="#1677d2" />
  </Svg>
)
export const PlantHandIcon = () => (
  <Svg vb="0 0 64 64">
    <path d="M32 34V20" stroke="currentColor" strokeWidth="3" fill="none" />
    <path d="M32 24c-2-8-9-12-17-11 1 8 8 12 17 11zM32 20c2-9 10-13 19-12-1 9-9 13-19 12z" />
    <path d="M4 46h10l10-6c3-2 6-2 9 0l6 3c2 1 2 4-1 4H26M38 47l14-7c3-1.5 6 0 6 2.5L42 54c-3 2-6 2-9 2H18l-6 3H4z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
  </Svg>
)

export const STAT_ICON: Record<string, ReactNode> = {
  farmers: <FarmerIcon />,
  irrigated_acres: <FieldIcon />,
  water_connections: <HouseIcon />,
  years: <ClockCircleFilled />,
  reliable: <DropIcon />,
  healthy: <PeopleIcon />,
}

/** Live numbers first, then the two promises — five in all. */
// eslint-disable-next-line react-refresh/only-export-components
export function buildStats(site: PublicSite | undefined) {
  const live = site?.stats ?? []
  if (!live.length) return []
  const byKey = (k: SiteStat['key']) => live.find((s) => s.key === k)?.value ?? 0
  const people = Math.max(byKey('farmers'), byKey('members'))
  const n = (v: number) => `${digits(v.toLocaleString('en-IN'))}+`
  const items = [
    people > 0 && { key: 'farmers', big: n(people), small: tx('কৃষক ও সদস্য') },
    byKey('irrigated_acres') > 0 && { key: 'irrigated_acres', big: n(byKey('irrigated_acres')), small: tx('একর সেচের জমি') },
    byKey('water_connections') > 0 && { key: 'water_connections', big: n(byKey('water_connections')), small: tx('আবাসিক সংযোগ') },
    byKey('years') > 0 && { key: 'years', big: `${digits(byKey('years'))}+`, small: tx('বছরের সেবা') },
  ].filter(Boolean) as { key: string; big: string; small: string }[]
  return [...items.slice(0, 3), { key: 'reliable', big: tx('নির্ভরযোগ্য'), small: tx('পানি সরবরাহ') }, { key: 'healthy', big: tx('সুস্থ'), small: tx('সমাজ') }]
}

export function StatsBand({ site }: { site: PublicSite | undefined }) {
  const stats = buildStats(site)
  if (!stats.length) return null
  return (
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
  )
}

/* ---------- the services: each has its own page at /services/:key ---------- */
export type Service = {
  key: string
  photo: string
  icon: ReactNode
  title: string
  text: string
  intro: string
  points: string[]
  steps: string[]
  papers: string[]
  /** where its call-to-action leads */
  cta: { label: string; to: string }
}

export const SERVICES: Service[] = [
  {
    key: 'irrigation',
    photo: asset('svc-irrigation.jpg'),
    icon: <LeafIcon />,
    title: tx('সেচ সেবা'),
    text: tx('কৃষি উন্নয়নের জন্য দক্ষ পানি ব্যবস্থাপনা।'),
    intro: tx('প্রতিটি মৌসুমে জমির পরিমাণ ও ধরন অনুযায়ী সেচের পানি দেওয়া হয়। সেচ চার্জ মৌসুম শুরুর আগে জানানো হয় এবং প্রতিটি জমার রশিদ দেওয়া হয়।'),
    points: [
      tx('মৌসুমভিত্তিক সেচ — বোরো, আমন ও আউশ'),
      tx('জমির পরিমাণ ও ধরন অনুযায়ী স্বচ্ছ সেচ চার্জ'),
      tx('প্রতিটি জমার QR কোডসহ রশিদ'),
      tx('অফিসে, মাঠকর্মীর কাছে বা বিকাশ/নগদে পরিশোধ'),
    ],
    steps: [tx('সমিতির অফিসে কৃষক হিসেবে নাম নিবন্ধন করুন'), tx('জমির তথ্য (দাগ নং, পরিমাণ) দিন'), tx('মৌসুম শুরুর আগে সেচের তালিকায় জমি যুক্ত করুন'), tx('বিল পেলে সময়মতো পরিশোধ করুন')],
    papers: [tx('জাতীয় পরিচয়পত্রের কপি'), tx('জমির দলিল বা খতিয়ানের কপি'), tx('এক কপি ছবি')],
    cta: { label: tx('অনলাইনে সেচের বিল দিন'), to: '/pay' },
  },
  {
    key: 'water',
    photo: asset('svc-water.jpg'),
    icon: <HomeFilled />,
    title: tx('আবাসিক পানি সরবরাহ'),
    text: tx('পরিবারের জন্য নিরাপদ ও নির্ভরযোগ্য পানি সরবরাহ।'),
    intro: tx('বাড়িতে বাড়িতে নিরাপদ পানির সংযোগ। সংযোগের ধরন অনুযায়ী নির্দিষ্ট মাসিক বিল, যা অফিসে, মাঠকর্মীর কাছে বা বিকাশ/নগদে দেওয়া যায়।'),
    points: [tx('গ্রামের যে কেউ সংযোগ নিতে পারেন'), tx('ধরন অনুযায়ী নির্দিষ্ট মাসিক বিল — মিটারের ঝামেলা নেই'), tx('প্রতি মাসে বিলের SMS'), tx('বিল পরিশোধের QR কোডসহ রশিদ')],
    steps: [tx('অফিসে এসে সংযোগের আবেদন ফর্ম পূরণ করুন'), tx('সংযোগ ফি জমা দিন'), tx('কর্মীরা সরেজমিনে দেখে সংযোগ দেবেন'), tx('পরের মাস থেকে মাসিক বিল শুরু হবে')],
    papers: [tx('জাতীয় পরিচয়পত্রের কপি'), tx('এক কপি ছবি'), tx('বাড়ির ঠিকানা ও মোবাইল নম্বর')],
    cta: { label: tx('অনলাইনে পানির বিল দিন'), to: '/pay' },
  },
  {
    key: 'savings',
    photo: asset('svc-member.jpg'),
    icon: <WalletFilled />,
    title: tx('সঞ্চয়'),
    text: tx('সদস্যদের নিয়মিত সঞ্চয় ও বছর শেষে মুনাফা।'),
    intro: tx('সমিতির সদস্যরা নিয়মিত সঞ্চয় জমা রাখেন। প্রতিটি জমা ও উত্তোলনের হিসাব খাতায় থাকে এবং বছর শেষে সাধারণ সভার সিদ্ধান্ত অনুযায়ী মুনাফা দেওয়া হয়।'),
    points: [tx('মাসিক বা ইচ্ছেমতো জমা'), tx('বছর শেষে মুনাফা'), tx('প্রয়োজনে নিয়ম মেনে উত্তোলন'), tx('প্রতিটি জমার রশিদ')],
    steps: [tx('সমিতির সদস্য হোন'), tx('সঞ্চয় হিসাব খুলুন'), tx('নিয়মিত জমা দিন ও রশিদ রাখুন')],
    papers: [tx('জাতীয় পরিচয়পত্রের কপি'), tx('এক কপি ছবি'), tx('নমিনির তথ্য')],
    cta: { label: tx('সদস্য হতে যোগাযোগ করুন'), to: '/contact?subject=membership' },
  },
  {
    key: 'loans',
    photo: asset('svc-member.jpg'),
    icon: <BankFilled />,
    title: tx('ঋণ'),
    text: tx('কৃষি ও জরুরি প্রয়োজনে সহজ কিস্তিতে ঋণ।'),
    intro: tx('সদস্যরা কৃষিকাজ ও জরুরি প্রয়োজনে সমিতি থেকে ঋণ নিতে পারেন। ঋণ কমিটির অনুমোদনে দেওয়া হয় এবং সহজ কিস্তিতে পরিশোধ করা যায়।'),
    points: [tx('কৃষি ও জরুরি প্রয়োজনে ঋণ'), tx('সহজ মাসিক কিস্তি'), tx('কিস্তি অফিসে বা বিকাশ/নগদে'), tx('প্রতিটি কিস্তির রশিদ')],
    steps: [tx('সমিতির সদস্য হোন'), tx('ঋণের আবেদন জমা দিন'), tx('কমিটির অনুমোদনের পর ঋণ বিতরণ'), tx('সময়মতো কিস্তি পরিশোধ করুন')],
    papers: [tx('জাতীয় পরিচয়পত্রের কপি'), tx('জামিনদারের তথ্য'), tx('ঋণের উদ্দেশ্য')],
    cta: { label: tx('ঋণের কিস্তি দিন'), to: '/pay' },
  },
  {
    key: 'shares',
    photo: asset('svc-accounting.jpg'),
    icon: <PieChartFilled />,
    title: tx('শেয়ার'),
    text: tx('সমিতির মালিকানায় অংশ ও বার্ষিক লভ্যাংশ।'),
    intro: tx('সমিতির শেয়ার কিনে সদস্যরা সমিতির মালিকানার অংশীদার হন। বছর শেষে সাধারণ সভার সিদ্ধান্ত অনুযায়ী লভ্যাংশ দেওয়া হয়।'),
    points: [tx('সমিতির মালিকানায় অংশ'), tx('বার্ষিক লভ্যাংশ'), tx('শেয়ার সনদ ও রশিদ')],
    steps: [tx('সমিতির সদস্য হোন'), tx('শেয়ার কেনার টাকা জমা দিন'), tx('শেয়ার সনদ ও রশিদ নিন')],
    papers: [tx('সদস্য নম্বর'), tx('জাতীয় পরিচয়পত্রের কপি')],
    cta: { label: tx('যোগাযোগ করুন'), to: '/contact?subject=shares' },
  },
  {
    key: 'online-payment',
    photo: asset('svc-accounting.jpg'),
    icon: <CreditCardFilled />,
    title: tx('অনলাইন পেমেন্ট'),
    text: tx('বিকাশ/নগদে বিল পরিশোধ, অফিসে আসার দরকার নেই।'),
    intro: tx('সেচ, পানি ও ঋণের কিস্তি বিকাশ বা নগদে পাঠিয়ে এই ওয়েবসাইটের "অনলাইনে বিল দিন" পাতায় লেনদেন নম্বর দিন। অফিস যাচাই করলে রশিদ তৈরি হয় ও SMS যায়।'),
    points: [tx('বিকাশ/নগদে পরিশোধ'), tx('অনুরোধ নম্বর দিয়ে অবস্থা দেখা'), tx('যাচাইয়ের পর রশিদ ও SMS')],
    steps: [tx('সমিতির বিকাশ/নগদ নম্বরে টাকা পাঠান'), tx('"অনলাইনে বিল দিন" পাতায় তথ্য দিন'), tx('অনুরোধ নম্বর সংরক্ষণ করুন'), tx('যাচাইয়ের পর রশিদের SMS পাবেন')],
    papers: [tx('কৃষক আইডি বা পানির সংযোগ নং'), tx('লেনদেন (TrxID) নম্বর')],
    cta: { label: tx('অনলাইনে বিল দিন'), to: '/pay' },
  },
]

/* ---------- the strip under the header on every inner page ---------- */
export function PageBanner({ title, crumbs = [] }: { title: string; crumbs?: { label: string; to?: string }[] }) {
  return (
    <section className="ld-banner" style={{ backgroundImage: `url("${asset('cta.jpg')}")` }}>
      <div className="ld-wrap ld-banner-in">
        <h1>{title}</h1>
        <nav className="ld-crumbs" aria-label={tx('অবস্থান')}>
          <Link to="/">
            <HomeOutlined /> {tx('হোম')}
          </Link>
          {[...crumbs, { label: title }].map((c, i) => (
            <span key={i} className="ld-crumb">
              <RightOutlined />
              {c.to ? <Link to={c.to}>{c.label}</Link> : <b>{c.label}</b>}
            </span>
          ))}
        </nav>
      </div>
    </section>
  )
}

/* ---------- notices ---------- */
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_BN = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে']
// eslint-disable-next-line react-refresh/only-export-components
export function noticeDate(iso: string) {
  const [y, m, d] = iso.split('-')
  const month = (lang === 'en' ? MONTHS_EN : MONTHS_BN)[Number(m) - 1] ?? m
  return { day: digits(d), rest: `${month} ${digits(y)}` }
}

/** Red for notices, blue for events/meetings, green for everything else. */
// eslint-disable-next-line react-refresh/only-export-components
export function tagTone(tag: string) {
  const t = tag.toLowerCase()
  if (/notice|নোটিশ|জরুরি|urgent/.test(t)) return 'red'
  if (/event|meeting|সভা|অনুষ্ঠান/.test(t)) return 'blue'
  return 'green'
}

export function NoticeRow({ n }: { n: SiteNotice }) {
  const d = noticeDate(n.date)
  const tag = pick(n.tag)
  return (
    <Link to={`/notices/${n.id}`} className="ld-notice">
      <span className="ld-notice-date">
        <b>{d.day}</b>
        <small>{d.rest}</small>
      </span>
      <span className="ld-notice-title">{pick(n.title)}</span>
      {tag && <span className={`ld-tag ld-tag-${tagTone(tag)}`}>{tag}</span>}
      <RightOutlined className="ld-notice-go" />
    </Link>
  )
}

/** "Reliable Water\nfor [Agriculture]" → lines, with the bracketed words in green. */
export function HeroTitle({ text }: { text: string }) {
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
