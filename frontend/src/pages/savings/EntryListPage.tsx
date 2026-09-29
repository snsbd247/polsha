import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CalendarFilled, ClockCircleFilled, DownOutlined, EyeFilled, FileTextFilled, MoreOutlined, PlusOutlined, PrinterFilled, PrinterOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { useFundMeta, type FundTxn } from '../../lib/funds'
import { ENTRY, TXN_TONE, type EntryKey, type EntrySummary } from '../../lib/fundEntry'
import { METHOD_LABEL } from '../../lib/irrigation'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import './savings.css'

type Row = FundTxn & {
  account: { id: number; account_no: string; member_id: number; member: { id: number; member_no: number | string; farmer: { id: number; farmer_code: string; name_bn: string; name_en: string | null; mobile: string | null } | null } | null } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Filters = { search?: string; method?: string; status?: string; from?: string; to?: string }

/** Every deposit (or share collection) with cards, filters and exports. */
export default function EntryListPage({ entry }: { entry: EntryKey }) {
  const cfg = ENTRY[entry]
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const { data: meta } = useFundMeta(cfg.kind)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>(['mobile'])

  const params = { page, per_page: perPage, type: cfg.type, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['fund-entries', cfg.key, params],
    queryFn: async () => (await api.get<Paginated<Row> & { total_in: number; total_out: number }>(`/funds/${cfg.kind}/transactions`, { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['fund-entries', cfg.key, 'summary'], queryFn: async () => (await api.get<EntrySummary>(`/funds/${cfg.kind}/entry-summary`, { params: { type: cfg.type } })).data })

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
  const today = dayjs().format('YYYY-MM-DD')
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const exportCsv = () => downloadExport(`/funds/${cfg.kind}/transactions`, { type: cfg.type, ...filters, export: 'csv' }, `${cfg.key}-entries.csv`).catch((e) => message.error(errorMessage(e)))
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'count', label: tx('মোট {{p0}}', { p0: cfg.noun }), value: s?.count, unit: tx('টি'), icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'amount', label: tx('মোট পরিমাণ'), value: s ? `৳ ${money(s.amount)}` : undefined, icon: 'piggy', color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'posted' }) },
    cfg.out
      ? { key: 'pending', label: tx('অনুমোদনের অপেক্ষায়'), value: s ? `৳ ${money(s.pending_amount)}` : undefined, unit: s ? tx('({{p0}}টি)', { p0: n0(s.pending) }) : undefined, icon: '', glyph: <ClockCircleFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ status: 'pending' }) }
      : { key: 'today', label: tx('আজকের {{p0}}', { p0: cfg.noun }), value: s ? `৳ ${money(s.today_amount)}` : undefined, icon: '', glyph: <CalendarFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ from: today, to: today }) },
    { key: 'month', label: tx('এই মাসের {{p0}}', { p0: cfg.noun }), value: s ? `৳ ${money(s.month_amount)}` : undefined, icon: 'chart', color: '#8b3fe0', tint: '#efe4fc', onClick: () => show({ from: monthStart, to: today }) },
  ]

  const statement = (r: Row) => r.account && navigate(`/funds/${cfg.kind}/accounts/${r.account.id}`)
  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'no', title: cfg.no, dataIndex: 'txn_no', render: (v: string, r) => <Link to={`${cfg.base}/details/${r.id}`} className="fl-link iv-no">{digits(v)}</Link> },
    { key: 'date', title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
    {
      key: 'member',
      title: tx('সদস্যের নাম'),
      render: (_, r) => {
        const f = r.account?.member?.farmer
        return f ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>
            <Link to={`/farmers/${f.id}`} className="mg-name">
              {nameOf(f)}
            </Link>
          </span>
        ) : (
          '—'
        )
      },
    },
    { key: 'member_no', title: tx('সদস্য নং'), render: (_, r) => digits(r.account?.member?.member_no ?? '—') },
    { key: 'account', title: tx('হিসাব নং'), render: (_, r) => (r.account ? <Link to={`/funds/${cfg.kind}/accounts/${r.account.id}`}>{digits(r.account.account_no)}</Link> : '—') },
    { key: 'mobile', title: tx('মোবাইল'), render: (_, r) => digits(r.account?.member?.farmer?.mobile ?? '—') },
    { key: 'method', title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string | null) => (v ? (METHOD_LABEL[v] ?? v) : '—') },
    { key: 'amount', title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    ...(cfg.kind === 'share' && meta?.share_unit_price
      ? [{ key: 'units', title: tx('শেয়ার সংখ্যা'), align: 'right' as const, render: (_: unknown, r: Row) => n0(Math.round(Number(r.amount) / meta.share_unit_price!)) }]
      : []),
    { key: 'balance', title: tx('জের (৳)'), dataIndex: 'balance_after', align: 'right', render: (v: string | null) => (v === null ? '—' : money(v)) },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${TXN_TONE[v] ?? 'll-gray'}`}>{meta?.statuses[v] ?? v}</Tag> },
    { key: 'by', title: cfg.by, render: (_, r) => nameOf(r.creator) || '—' },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`${cfg.base}/details/${r.id}`)} />
          <Button className="fl-act pl-act" icon={<PrinterFilled />} aria-label={tx('প্রিন্ট')} onClick={() => navigate(`${cfg.base}/details/${r.id}?print=1`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'statement', label: tx('হিসাব বিবরণী'), onClick: () => statement(r) },
                { key: 'history', label: tx('ইতিহাস'), onClick: () => navigate(`${cfg.base}/details/${r.id}#history`) },
                ...(r.account?.member ? [{ key: 'farmer', label: tx('কৃষকের প্রোফাইল'), onClick: () => navigate(`/farmers/${r.account!.member!.farmer?.id}`) }] : []),
              ],
            }}
          >
            <Button className="fl-act pl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
          </Dropdown>
        </div>
      ),
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  return (
    <ListFrame
      section={{ label: tx('সঞ্চয়'), to: cfg.base }}
      title={cfg.list}
      subtitle=""
      actions={
        <>
          {can(`${cfg.kind}.create`) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`${cfg.base}/new`)}>
              {cfg.add}
            </Button>
          )}
        </>
      }
      cards={cards}
      filterClass="iv-filters"
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
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('মাধ্যম')}>
            <Select value={draft.method ?? ''} options={[...all, ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ method: v || undefined })} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: cfg.list, p1: n0(total) })}
      tableTools={
        <>
          <span className="sv-total">
            {tx('মোট')}: <strong>৳ {money((cfg.out ? data?.total_out : data?.total_in) ?? 0)}</strong>
          </span>
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
      <Table<Row>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('কোনো {{p0}} পাওয়া যায়নি', { p0: cfg.noun }) }}
      />
    </ListFrame>
  )
}
