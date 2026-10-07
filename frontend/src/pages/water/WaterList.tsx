import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Checkbox, ConfigProvider, Dropdown, Pagination, Select, type MenuProps } from 'antd'
import { DownloadOutlined, DownOutlined, HomeOutlined, PrinterOutlined, RightOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import './connections.css'

/*
 * The frame the approved water designs share: breadcrumb, five tinted summary
 * cards, a filter card and a list card with its toolbar and pager.
 */

export const pct = (part: number, whole: number) => `${digits(whole > 0 ? ((part / whole) * 100).toFixed(1) : '0.0')}%`
export const num = (n: number | undefined | null) => digits(Math.round(n ?? 0).toLocaleString('en-IN'))

/** Blue accent of the designs, whatever the brand colour. */
export function WaterFrame({ crumbs, className, children }: { crumbs: { label: string; to?: string }[]; className?: string; children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1769e0',
          colorLink: '#1769e0',
          borderRadius: 6,
        },
      }}
    >
      <div className={`wcl ${className ?? ''}`}>
        <nav className="wcl-crumb wcl-no-print">
          <Link to="/">
            <HomeOutlined /> {tx('হোম')}
          </Link>
          {crumbs.map((c, i) => (
            <span key={c.label} style={{ display: 'contents' }}>
              <RightOutlined className="wcl-sep" />
              {i === crumbs.length - 1 ? <b>{c.label}</b> : c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
        {children}
      </div>
    </ConfigProvider>
  )
}

export type SummaryCard = {
  key: string
  tone: 'blue' | 'green' | 'red' | 'orange' | 'purple'
  icon: ReactNode
  label: string
  value: string
  sub?: ReactNode
}

/** Label on top in the card's colour, then the figure and a small line. */
export function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="wcl-cards wcl-no-print" style={{ ['--n' as string]: cards.length }}>
      {cards.map((c) => (
        <div key={c.key} className={`wcl-card wcl-card-${c.tone} wcl-card-labelled`}>
          <span className="wcl-card-ic">{c.icon}</span>
          <span className="wcl-card-body">
            <span className="wcl-card-label">{c.label}</span>
            <b>{c.value}</b>
            {c.sub && <small>{c.sub}</small>}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`wcl-field ${wide ? 'wcl-field-search' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

/** "Filter & Search" card: the fields, then Search and Reset. */
export function FilterCard({ title, className, onSearch, onReset, children }: { title?: ReactNode; className?: string; onSearch: () => void; onReset: () => void; children: ReactNode }) {
  return (
    <div className={`wcl-filters wcl-no-print ${title ? 'wcl-filters-titled' : ''} ${className ?? ''}`}>
      {title && <h3 className="wcl-filter-title">{title}</h3>}
      {children}
      <div className="wcl-filter-btns">
        <Button type="primary" icon={<SearchOutlined />} onClick={onSearch}>
          {tx('খুঁজুন')}
        </Button>
        <Button className="wcl-reset" onClick={onReset}>
          {tx('রিসেট')}
        </Button>
      </div>
    </div>
  )
}

/** Hidden columns, remembered on this device. */
export function useHiddenColumns(storageKey: string, initial: string[] = []) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const v = localStorage.getItem(storageKey)
      return v ? JSON.parse(v) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(hidden))
    } catch {
      /* storage unavailable */
    }
  }, [storageKey, hidden])
  return [hidden, setHidden] as const
}

/** Print after the page has re-rendered (e.g. with only the ticked rows). */
export function usePrint() {
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const id = window.setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 50)
    return () => window.clearTimeout(id)
  }, [printing])
  return [printing, () => setPrinting(true)] as const
}

type ColumnChoice = { key: string; title: ReactNode }

/** The list card: title or main buttons on the left; export, print and column settings on the right; the table; the pager. */
export function ListCard({
  title,
  actions,
  selectedCount = 0,
  onExport,
  exportItems,
  onPrint,
  columns,
  hidden,
  setHidden,
  pager,
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  selectedCount?: number
  onExport?: () => void
  exportItems?: MenuProps['items']
  onPrint?: () => void
  columns?: ColumnChoice[]
  hidden?: string[]
  setHidden?: (fn: (h: string[]) => string[]) => void
  pager?: {
    page: number
    perPage: number
    total: number
    onPage: (p: number) => void
    onSize: (n: number) => void
  }
  children: ReactNode
}) {
  const from = pager?.total ? (pager.page - 1) * pager.perPage + 1 : 0
  const to = pager ? Math.min(pager.page * pager.perPage, pager.total) : 0
  return (
    <div className="wcl-list">
      <div className="wcl-tools">
        {title && <h3 className="wcl-list-title">{title}</h3>}
        {!title && <span className="wcl-no-print wcl-tools-lead">{actions}</span>}
        <span className="wcl-tools-gap" />
        {selectedCount > 0 && <span className="wcl-picked wcl-no-print">{tx('{{p0}}টি বাছাই করা', { p0: digits(selectedCount) })}</span>}
        {title && actions}
        {(onExport || exportItems) && (
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: exportItems ?? [
                {
                  key: 'csv',
                  icon: <DownloadOutlined />,
                  label: selectedCount ? tx('বাছাই করা সারি — CSV (Excel)') : tx('সব সারি — CSV (Excel)'),
                  onClick: onExport,
                },
              ],
            }}
          >
            <Button icon={<DownloadOutlined />} className="wcl-no-print">
              {tx('এক্সপোর্ট')} <DownOutlined className="wcl-caret" />
            </Button>
          </Dropdown>
        )}
        {onPrint && (
          <Button icon={<PrinterOutlined />} className="wcl-no-print" onClick={onPrint}>
            {tx('প্রিন্ট')}
          </Button>
        )}
        {columns && hidden && setHidden && (
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            popupRender={() => (
              <div className="wcl-colmenu">
                {columns.map((c) => (
                  <Checkbox key={c.key} checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                    {c.title}
                  </Checkbox>
                ))}
              </div>
            )}
          >
            <Button icon={<SettingOutlined />} className="wcl-no-print">
              {tx('কলাম সেটিংস')}
            </Button>
          </Dropdown>
        )}
      </div>
      {children}
      {pager && (
        <div className="wcl-foot wcl-no-print">
          <span>
            {tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', {
              p0: digits(from),
              p1: digits(to),
              p2: num(pager.total),
            })}
          </span>
          <span className="wcl-foot-end">
            <Pagination
              className="wcl-pager"
              current={pager.page}
              pageSize={pager.perPage}
              total={pager.total}
              showSizeChanger={false}
              showLessItems
              itemRender={(page, type, el) => (type === 'page' ? <a>{digits(page)}</a> : el)}
              onChange={pager.onPage}
            />
            <Select
              className="wcl-size"
              value={pager.perPage}
              options={[10, 25, 50, 100].map((n) => ({
                value: n,
                label: tx('{{p0}} / পাতা', { p0: digits(n) }),
              }))}
              onChange={pager.onSize}
            />
          </span>
        </div>
      )}
    </div>
  )
}
