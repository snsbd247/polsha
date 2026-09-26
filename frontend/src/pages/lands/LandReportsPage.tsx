import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import { HomeOutlined, RightOutlined } from '@ant-design/icons'
import ReportView from '../../components/ReportView'
import { api } from '../../lib/api'
import { digits } from '../../lib/format'
import { useLandMeta } from '../../lib/land'
import { useReportCatalog } from '../../lib/reports'
import { t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { acres, n0 } from './ListFrame'
import '../farmers/farmer-list.css'
import '../membership/member-list.css'
import '../masters/patwari-list.css'
import './land-reports.css'

type Part = { id: number | null; name: string; lands: number; area_decimal: number }
type Overview = { lands: number; area_decimal: number; by_status: { status: string; lands: number; area_decimal: number }[]; tenancy: number; by_mouza: Part[]; by_type: Part[] }

const REPORTS: { key: string; icon: string; color: string; tint: string; hint: string }[] = [
  { key: 'lands', icon: 'layers', color: '#2563eb', tint: '#e4edfd', hint: tx('সব জমি: মৌজা, দাগ, পরিমাণ, ধরন, মালিক ও চাষি') },
  { key: 'land_by_mouza', icon: 'mapPin', color: '#6d4ae6', tint: '#ece7fc', hint: tx('মৌজা অনুযায়ী জমির সংখ্যা, পরিমাণ ও বর্গা') },
  { key: 'land_by_type', icon: 'bars', color: '#f08c00', tint: '#fdf0dc', hint: tx('জমির ধরন অনুযায়ী সংখ্যা ও পরিমাণ') },
  { key: 'land_owners', icon: 'users', color: '#1f9d55', tint: '#e3f5ea', hint: tx('প্রত্যেক মালিকের অংশ ও মালিকানার পরিমাণ') },
  { key: 'land_cultivators', icon: 'sprout', color: '#1f9d55', tint: '#e3f5ea', hint: tx('কে কোন জমি কোন শর্তে চাষ করছেন') },
  { key: 'borga', icon: 'userClock', color: '#e0383e', tint: '#fde6e7', hint: tx('চলমান বর্গা ও লিজ চুক্তি') },
  { key: 'land_history', icon: 'share', color: '#2563eb', tint: '#e4edfd', hint: tx('সময়সীমার মধ্যে মালিকানা ও চাষের পরিবর্তন') },
]

/** Horizontal bars of area per group. */
function Breakdown({ title, parts, link }: { title: string; parts: Part[]; link: (p: Part) => string }) {
  const max = Math.max(1, ...parts.map((p) => p.area_decimal))
  return (
    <div className="fl-card lr-panel">
      <h3>{title}</h3>
      <div className="lr-bars">
        {parts.slice(0, 8).map((p) => (
          <Link key={`${p.id}`} to={link(p)} className="lr-bar-row">
            <span className="lr-bar-name">{p.name}</span>
            <span className="lr-bar-track">
              <span className="lr-bar-fill" style={{ width: `${(p.area_decimal / max) * 100}%` }} />
            </span>
            <span className="lr-bar-val">
              {acres(p.area_decimal)} <small>{tx('একর')}</small>
            </span>
            <span className="lr-bar-count">{tx('{{p0}}টি', { p0: n0(p.lands) })}</span>
          </Link>
        ))}
        {!parts.length && <div className="lr-empty">{tx('কোনো জমি নেই')}</div>}
      </div>
    </div>
  )
}

/** Land figures at a glance, and every land report with its filters and exports. */
export default function LandReportsPage() {
  const [sp, setSp] = useSearchParams()
  const { data: meta } = useLandMeta()
  const { data: catalog } = useReportCatalog()
  const { data: o } = useQuery({ queryKey: ['land-overview'], queryFn: async () => (await api.get<Overview>('/land-register/overview')).data })

  const titles = new Map((catalog?.reports ?? []).map((r) => [r.key, r.title]))
  const available = REPORTS.filter((r) => titles.has(r.key))
  const current = available.find((r) => r.key === sp.get('r')) ?? available[0]
  const status = (s: string) => o?.by_status.find((b) => b.status === s)

  const cards = [
    { key: 'lands', label: tx('মোট জমি'), value: o ? n0(o.lands) : '—', icon: 'layers', color: '#2563eb', tint: '#e4edfd' },
    { key: 'area', label: tx('মোট জমির পরিমাণ'), value: o ? acres(o.area_decimal) : '—', unit: tx('একর'), icon: 'mapPin', color: '#6d4ae6', tint: '#ece7fc' },
    { key: 'cultivated', label: meta?.statuses.cultivated ?? tx('চাষাধীন'), value: o ? acres(status('cultivated')?.area_decimal ?? 0) : '—', unit: tx('একর'), icon: 'sprout', color: '#1f9d55', tint: '#e3f5ea' },
    { key: 'tenancy', label: tx('বর্গা / লিজের জমি'), value: o ? n0(o.tenancy) : '—', unit: tx('টি'), icon: 'userClock', color: '#f08c00', tint: '#fdf0dc' },
  ]

  return (
    // the approved designs use a blue accent on these pages, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml pl lr">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/lands">{tx('জমি ব্যবস্থাপনা')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('জমির রিপোর্ট')}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{tx('জমির রিপোর্ট')}</h1>
            <p>{tx('জমির সারসংক্ষেপ এক নজরে, আর প্রতিটি রিপোর্ট ফিল্টার করে দেখা, Excel বা প্রিন্ট করা যাবে।')}</p>
          </div>
        </div>

        <div className="fl-stats ml-stats pl-stats">
          {cards.map((c) => (
            <div key={c.key} className="fl-stat mz-stat" style={{ ['--tint' as string]: c.tint }}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-value">
                  {c.value}
                  {c.unit && <small className="mz-unit">{c.unit}</small>}
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="lr-panels">
          <Breakdown title={tx('মৌজাভিত্তিক জমি')} parts={o?.by_mouza ?? []} link={(p) => (p.id ? `/lands?mouza_id=${p.id}` : '/lands')} />
          <Breakdown title={tx('ধরনভিত্তিক জমি')} parts={o?.by_type ?? []} link={(p) => (p.id ? `/lands?land_type_id=${p.id}` : '/lands')} />
          <div className="fl-card lr-panel">
            <h3>{tx('অবস্থা অনুযায়ী')}</h3>
            <div className="lr-status">
              {(o?.by_status ?? []).map((b) => (
                <div key={b.status} className={`lr-status-row lr-st-${b.status}`}>
                  <span className="lr-dot" />
                  <span className="lr-bar-name">{meta?.statuses[b.status] ?? b.status}</span>
                  <b>{tx('{{p0}}টি', { p0: n0(b.lands) })}</b>
                  <span>
                    {acres(b.area_decimal)} {tx('একর')}
                  </span>
                  <span className="lr-pct">{o && o.area_decimal ? digits(((b.area_decimal / o.area_decimal) * 100).toFixed(1)) : '0'}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <h3 className="lr-section">{tx('রিপোর্ট সমূহ')}</h3>
        <div className="lr-tiles">
          {available.map((r) => (
            <button key={r.key} type="button" className={`lr-tile ${current?.key === r.key ? 'lr-tile-on' : ''}`} onClick={() => setSp({ r: r.key }, { replace: true })}>
              <span className="lr-tile-icon" style={{ background: r.tint }}>
                <DashIcon name={r.icon} size={22} color={r.color} stroke={2.1} />
              </span>
              <span>
                <strong>{titles.get(r.key)}</strong>
                <small>{r.hint}</small>
              </span>
            </button>
          ))}
        </div>

        {current && (
          <div className="fl-card lr-report">
            <ReportView key={current.key} reportKey={current.key} />
          </div>
        )}
      </div>
    </ConfigProvider>
  )
}
