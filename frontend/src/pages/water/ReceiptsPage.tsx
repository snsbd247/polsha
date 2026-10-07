import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { App, Button, DatePicker, Input, Select, Table, type TableColumnsType } from 'antd'
import { CalendarFilled, CloseCircleFilled, DollarOutlined, EyeOutlined, FileDoneOutlined, FilterFilled, PrinterOutlined, SearchOutlined, WalletFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { METHOD_LABEL, RECEIPT_STATUS_LABEL } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import { Field, FilterCard, ListCard, num, SummaryCards, useHiddenColumns, usePrint, WaterFrame } from './WaterList'

/** Water receipts: what came in, when, how and by whom. */
type Row = { id: number; receipt_no: string; date: string; payer_name: string; amount: string; method: string; reference: string | null; status: string; creator: { name_bn: string; name_en: string | null } | null }
type Cards = { count: number; amount: number; today: number; month: number; cancelled: number }
type Params = { page: number; per_page: number; search?: string; status?: string; method?: string; from?: string; to?: string }

const longDate = (d?: string | null) => (d ? digits(dayjs(d).format('DD MMM YYYY')) : '—')
const STATUS_TONE: Record<string, string> = { active: 'green', cancelled: 'grey', cancel_pending: 'amber' }

export default function ReceiptsPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Omit<Params, 'page' | 'per_page'>>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useHiddenColumns('polsha.water.receipts.hidden', ['reference'])
  const [printing, print] = usePrint()
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'receipts', params],
    queryFn: async () => (await api.get<Paginated<Row> & { cards: Cards }>('/water/receipts', { params })).data,
    placeholderData: keepPreviousData,
  })

  const apply = () => setParams((p) => ({ ...p, ...draft, search: draft.search?.trim() || undefined, page: 1 }))
  const reset = () => {
    setDraft({})
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }

  const c = data?.cards
  const filtered = !!(params.search || params.status || params.method || params.from || params.to)
  const cards = [
    { key: 'today', tone: 'green' as const, icon: <CalendarFilled />, label: tx('আজকের আদায়'), value: `৳ ${num(c?.today)}`, sub: longDate(dayjs().format('YYYY-MM-DD')) },
    { key: 'month', tone: 'blue' as const, icon: <WalletFilled />, label: tx('এই মাসের আদায়'), value: `৳ ${num(c?.month)}`, sub: digits(dayjs().format('MMMM YYYY')) },
    { key: 'count', tone: 'purple' as const, icon: <FileDoneOutlined />, label: tx('রশিদের সংখ্যা'), value: num(c?.count), sub: filtered ? tx('খোঁজা অনুযায়ী') : tx('সব সময়ের') },
    { key: 'amount', tone: 'orange' as const, icon: <span className="wcl-taka">৳</span>, label: tx('মোট আদায়'), value: `৳ ${num(c?.amount)}`, sub: tx('বাতিল বাদে') },
    { key: 'cancelled', tone: 'red' as const, icon: <CloseCircleFilled />, label: tx('বাতিল রশিদ'), value: num(c?.cancelled), sub: filtered ? tx('খোঁজা অনুযায়ী') : tx('সব সময়ের') },
  ]

  const allColumns: (TableColumnsType<Row>[number] & { key: string; fixedCol?: boolean })[] = [
    { key: 'sl', title: '#', width: 48, fixedCol: true, render: (_, __, i) => digits((params.page - 1) * params.per_page + i + 1) },
    {
      key: 'receipt_no',
      title: tx('রশিদ নং'),
      dataIndex: 'receipt_no',
      width: 150,
      fixedCol: true,
      render: (v: string, r) => (
        <Link to={`/water/receipts/${r.id}`} className="wcl-plain-link">
          {digits(v)}
        </Link>
      ),
    },
    { key: 'date', title: tx('তারিখ'), dataIndex: 'date', width: 115, render: longDate },
    { key: 'payer', title: tx('গ্রাহক'), dataIndex: 'payer_name', width: 190, render: (v: string) => <span title={v}>{v}</span> },
    { key: 'amount', title: tx('টাকা (৳)'), dataIndex: 'amount', width: 110, align: 'right', render: (v) => <strong>{money(v)}</strong> },
    { key: 'method', title: tx('মাধ্যম'), dataIndex: 'method', width: 105, render: (m: string) => METHOD_LABEL[m] ?? m },
    { key: 'reference', title: tx('রেফারেন্স'), dataIndex: 'reference', width: 130, render: (v) => (v ? digits(v) : <span className="wcl-muted">—</span>) },
    { key: 'creator', title: tx('আদায়কারী'), width: 150, render: (_, r) => nameOf(r.creator) || <span className="wcl-muted">—</span> },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', width: 120, render: (s: string) => <span className={`wcl-tag wcl-tag-${STATUS_TONE[s] ?? 'amber'}`}>{RECEIPT_STATUS_LABEL[s] ?? s}</span> },
    {
      key: 'action',
      title: tx('কাজ'),
      width: 96,
      fixedCol: true,
      className: 'wcl-no-print wcl-actcol',
      render: (_, r) => (
        <span className="wcl-acts">
          <Link to={`/water/receipts/${r.id}`} className="wcl-act" aria-label={tx('বিস্তারিত')} title={tx('বিস্তারিত')}>
            <EyeOutlined />
          </Link>
          <button type="button" className="wcl-act wcl-act-edit" aria-label={tx('প্রিন্ট')} title={tx('রশিদ প্রিন্ট')} onClick={() => navigate(`/water/receipts/${r.id}?print=1`)}>
            <PrinterOutlined />
          </button>
        </span>
      ),
    },
  ]
  const columns = allColumns.filter((col) => !hidden.includes(col.key))
  const rows = useMemo(() => {
    const all = data?.data ?? []
    return printing && selected.length ? all.filter((r) => selected.includes(r.id)) : all
  }, [data, printing, selected])

  return (
    <WaterFrame crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('পানির রশিদ') }]}>
      <SummaryCards cards={cards} />

      <FilterCard
        title={
          <>
            <FilterFilled /> {tx('ফিল্টার ও খোঁজ')}
          </>
        }
        onSearch={apply}
        onReset={reset}
      >
        <Field label={tx('খুঁজুন')} wide>
          <Input
            prefix={<SearchOutlined />}
            placeholder={tx('রশিদ নং, গ্রাহকের নাম বা রেফারেন্স...')}
            allowClear
            value={draft.search}
            onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
            onPressEnter={apply}
          />
        </Field>
        <Field label={tx('তারিখ (থেকে – পর্যন্ত)')}>
          <DatePicker.RangePicker
            format="DD/MM/YYYY"
            value={draft.from && draft.to ? [dayjs(draft.from), dayjs(draft.to)] : null}
            onChange={(r) => setDraft((d) => ({ ...d, from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') }))}
          />
        </Field>
        <Field label={tx('মাধ্যম')}>
          <Select
            value={draft.method ?? ''}
            options={[{ value: '', label: tx('সব মাধ্যম') }, ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))]}
            onChange={(v) => setDraft((d) => ({ ...d, method: v || undefined }))}
          />
        </Field>
        <Field label={tx('অবস্থা')}>
          <Select
            value={draft.status ?? ''}
            options={[{ value: '', label: tx('সব অবস্থা') }, ...Object.entries(RECEIPT_STATUS_LABEL).map(([value, label]) => ({ value, label }))]}
            onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
          />
        </Field>
      </FilterCard>

      <ListCard
        title={
          <>
            <FileDoneOutlined /> {tx('রশিদের তালিকা')}
          </>
        }
        actions={
          can('water.create') && (
            <Button type="primary" icon={<DollarOutlined />} className="wcl-no-print" onClick={() => navigate('/water/collect')}>
              {tx('বিল আদায়')}
            </Button>
          )
        }
        selectedCount={selected.length}
        onExport={() =>
          downloadExport('/water/receipts', { ...params, page: undefined, per_page: undefined, ids: selected.length ? selected.join(',') : undefined, export: 'csv' }, 'water-receipts.csv').catch((e) =>
            message.error(errorMessage(e)),
          )
        }
        onPrint={print}
        columns={allColumns.filter((col) => !col.fixedCol).map((col) => ({ key: col.key, title: col.title as ReactNode }))}
        hidden={hidden}
        setHidden={setHidden}
        pager={{
          page: params.page,
          perPage: params.per_page,
          total: data?.total ?? 0,
          onPage: (page) => setParams((p) => ({ ...p, page })),
          onSize: (per_page) => setParams((p) => ({ ...p, per_page, page: 1 })),
        }}
      >
        <Table<Row>
          className="wcl-table"
          rowKey="id"
          loading={isFetching}
          dataSource={rows}
          tableLayout="fixed"
          scroll={{ x: 1100 }}
          pagination={false}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 44, preserveSelectedRowKeys: true }}
          columns={columns}
        />
      </ListCard>
    </WaterFrame>
  )
}
