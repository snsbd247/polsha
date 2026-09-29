import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CheckOutlined, ClockCircleOutlined, CloseOutlined, DownOutlined, EyeFilled, FileTextFilled, MoreOutlined, PlusOutlined, PrinterFilled, PrinterOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { useInvoiceMeta, type InvoiceRow } from '../../lib/irrigation'
import { downloadExport } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import './invoices.css'

type Row = InvoiceRow & { overdue: boolean; photo_url: string | null }
type Summary = { total: number; paid: number; pending: number; overdue: number }
type Filters = { search?: string; mouza_id?: number; season_id?: number; status?: string; from?: string; to?: string; farmer_id?: number; batch_id?: number; land_id?: number }

// the design shows paid / pending / overdue; part paid reads as pending
export const INVOICE_TONE: Record<string, string> = { paid: 'fl-tag-green', partial: 'fl-tag-gold', unpaid: 'fl-tag-gold', cancelled: 'll-gray' }
const num = (v: string | null) => (v ? Number(v) : undefined)

/** Irrigation invoices, with search, filters and exports. */
export default function InvoiceListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const [sp] = useSearchParams()
  const initial: Filters = { season_id: num(sp.get('season_id')), farmer_id: num(sp.get('farmer_id')), batch_id: num(sp.get('batch_id')), land_id: num(sp.get('land_id')) }
  const [draft, setDraft] = useState<Filters>(initial)
  const [filters, setFilters] = useState<Filters>(initial)
  const [period, setPeriod] = useState<Dayjs | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const { data: meta } = useInvoiceMeta()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  // "overdue" is a filter of its own on the server; the rest are invoice statuses
  const params = { page, per_page: perPage, ...filters, status: filters.status === 'overdue' || filters.status === 'pending' ? undefined : filters.status, overdue: filters.status === 'overdue' ? 1 : undefined, due: filters.status === 'pending' ? 1 : undefined }
  const { data, isFetching } = useQuery({
    queryKey: ['invoices', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/invoices', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['invoices', 'summary'], queryFn: async () => (await api.get<Summary>('/invoices/summary')).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPeriod(null)
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: period?.startOf('month').format('YYYY-MM-DD'), to: period?.endOf('month').format('YYYY-MM-DD') })
    setPage(1)
  }
  const exportCsv = () => downloadExport('/invoices', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'irrigation-invoices.csv').catch((e) => message.error(errorMessage(e)))
  const statusLabel = (r: Row) => (r.overdue ? tx('মেয়াদোত্তীর্ণ') : r.status === 'paid' ? tx('পরিশোধিত') : r.status === 'cancelled' ? (meta?.statuses.cancelled ?? r.status) : r.status === 'partial' ? tx('আংশিক') : tx('অপেক্ষমাণ'))

  const cards = [
    { key: 'total', label: tx('মোট ইনভয়েস'), value: s?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'paid', label: tx('পরিশোধিত ইনভয়েস'), value: s?.paid, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'paid' }) },
    { key: 'pending', label: tx('অপেক্ষমাণ ইনভয়েস'), value: s?.pending, icon: '', solid: <ClockCircleOutlined />, color: '#f5a524', tint: '#fdefd6', onClick: () => show({ status: 'pending' }) },
    { key: 'overdue', label: tx('মেয়াদোত্তীর্ণ ইনভয়েস'), value: s?.overdue, icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'overdue' }) },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'no', title: tx('ইনভয়েস নং'), dataIndex: 'invoice_no', render: (v: string, r) => <Link to={`/irrigation/invoices/${r.id}`} className="fl-link iv-no">{digits(v)}</Link> },
    {
      key: 'farmer',
      title: tx('কৃষকের নাম'),
      render: (_, r) =>
        r.cultivator ? (
          <span className="mg-who">
            {r.photo_url ? <ProtectedImage url={r.photo_url} size={30} shape="square" /> : <span className="ml-initials mg-initials">{initials(nameOf(r.cultivator))}</span>}
            <Link to={`/farmers/${r.cultivator.id}`} className="mg-name">
              {nameOf(r.cultivator)}
            </Link>
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'code', title: tx('কৃষক আইডি'), render: (_, r) => (r.cultivator ? digits(r.cultivator.farmer_code) : '—') },
    { key: 'mouza', title: tx('মৌজা'), render: (_, r) => nameOf({ name_bn: r.mouza, name_en: r.mouza_en }) || '—' },
    { key: 'season', title: tx('মৌসুম'), dataIndex: 'season', render: (v) => v ?? '—' },
    { key: 'date', title: tx('ইনভয়েসের তারিখ'), dataIndex: 'invoice_date', render: fmtDate },
    { key: 'due', title: tx('শেষ তারিখ'), dataIndex: 'due_date', render: (v) => (v ? fmtDate(v) : '—') },
    { key: 'amount', title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: money },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (st: string, r) => <Tag className={`fl-tag iv-status ${r.overdue ? 'fl-tag-red' : (INVOICE_TONE[st] ?? 'll-gray')}`}>{statusLabel(r)}</Tag> },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/irrigation/invoices/${r.id}`)} />
          <Button className="fl-act pl-act" icon={<PrinterFilled />} aria-label={tx('প্রিন্ট')} onClick={() => navigate(`/irrigation/invoices/${r.id}?print=1`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                ...(r.due > 0 && r.status !== 'cancelled' && can('payment.create') ? [{ key: 'collect', label: tx('আদায় করুন'), onClick: () => navigate(`/payments/collect?farmer_id=${r.farmer_id}`) }] : []),
                { key: 'statement', label: tx('কৃষকের সেচ বিবরণী'), onClick: () => navigate(`/irrigation/farmers/${r.farmer_id}/statement`) },
                { key: 'land', label: tx('জমির প্রোফাইল'), onClick: () => navigate(`/lands/${r.land_id}`) },
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
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tx('সেচ ইনভয়েসের তালিকা')}
      subtitle={tx('সব সেচ ইনভয়েস দেখুন ও পরিচালনা করুন। ইনভয়েস তৈরি, আদায় ও পরিশোধের অবস্থা দেখুন।')}
      actions={
        can('irrigation.create') && (
          <>
            <Button icon={<ThunderboltOutlined />} onClick={() => navigate('/irrigation/invoices/bulk')}>
              {tx('একসাথে ইনভয়েস')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/irrigation/invoices/new')}>
              {tx('নতুন ইনভয়েস')}
            </Button>
          </>
        )
      }
      cards={cards}
      filterClass="iv-filters"
      above={
        (filters.farmer_id || filters.batch_id || filters.land_id) && (
          <div className="iv-scope">
            {filters.batch_id ? tx('ব্যাচ #{{p0}}-এর ইনভয়েস', { p0: digits(filters.batch_id) }) : filters.land_id ? tx('একটি জমির ইনভয়েস') : tx('একজন কৃষকের ইনভয়েস')}
            <Button size="small" type="link" onClick={() => show({})}>
              {tx('সব দেখুন')}
            </Button>
          </div>
        )
      }
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={350}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('ইনভয়েস নং, কৃষকের নাম বা মোবাইল দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('মৌজা')}>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.mouza_id ?? ''} options={[{ value: '', label: tx('সকল') }, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]} onChange={(v) => set({ mouza_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('মৌসুম')}>
            <Select value={draft.season_id ?? ''} options={[{ value: '', label: tx('সকল') }, ...(meta?.seasons ?? []).map((x) => ({ value: x.id, label: x.name_bn }))]} onChange={(v) => set({ season_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('ইনভয়েসের মাস')} grow={230}>
            <DatePicker picker="month" format="MMM YYYY" placeholder={tx('মাস/সাল বাছাই করুন')} value={period} onChange={setPeriod} style={{ width: '100%' }} />
          </Field>
          <Field label={tx('পরিশোধের অবস্থা')} grow={250}>
            <Select
              value={draft.status ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'paid', label: tx('পরিশোধিত') },
                { value: 'pending', label: tx('অপেক্ষমাণ') },
                { value: 'partial', label: tx('আংশিক') },
                { value: 'overdue', label: tx('মেয়াদোত্তীর্ণ') },
                { value: 'cancelled', label: meta?.statuses.cancelled ?? tx('বাতিল') },
              ]}
              onChange={(v) => set({ status: v || undefined })}
            />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('সেচ ইনভয়েস ({{p0}})', { p0: n0(total) })}
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
      <Table<Row>
        className="fl-table ml-table pl-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('কোনো ইনভয়েস পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
