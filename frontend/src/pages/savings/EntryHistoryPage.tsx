import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CalendarFilled, CheckCircleOutlined, CloseCircleOutlined, DownOutlined, EyeFilled, FileTextFilled, PlusOutlined, PrinterOutlined, SearchOutlined, SendOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { ENTRY, EVENT_TONE, type EntryKey, type HistoryRow } from '../../lib/fundEntry'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import './savings.css'

type Summary = { total: number; today: number; counts: Record<string, number>; events: Record<string, string>; users: { id: number; name_bn: string; name_en: string | null }[] }
type Page = { data: HistoryRow[]; total: number }
type Filters = { search?: string; event?: string; user_id?: number; from?: string; to?: string }

const ICON: Record<string, ReactNode> = {
  entered: <PlusOutlined />,
  submitted: <SendOutlined />,
  approved: <CheckCircleOutlined />,
  rejected: <CloseCircleOutlined />,
  cancel_requested: <StopOutlined />,
  cancel_rejected: <UndoOutlined />,
  cancelled: <CloseCircleOutlined />,
}
// card colour per event, as on the land history cards
const CARD: Record<string, [string, string]> = {
  entered: ['#1f9d55', '#dcf3e5'],
  submitted: ['#1769e0', '#e4edfd'],
  approved: ['#1f9d55', '#dcf3e5'],
  rejected: ['#e5383b', '#fde4e5'],
  cancel_requested: ['#f08c00', '#fdefd6'],
  cancel_rejected: ['#8b3fe0', '#efe4fc'],
  cancelled: ['#e5383b', '#fde4e5'],
}

/** Every step taken on deposits (or share collections), from the audit log; rows are never deleted. */
export default function EntryHistoryPage({ entry }: { entry: EntryKey }) {
  const cfg = ENTRY[entry]
  const navigate = useNavigate()
  const { message } = App.useApp()
  const wide = Grid.useBreakpoint().lg
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [hidden, setHidden] = useState<string[]>([])
  const params = { page, per_page: perPage, type: cfg.type, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['fund-history', cfg.key, params],
    queryFn: async () => (await api.get<Page>(`/funds/${cfg.kind}/history`, { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['fund-history', cfg.key, 'summary'], queryFn: async () => (await api.get<Summary>(`/funds/${cfg.kind}/history/summary`, { params: { type: cfg.type } })).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange({ from: f.from ? dayjs(f.from) : null, to: f.to ? dayjs(f.to) : null })
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const exportCsv = () => downloadExport(`/funds/${cfg.kind}/history`, { type: cfg.type, ...filters, export: 'csv' }, `${cfg.key}-history.csv`).catch((e) => message.error(errorMessage(e)))
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'total', label: tx('মোট ইতিহাস রেকর্ড'), value: s?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    ...cfg.events.map((e) => ({ key: e, label: s?.events[e] ?? e, value: s?.counts[e], icon: '', glyph: ICON[e], color: CARD[e][0], tint: CARD[e][1], onClick: () => show({ event: e }) })),
    { key: 'today', label: tx('আজকের কার্যক্রম'), value: s?.today, icon: '', glyph: <CalendarFilled />, color: '#0e9f9a', tint: '#d9f4f2', onClick: () => show({ from: dayjs().format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') }) },
  ]

  const allColumns: (ColumnsType<HistoryRow>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'at', title: tx('সময়'), dataIndex: 'at', render: (v: string) => fmtDateTime(v) },
    {
      key: 'event',
      title: tx('কার্যক্রম'),
      dataIndex: 'event',
      render: (e: string | null, r) => (
        <Tag className={`fl-tag hs-kind ${EVENT_TONE[e ?? ''] ?? 'll-gray'}`}>
          {ICON[e ?? '']}
          <span>{r.event_label}</span>
        </Tag>
      ),
    },
    { key: 'no', title: cfg.no, render: (_, r) => (r.transaction ? <Link to={`${cfg.base}/details/${r.transaction.id}`} className="fl-link hs-code">{digits(r.transaction.txn_no)}</Link> : '—') },
    {
      key: 'member',
      title: tx('সদস্যের নাম'),
      render: (_, r) => {
        const f = r.transaction?.account?.farmer
        return f ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>
            <span className="hs-two">
              <Link to={`/farmers/${f.id}`} className="hs-person">
                {nameOf(f)}
              </Link>
              <span>{tx('সদস্য নং {{p0}}', { p0: digits(r.transaction?.account?.member_no ?? '') })}</span>
            </span>
          </span>
        ) : (
          '—'
        )
      },
    },
    { key: 'account', title: tx('হিসাব নং'), render: (_, r) => digits(r.transaction?.account?.account_no ?? '—') },
    { key: 'amount', title: tx('টাকা (৳)'), align: 'right', render: (_, r) => (r.transaction ? money(r.transaction.amount) : '—') },
    { key: 'by', title: tx('সম্পাদনকারী'), dataIndex: 'by', render: (b) => nameOf(b) || '—' },
    { key: 'reason', title: tx('কারণ'), dataIndex: 'reason', className: 'hs-detail', render: (v: string | null) => v || '—' },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 64,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => r.transaction && <Button className="mg-act hs-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`${cfg.base}/details/${r.transaction!.id}#history`)} />,
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  return (
    <ListFrame
      section={{ label: tx('সঞ্চয়'), to: cfg.base }}
      title={cfg.history}
      subtitle=""
      cards={cards}
      statsClass="hs-six"
      filterClass="ll-filters hs-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={340}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('{{p0}}, সদস্যের নাম, সদস্য নং বা মোবাইল দিয়ে খুঁজুন...', { p0: cfg.no })}
              value={draft.search}
              onChange={(e) => set({ search: e.target.value || undefined })}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('কার্যক্রম')}>
            <Select value={draft.event ?? ''} options={[...all, ...Object.entries(s?.events ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ event: v || undefined })} />
          </Field>
          <Field label={tx('সম্পাদনকারী')}>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.user_id ?? ''} options={[...all, ...(s?.users ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]} onChange={(v) => set({ user_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: cfg.history, p1: n0(total) })}
      tableTools={
        <>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'csv', label: 'Excel (CSV)', onClick: exportCsv },
                {
                  key: 'cols',
                  label: tx('কলাম'),
                  children: hideable.map((c) => ({
                    key: `col-${c.key}`,
                    label: (
                      <Checkbox checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                        {c.title as string}
                      </Checkbox>
                    ),
                  })),
                },
              ],
            }}
          >
            <Button icon={<AppstoreFilled />} className="ml-columns pl-columns">
              {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
            </Button>
          </Dropdown>
          <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
        </>
      }
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<HistoryRow>
        className="fl-table ml-table pl-table mg-table hs-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো কার্যক্রম পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
