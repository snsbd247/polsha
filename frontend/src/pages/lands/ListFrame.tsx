import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { App, Button, ConfigProvider, Dropdown, Pagination, Select } from 'antd'
import { DoubleLeftOutlined, DoubleRightOutlined, DownloadOutlined, DownOutlined, HomeOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { api, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { exportCsv, exportXlsx, printReport, type ReportResult } from '../../lib/reports'
import { usePublicSettings } from '../../lib/settings'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../farmers/farmer-list.css'
import '../membership/member-list.css'
import '../farmers/deleted-farmers.css'
import '../masters/patwari-list.css'
import './land-reports.css'

export type StatCard = {
  key: string
  label: string
  value?: number | string
  unit?: string
  icon: string
  color: string
  tint: string
  onClick?: () => void
  /** a white glyph on a filled disc inside the tinted ring, as some designs draw it */
  solid?: ReactNode
}

export const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
export const acres = (decimal: number) => digits((decimal / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const initials = (name: string) =>
  name
    .replace(/^(Md\.|Mst\.|মোঃ|মোছাঃ)\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

/**
 * The page frame the approved list designs share: breadcrumb, title with
 * actions, four summary cards, a filter row and a titled table card with
 * first/last paging. Pages supply the pieces.
 */
export default function ListFrame(props: {
  section: { label: string; to: string }
  title: string
  subtitle: string
  actions?: ReactNode
  cards: StatCard[]
  filters: ReactNode
  /** extra class on the filter row, e.g. for a two-row layout */
  filterClass?: string
  onSearch: () => void
  onReset: () => void
  tableTitle: string
  tableTools?: ReactNode
  above?: ReactNode
  children: ReactNode
  paging?: { page: number; perPage: number; total: number; showing: string; onPage: (p: number) => void; onPerPage: (n: number) => void }
}) {
  const { paging } = props
  const lastPage = paging ? Math.max(1, Math.ceil(paging.total / paging.perPage)) : 1
  return (
    // the approved designs use a blue accent on these pages, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml pl">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to={props.section.to}>{props.section.label}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{props.title}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{props.title}</h1>
            <p>{props.subtitle}</p>
          </div>
          {props.actions && <div className="fl-head-btns">{props.actions}</div>}
        </div>

        <div className="fl-stats ml-stats pl-stats">
          {props.cards.map((c) => (
            <button key={c.key} type="button" className={`fl-stat ${c.onClick ? '' : 'mz-stat'}`} style={{ ['--tint' as string]: c.tint }} onClick={c.onClick}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                {c.solid ? (
                  <span className="lf-solid" style={{ background: c.color }}>
                    {c.solid}
                  </span>
                ) : (
                  <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
                )}
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-value">
                  {c.value === undefined ? '—' : typeof c.value === 'number' ? n0(c.value) : c.value}
                  {c.unit && <small className="mz-unit">{c.unit}</small>}
                </span>
              </span>
            </button>
          ))}
        </div>

        {props.above}

        <div className={`dl-filters pl-filters ${props.filterClass ?? ''}`}>
          {props.filters}
          <div className="fl-filter-btns">
            <Button type="primary" icon={<SearchOutlined />} onClick={props.onSearch}>
              {tx('খুঁজুন')}
            </Button>
            <Button onClick={props.onReset}>{tx('রিসেট')}</Button>
          </div>
        </div>

        <div className="fl-card fl-table-card">
          <div className="fl-table-head ml-table-head">
            <h3>{props.tableTitle}</h3>
            {props.tableTools && <div className="vl-tools">{props.tableTools}</div>}
          </div>
          {props.children}
          {paging && (
            <div className="fl-foot">
              <span className="fl-showing">{paging.showing}</span>
              <span className="ml-pager">
                <Button className="ml-edge" icon={<DoubleLeftOutlined />} disabled={paging.page <= 1} aria-label={tx('প্রথম পাতা')} onClick={() => paging.onPage(1)} />
                <Pagination
                  className="fl-pager"
                  current={paging.page}
                  pageSize={paging.perPage}
                  total={paging.total}
                  showSizeChanger={false}
                  showLessItems
                  itemRender={(page, type, el) => (type === 'page' ? <a>{digits(page)}</a> : el)}
                  onChange={paging.onPage}
                />
                <Button className="ml-edge" icon={<DoubleRightOutlined />} disabled={paging.page >= lastPage} aria-label={tx('শেষ পাতা')} onClick={() => paging.onPage(lastPage)} />
              </span>
              <span className="fl-rows">
                {tx('প্রতি পাতায় সারি')}{' '}
                <Select value={paging.perPage} className="fl-size" options={[10, 25, 50, 100].map((v) => ({ value: v, label: digits(v) }))} onChange={paging.onPerPage} />
              </span>
            </div>
          )}
        </div>
      </div>
    </ConfigProvider>
  )
}

/** Run one of the server reports with the page's filters and save or print it (the export is logged like any report). */
export async function exportReport(key: string, filters: Record<string, unknown>, format: 'xlsx' | 'csv' | 'print', society: string) {
  const r = (await api.get<ReportResult>(`/reports/${key}`, { params: filters })).data
  if (format === 'xlsx') exportXlsx(r, society)
  else if (format === 'csv') exportCsv(r)
  else printReport(r, society)
}

/** "Export ▾" with Excel, CSV and print of the matching server report(s). */
export function ExportMenu({ reports, filters }: { reports: { key: string; label: string }[]; filters: Record<string, unknown> }) {
  const { message } = App.useApp()
  const { data: settings } = usePublicSettings()
  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en })
  const run = (key: string, format: 'xlsx' | 'csv' | 'print') => exportReport(key, filters, format, society).catch((e) => message.error(errorMessage(e)))
  const items = reports.flatMap((r) => [
    ...(reports.length > 1 ? [{ key: `${r.key}-h`, type: 'group' as const, label: r.label }] : []),
    { key: `${r.key}-x`, label: 'Excel (.xlsx)', onClick: () => run(r.key, 'xlsx') },
    { key: `${r.key}-c`, label: 'CSV', onClick: () => run(r.key, 'csv') },
    { key: `${r.key}-p`, label: tx('প্রিন্ট / PDF'), onClick: () => run(r.key, 'print') },
  ])
  return (
    <Dropdown trigger={['click']} placement="bottomRight" menu={{ items }}>
      <Button icon={<DownloadOutlined />}>
        {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
      </Button>
    </Dropdown>
  )
}

/** One labelled filter in the row. */
export function Field({ label, children, grow }: { label?: string; children: ReactNode; grow?: number }) {
  return (
    <div className={`fl-field ${label ? '' : 'dl-search'}`} style={grow ? { flexGrow: grow } : undefined}>
      <span className={label ? undefined : 'ml-hidden'}>{label ?? '.'}</span>
      {children}
    </div>
  )
}
