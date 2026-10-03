import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CalendarFilled, ClockCircleFilled, DownOutlined, EyeFilled, FileTextFilled, FlagOutlined, PlusOutlined, PrinterOutlined, RollbackOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { JOURNAL_STATUS, JOURNAL_TONE, VOUCHER_TYPE_LABEL, accountFilter, accountLabel, money, useAccountOptions } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import './accounting.css'

type Row = {
  id: number
  summary?: string | null
  voucher_no: string
  voucher_type: string
  date: string
  narration: string | null
  module: string | null
  status: string
  amount: number
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Resp = Paginated<Row> & { counts: { total: number; month: number; month_amount: number; pending: number; reversed: number } }
type Filters = { search?: string; type?: string; status?: string; account_id?: number; from?: string; to?: string }

const TYPE_TONE: Record<string, string> = { journal: 'll-blue', opening: 'll-purple', receipt: 'fl-tag-green', payment: 'fl-tag-red', contra: 'll-orange' }

/** Every voucher (manual and the ones modules post), with what is waiting for approval. */
export default function JournalListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const { data: accounts } = useAccountOptions()
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['journals', params],
    queryFn: async () => (await api.get<Resp>('/journals', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
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
  const exportCsv = () => downloadExport('/journals', { ...filters, export: 'csv' }, 'vouchers.csv').catch((e) => message.error(errorMessage(e)))
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'total', label: tx('মোট ভাউচার'), value: c?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    {
      key: 'month',
      label: tx('এই মাসে পোস্টেড · ৳{{p0}}', { p0: money(c?.month_amount ?? 0) }),
      value: c?.month,
      icon: '',
      glyph: <CalendarFilled />,
      color: '#1f9d55',
      tint: '#dcf3e5',
      onClick: () => show({ status: 'posted', from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') }),
    },
    { key: 'pending', label: tx('অনুমোদনের অপেক্ষায়'), value: c?.pending, icon: '', glyph: <ClockCircleFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ status: 'pending' }) },
    { key: 'reversed', label: tx('রিভার্সড'), value: c?.reversed, icon: '', glyph: <RollbackOutlined />, color: '#6b7280', tint: '#eef0f3', onClick: () => show({ status: 'reversed' }) },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('ভাউচার নং'),
      dataIndex: 'voucher_no',
      render: (v: string, j) => (
        <Link to={`/accounting/journals/${j.id}`} className="fl-link iv-no">
          {digits(v)}
        </Link>
      ),
    },
    { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
    { title: tx('ধরন'), dataIndex: 'voucher_type', render: (t: string) => <Tag className={`fl-tag ${TYPE_TONE[t] ?? 'll-gray'}`}>{VOUCHER_TYPE_LABEL[t] ?? t}</Tag> },
    {
      title: tx('বিবরণ'),
      dataIndex: 'narration',
      // what the voucher did, in plain words, under its own narration
      render: (v: string | null, j: Row) => (
        <span className="jl-narr">
          {v || '—'}
          {j.summary && <small className="jl-sum">{j.summary}</small>}
        </span>
      ),
    },
    { title: tx('পরিমাণ (৳)'), dataIndex: 'amount', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag className={`fl-tag iv-status ${JOURNAL_TONE[s] ?? 'll-gray'}`}>{JOURNAL_STATUS[s]?.label ?? s}</Tag> },
    {
      title: tx('প্রস্তুতকারী'),
      render: (_, j) =>
        j.creator ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(j.creator.name_bn)}</span>
            <span className="mg-name">{nameOf(j.creator)}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, j) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/accounting/journals/${j.id}`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('হিসাব'), to: '/accounting/summary' }}
      title={tx('ভাউচার')}
      subtitle=""
      actions={
        can('accounting.create') && (
          <>
            <Button icon={<FlagOutlined />} onClick={() => navigate('/accounting/journals/new?type=opening')}>
              {tx('প্রারম্ভিক জের এন্ট্রি')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/accounting/journals/new')}>
              {tx('নতুন জার্নাল')}
            </Button>
          </>
        )
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={240}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('ভাউচার নং বা বিবরণ...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('ধরন')}>
            <Select value={draft.type ?? ''} options={[...all, ...Object.entries(VOUCHER_TYPE_LABEL).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ type: v || undefined })} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(JOURNAL_STATUS).map(([value, s]) => ({ value, label: s.label }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
          <Field label={tx('হিসাব')} grow={220}>
            <Select
              value={draft.account_id ?? 0}
              showSearch={{ filterOption: accountFilter }}
              options={[{ value: 0, label: tx('সকল') }, ...(accounts ?? []).map((a) => ({ value: a.id, label: accountLabel(a) }))]}
              onChange={(v) => set({ account_id: v || undefined })}
            />
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
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('ভাউচারের তালিকা'), p1: n0(total) })}
      tableTools={
        <>
          {can('accounting.export') && (
            <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [{ key: 'csv', label: 'Excel (CSV)', onClick: exportCsv }] }}>
              <Button icon={<AppstoreFilled />} className="ml-columns pl-columns">
                {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          )}
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
        columns={columns}
        locale={{ emptyText: tx('কোনো ভাউচার পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
