import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Empty, Skeleton, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, ExclamationOutlined, InfoOutlined, ReloadOutlined, WarningFilled } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { digits, fmtDateTime } from '../lib/format'
import { lang, nameOf, t as tx } from '../lib/i18n'
import { DashIcon } from './dashboard/DashIcons'
import './dashboard/dashboard.css'

type Kpi = {
  key: string
  label: string
  value: number
  type: 'money' | 'number' | 'decimal'
  link: string
  caption: string | null
  change: number | null
}
type Day = { date: string; total: number } & Record<string, number | string>
type Recent = {
  id: number
  no: string
  date: string
  payer: string
  amount: number
  module: string
  module_label: string
  status: string
  link: string
  kind: string
}
type Approval = {
  id: number
  date: string
  type: string
  title: string
  applicant: string | null
  link: string
}
type Notice = {
  key: string
  label: string
  count: number
  tone: 'error' | 'warning' | 'info'
  link: string
}
type Season = {
  id: number | null
  name: string | null
  invoices: number
  amount: number
  collected: number
  due: number
}
type Dashboard = {
  kpis: Kpi[]
  pending: { key: string; label: string; count: number; link: string }[]
  approvals: Approval[]
  notices: Notice[]
  alerts: {
    type: 'error' | 'warning' | 'info'
    message: string
    link: string
  }[]
  season?: Season
  collection?: {
    days: Day[]
    modules: { key: string; label: string }[]
    today: number
    month: number
  }
  recent?: Recent[]
  generated_at: string
}

/** Card look per KPI: icon + accent colour, as in the approved design. */
const LOOK: Record<string, { icon: string; color: string; bg: string }> = {
  farmers: { icon: 'users', color: '#1f9d55', bg: '#e3f5ea' },
  member_farmers: { icon: 'users', color: '#2563eb', bg: '#e4edfd' },
  non_member_farmers: { icon: 'userX', color: '#e0383e', bg: '#fde6e7' },
  land: { icon: 'layers', color: '#6d4ae6', bg: '#ece7fc' },
  irrigation_invoices: { icon: 'file', color: '#2563eb', bg: '#e4edfd' },
  irrigation_collection: { icon: 'moneyBag', color: '#1f9d55', bg: '#e3f5ea' },
  irrigation_due: { icon: 'receipt', color: '#e0383e', bg: '#fde6e7' },
  water_collection: { icon: 'drop', color: '#0b8fd6', bg: '#e0f1fb' },
  water_due: { icon: 'drop', color: '#e0383e', bg: '#fde6e7' },
  savings: { icon: 'piggy', color: '#f08c00', bg: '#fdf0dc' },
  loans: { icon: 'handCoins', color: '#7c4ddb', bg: '#efe8fc' },
  share: { icon: 'share', color: '#e0386b', bg: '#fde6ee' },
  cash: { icon: 'cash', color: '#0b8fd6', bg: '#e0f1fb' },
  bank: { icon: 'bank', color: '#4f46e5', bg: '#e9e8fc' },
  assets: { icon: 'building', color: '#1f9d55', bg: '#e3f5ea' },
}

/** Fixed chart colours per collection module (irrigation green, savings blue, loan orange, share purple). */
const MODULE_COLOR: Record<string, string> = {
  irrigation: '#22b55f',
  water: '#0ea5e9',
  savings: '#2f6fed',
  loan: '#f59e0b',
  share: '#9b5cf6',
}
const OTHER_COLORS = ['#14b8a6', '#ec4899', '#64748b', '#f97316']
const moduleColor = (key: string, i: number) => MODULE_COLOR[key] ?? OTHER_COLORS[i % OTHER_COLORS.length]

/** Type tag colours (Recent Transactions). */
const TAG: Record<string, [string, string]> = {
  irrigation: ['#e6f6ec', '#1a8a47'],
  savings: ['#e6f6ec', '#1a8a47'],
  loan: ['#fdeaea', '#d93636'],
  share: ['#efeafd', '#6d4ae6'],
  combined: ['#e4edfd', '#2563eb'],
}

/** ৳ amount: Indian grouping, paisa only when there is any. */
const tk = (n: number) =>
  '৳ ' +
  digits(
    (Number(n) || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }),
  )
const num = (k: Kpi) => (k.type === 'money' ? tk(k.value) : digits(k.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })))
const shortDate = (d: string) => digits(dayjs(d).format(lang === 'en' ? 'MMM DD' : 'DD MMM'))
const rowDate = (d: string) => digits(dayjs(d).format('DD-MM-YYYY'))

/** 200000 → 200K (axis labels). */
function compact(v: number): string {
  if (v >= 10_000_000) return digits(+(v / 10_000_000).toFixed(1)) + (lang === 'en' ? 'Cr' : ' কো')
  if (v >= 100_000 && lang !== 'en') return digits(+(v / 100_000).toFixed(1)) + ' লা'
  if (v >= 1_000_000) return digits(+(v / 1_000_000).toFixed(1)) + 'M'
  if (v >= 1_000) return digits(+(v / 1_000).toFixed(1)) + 'K'
  return digits(v)
}

/** A "nice" axis maximum with 4 equal steps. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 }
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag
  return { top: step * 4, step }
}

function Change({ value }: { value: number | null }) {
  if (value === null) return null
  const up = value >= 0
  return (
    <span className={`dash-change ${up ? 'up' : 'down'}`}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {digits(Math.abs(value).toFixed(1))}%
    </span>
  )
}

function KpiCard({ k }: { k: Kpi }) {
  const look = LOOK[k.key] ?? LOOK.farmers
  return (
    <Link to={k.link} className="dash-kpi" style={{ ['--tint' as string]: look.bg }}>
      <span className="dash-kpi-icon" style={{ background: look.bg }}>
        <DashIcon name={look.icon} color={look.color} size={30} />
      </span>
      <span className="dash-kpi-body">
        <span className="dash-kpi-label">{k.label}</span>
        <span className="dash-kpi-row">
          <span className="dash-kpi-value">{num(k)}</span>
          <Change value={k.change} />
        </span>
        {k.caption && <span className="dash-kpi-caption">{k.caption}</span>}
      </span>
    </Link>
  )
}

function Panel({ title, badge, extra, children, className }: { title: string; badge?: number; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`dash-panel ${className ?? ''}`}>
      <header className="dash-panel-head">
        <h3>
          <DashIcon name="chart" size={19} color="#2563eb" stroke={2.4} />
          {title}
          {badge ? <span className="dash-count">{digits(badge)}</span> : null}
        </h3>
        {extra}
      </header>
      <div className="dash-panel-body">{children}</div>
    </section>
  )
}

function DailyChart({ days, modules }: { days: Day[]; modules: { key: string; label: string }[] }) {
  const { top, step } = niceScale(Math.max(0, ...days.map((d) => d.total)))
  const ticks = [4, 3, 2, 1, 0].map((i) => i * step)
  const last = days.length - 1
  return (
    <div className="dash-chart">
      <div className="dash-chart-y">
        {ticks.map((t) => (
          <span key={t}>{compact(t)}</span>
        ))}
      </div>
      <div className="dash-chart-main">
        <div className="dash-chart-plot">
          {ticks.map((t) => (
            <i key={t} className="dash-grid" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          {days.map((d) => (
            <Tooltip
              key={d.date}
              title={
                <>
                  <div>{digits(dayjs(d.date).format('DD/MM/YYYY'))}</div>
                  {modules.map((m) =>
                    Number(d[m.key]) ? (
                      <div key={m.key}>
                        {m.label}: {tk(Number(d[m.key]))}
                      </div>
                    ) : null,
                  )}
                  <b>
                    {tx('মোট')}: {tk(d.total)}
                  </b>
                </>
              }
            >
              <div className="dash-bar-slot">
                <div className="dash-bar" style={{ height: `${(d.total / top) * 100}%` }}>
                  {modules.map((m, i) =>
                    Number(d[m.key]) ? (
                      <div
                        key={m.key}
                        style={{
                          height: `${(Number(d[m.key]) / d.total) * 100}%`,
                          background: moduleColor(m.key, i),
                        }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            </Tooltip>
          ))}
        </div>
        <div className="dash-chart-x">
          {days.map((d, i) => (
            <span key={d.date}>{i % 5 === 0 || i === last ? shortDate(d.date) : ''}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Donut({ season }: { season: Season }) {
  const r = 64
  const c = 2 * Math.PI * r
  const share = season.amount > 0 ? season.collected / season.amount : 0
  const pct = (v: number) => (season.amount > 0 ? digits(((v / season.amount) * 100).toFixed(1)) : digits('0.0'))
  return (
    <div className="dash-donut-wrap">
      <div className="dash-donut">
        <svg viewBox="0 0 160 160" width="100%" height="100%">
          <circle cx="80" cy="80" r={r} fill="none" stroke={season.amount > 0 ? '#f47272' : '#e5e7eb'} strokeWidth="22" />
          {share > 0 && <circle cx="80" cy="80" r={r} fill="none" stroke="#22b55f" strokeWidth="22" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 80 80)" />}
        </svg>
        <div className="dash-donut-center">
          <b>{tk(season.amount)}</b>
          <span>{tx('মোট ইনভয়েস')}</span>
        </div>
      </div>
      <div className="dash-donut-legend">
        <div>
          <i style={{ background: '#22b55f' }} />
          <span className="lbl">{tx('আদায়')}</span>
          <b>{tk(season.collected)}</b>
          <span className="pct">({pct(season.collected)}%)</span>
        </div>
        <div>
          <i style={{ background: '#f47272' }} />
          <span className="lbl">{tx('বকেয়া')}</span>
          <b>{tk(season.due)}</b>
          <span className="pct">({pct(season.due)}%)</span>
        </div>
      </div>
    </div>
  )
}

const TONE_ICON = {
  error: <WarningFilled />,
  warning: <ExclamationOutlined />,
  info: <InfoOutlined />,
}

export default function DashboardPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [allAlerts, setAllAlerts] = useState(false)
  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<Dashboard>('/dashboard')).data,
    refetchInterval: 5 * 60_000,
  })
  const refresh = async () => {
    const fresh = (await api.get<Dashboard>('/dashboard', { params: { refresh: 1 } })).data
    queryClient.setQueryData(['dashboard'], fresh)
  }

  // rows of the design: 4 + 4 + the rest (loans, share, cash, bank, assets)
  const rows = useMemo(() => {
    const k = data?.kpis ?? []
    return [k.slice(0, 4), k.slice(4, 8), k.slice(8)].filter((r) => r.length)
  }, [data])

  const alertRows = useMemo(() => {
    const online = data?.pending.find((p) => p.key === 'public_payments')
    const list: {
      key: string
      label: string
      count: number | null
      tone: 'error' | 'warning' | 'info'
      link: string
    }[] = [
      ...(data?.notices ?? []),
      ...(online?.count
        ? [
            {
              key: 'online',
              label: online.label,
              count: online.count,
              tone: 'info' as const,
              link: online.link,
            },
          ]
        : []),
      ...(data?.alerts ?? []).map((a) => ({
        key: a.message,
        label: a.message,
        count: null,
        tone: a.type,
        link: a.link,
      })),
    ]
    return list
  }, [data])
  const shownAlerts = allAlerts ? alertRows : alertRows.slice(0, 6)
  const approvalsCount = data?.pending.find((p) => p.key === 'approvals')?.count ?? 0

  const today = dayjs()
  const viewAll = (to: string) => (
    <Link to={to} className="dash-viewall">
      {tx('সব দেখুন')}
    </Link>
  )

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1>{tx('ড্যাশবোর্ড')}</h1>
          <p>{tx('স্বাগতম, {{p0}}। আপনার সমবায় সমিতির সার্বিক চিত্র নিচে দেওয়া হলো।', { p0: nameOf(user) })}</p>
        </div>
        <div className="dash-head-right">
          <Tooltip title={data ? tx('হালনাগাদ: {{d}}', { d: fmtDateTime(data.generated_at) }) : undefined}>
            <Button className="dash-refresh" icon={<ReloadOutlined />} loading={isFetching} onClick={refresh} aria-label={tx('হালনাগাদ')} />
          </Tooltip>
          <div className="dash-today">
            <DashIcon name="calendar" size={16} color="#374151" />
            {tx('আজ')}: {digits(today.format('DD MMM YYYY'))} ({today.format('dddd')})
          </div>
        </div>
      </div>

      {isLoading && <Skeleton active paragraph={{ rows: 8 }} />}

      {/* rows of 4+4+5 on wide screens; on narrower ones all cards flow as one grid */}
      <div className="dash-kpi-wrap">
        {rows.map((r, i) => (
          <div key={i} className={`dash-kpis ${i === 2 ? 'dash-kpis-5' : ''}`} data-n={r.length} style={{ ['--n' as string]: r.length }}>
            {r.map((k) => (
              <KpiCard key={k.key} k={k} />
            ))}
          </div>
        ))}
      </div>

      {(data?.collection || data?.season) && (
        <div className="dash-row dash-row-charts">
          {data?.collection && (
            <Panel
              title={tx('দৈনিক আদায় - গত ৪০ দিন')}
              extra={
                <div className="dash-legend">
                  {data.collection.modules
                    .filter((m, i) => MODULE_COLOR[m.key] || data.collection!.days.some((d) => Number(d[m.key])) || i < 4)
                    .map((m, i) => (
                      <span key={m.key}>
                        <i style={{ background: moduleColor(m.key, i) }} />
                        {m.label}
                      </span>
                    ))}
                </div>
              }
            >
              <DailyChart days={data.collection.days} modules={data.collection.modules} />
            </Panel>
          )}
          {data?.season && (
            <Panel title={tx('আদায় বনাম বকেয়া (এই মৌসুম)')} className="dash-panel-donut">
              {data.season.name && <div className="dash-season">{data.season.name}</div>}
              <Donut season={data.season} />
            </Panel>
          )}
        </div>
      )}

      {data && (
        <div className="dash-row dash-row-lists">
          {data.recent && (
            <Panel title={tx('সাম্প্রতিক লেনদেন')} extra={viewAll('/payments/receipts')}>
              <table className="dash-table">
                <colgroup>
                  <col className="c-date" />
                  <col />
                  <col className="c-type" />
                  <col className="c-amt" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{tx('তারিখ')}</th>
                    <th>{tx('সদস্য/কৃষক')}</th>
                    <th>{tx('ধরন')}</th>
                    <th className="r">{tx('টাকা')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => {
                    const [bg, fg] = TAG[r.module] ?? ['#f1f5f9', '#475569']
                    return (
                      <tr key={`${r.kind}-${r.id}`}>
                        <td>{rowDate(r.date)}</td>
                        <td className="ellipsis">
                          <Link to={r.link}>{r.payer}</Link>
                        </td>
                        <td>
                          <span className="dash-tag" style={{ background: bg, color: fg }}>
                            {r.module_label}
                          </span>
                        </td>
                        <td
                          className="r nowrap"
                          style={
                            r.status === 'cancelled'
                              ? {
                                  textDecoration: 'line-through',
                                  color: '#9ca3af',
                                }
                              : undefined
                          }
                        >
                          {tk(r.amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!data.recent.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('কোনো লেনদেন নেই')} />}
            </Panel>
          )}

          <Panel title={tx('অপেক্ষমাণ অনুমোদন')} badge={approvalsCount} extra={viewAll('/approvals')}>
            <table className="dash-table">
              <colgroup>
                <col className="c-date" />
                <col className="c-kind" />
                <col />
                <col className="c-status" />
              </colgroup>
              <thead>
                <tr>
                  <th>{tx('তারিখ')}</th>
                  <th>{tx('ধরন')}</th>
                  <th>{tx('আবেদনকারী')}</th>
                  <th>{tx('অবস্থা')}</th>
                </tr>
              </thead>
              <tbody>
                {data.approvals.map((a) => (
                  <tr key={a.id}>
                    <td>{rowDate(a.date)}</td>
                    <td className="ellipsis">
                      <Tooltip title={a.title}>
                        <Link to={a.link}>{a.type}</Link>
                      </Tooltip>
                    </td>
                    <td className="ellipsis">{a.applicant}</td>
                    <td>
                      <span className="dash-tag" style={{ background: '#fff3dd', color: '#d97706' }}>
                        {tx('অপেক্ষমাণ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.approvals.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('অপেক্ষমাণ কোনো অনুমোদন নেই')} />}
          </Panel>

          <Panel
            title={tx('গুরুত্বপূর্ণ সতর্কতা')}
            extra={
              alertRows.length > 6 ? (
                <button type="button" className="dash-viewall" onClick={() => setAllAlerts((v) => !v)}>
                  {allAlerts ? tx('কম দেখুন') : tx('সব দেখুন')}
                </button>
              ) : (
                <span className="dash-viewall disabled">{tx('সব দেখুন')}</span>
              )
            }
          >
            <ul className="dash-alerts">
              {shownAlerts.map((a) => (
                <li key={a.key}>
                  <Link to={a.link}>
                    <span className={`dash-alert-icon ${a.tone}`}>{TONE_ICON[a.tone]}</span>
                    <span className="dash-alert-text">{digits(a.label)}</span>
                    {a.count !== null && <span className={`dash-alert-count ${a.tone} ${a.count ? '' : 'zero'}`}>{digits(a.count)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {!alertRows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('কোনো সতর্কতা নেই')} />}
          </Panel>
        </div>
      )}
    </div>
  )
}
