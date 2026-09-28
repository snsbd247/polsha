import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CheckOutlined, ClockCircleOutlined, CloseOutlined, SwapOutlined, DownOutlined, EditOutlined, EyeFilled, MoreOutlined, PlusOutlined, PrinterOutlined, SearchOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from './ListFrame'
import './land-list.css'

type Party = { id: number; farmer_code: string; name_bn: string; name_en: string | null }
type Row = {
  id: number
  transfer_no: string
  land_id: number
  land: { land_code: string; dag_no: string; mouza: { name_bn: string } | null } | null
  from_farmer: Party
  to_farmer: Party
  from_photo_url: string | null
  to_photo_url: string | null
  type: 'full' | 'partial'
  share_percent: number
  reason: string
  transfer_date: string
  amount: number | null
  status: 'draft' | 'pending' | 'approved' | 'rejected'
  approval_request_id: number | null
}
type Place = { id: number; name_bn: string; district_id?: number }
type Summary = { total: number; approved: number; pending: number; rejected: number; draft: number }
type Filters = { search?: string; mouza_id?: number; upazila_id?: number; district_id?: number; type?: string; status?: string; from?: string; to?: string }

export const TRANSFER_STATUS: Record<Row['status'], [string, string]> = {
  draft: [tx('খসড়া'), 'ml-tag-gray'],
  pending: [tx('অপেক্ষমাণ'), 'fl-tag-gold'],
  approved: [tx('অনুমোদিত'), 'fl-tag-green'],
  rejected: [tx('প্রত্যাখ্যাত'), 'fl-tag-red'],
}
// reasons that read as their own kind of transfer get their own colour, as in the design
const REASON_TONE: Record<string, string> = { inheritance: 'll-green', gift: 'll-gold', exchange: 'll-orange', court: 'll-gray' }

function Person({ p, photo }: { p: Party; photo: string | null }) {
  return (
    <span className="ll-owner bg-who">
      {photo ? <ProtectedImage url={photo} size={30} shape="square" /> : <span className="ml-initials ll-initials">{initials(nameOf(p))}</span>}
      <Link to={`/farmers/${p.id}`} className="fl-name">
        {nameOf(p)}
      </Link>
    </span>
  )
}

/** Every land transfer — waiting, approved, rejected and drafts — with search, filters and exports. */
export default function LandTransferPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const wide = Grid.useBreakpoint().lg
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['land-transfers', 'list', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-transfers', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-transfers', 'summary'], queryFn: async () => (await api.get<Summary>('/land-transfers-summary')).data })
  const tMeta = useQuery({ queryKey: ['land-transfer-meta'], queryFn: async () => (await api.get<{ types: Record<string, string>; reasons: Record<string, string> }>('/land-transfers/meta')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const places = useQuery({ queryKey: ['mouzas', 'summary'], queryFn: async () => (await api.get<{ districts: Place[]; upazilas: Place[] }>('/mouzas-summary')).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange({})
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const exportCsv = () => downloadExport('/land-transfers', { ...filters, export: 'csv' }, 'land-transfers.csv').catch((e) => message.error(errorMessage(e)))
  const upazilaOptions = (places.data?.upazilas ?? []).filter((u) => !draft.district_id || u.district_id === draft.district_id)
  const all = [{ value: '', label: tx('সকল') }]
  const editable = (r: Row) => can('land.edit') && (r.status === 'draft' || r.status === 'rejected')

  const cards = [
    { key: 'total', label: tx('মোট হস্তান্তর রেকর্ড'), value: s?.total, icon: '', glyph: <SwapOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'approved', label: tx('সম্পন্ন হস্তান্তর'), value: s?.approved, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'approved' }) },
    { key: 'pending', label: tx('অনুমোদনের অপেক্ষায়'), value: s?.pending, icon: '', solid: <ClockCircleOutlined />, color: '#f5a524', tint: '#fdefd6', onClick: () => show({ status: 'pending' }) },
    { key: 'rejected', label: tx('প্রত্যাখ্যাত হস্তান্তর'), value: s?.rejected, icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'rejected' }) },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'code', title: tx('জমির নং'), width: 90, render: (_, r) => <Link to={`/lands/${r.land_id}`} className="fl-link">{r.land?.land_code}</Link> },
    { key: 'mouza', title: tx('মৌজা'), render: (_, r) => r.land?.mouza?.name_bn ?? '—' },
    { key: 'dag', title: tx('দাগ নং'), render: (_, r) => digits(r.land?.dag_no ?? '') },
    { key: 'from', title: tx('বর্তমান মালিক'), render: (_, r) => <Person p={r.from_farmer} photo={r.from_photo_url} /> },
    { key: 'to', title: tx('নতুন মালিক'), render: (_, r) => <Person p={r.to_farmer} photo={r.to_photo_url} /> },
    { key: 'date', title: tx('হস্তান্তরের তারিখ'), dataIndex: 'transfer_date', render: fmtDate },
    {
      key: 'type',
      title: tx('হস্তান্তরের ধরন'),
      render: (_, r) =>
        REASON_TONE[r.reason] ? (
          <Tag className={`fl-tag ${REASON_TONE[r.reason]}`}>{tMeta.data?.reasons[r.reason]}</Tag>
        ) : (
          <Tag className={`fl-tag ${r.type === 'full' ? 'll-blue' : 'll-purple'}`}>
            {tMeta.data?.types[r.type]}
            {r.type === 'partial' && ` ${digits(Number(r.share_percent))}%`}
          </Tag>
        ),
    },
    { key: 'reason', title: tx('কারণ'), dataIndex: 'reason', render: (v: string) => tMeta.data?.reasons[v] ?? v },
    { key: 'amount', title: tx('টাকা (৳)'), dataIndex: 'amount', render: (v: number | null) => (v == null ? '—' : n0(Number(v))) },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (st: Row['status']) => <Tag className={`fl-tag ${TRANSFER_STATUS[st][1]}`}>{TRANSFER_STATUS[st][0]}</Tag> },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 124,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/lands/transfers/${r.id}`)} />
          <Button className="fl-act pl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!editable(r)} onClick={() => navigate(`/lands/transfers/${r.id}`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'land', label: tx('জমির প্রোফাইল'), onClick: () => navigate(`/lands/${r.land_id}`) },
                ...(r.approval_request_id ? [{ key: 'approval', label: tx('অনুমোদন দেখুন'), onClick: () => navigate(`/approvals/${r.approval_request_id}`) }] : []),
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
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('জমি হস্তান্তরের তালিকা')}
      subtitle={tx('সব জমি হস্তান্তরের রেকর্ড দেখুন ও পরিচালনা করুন।')}
      actions={
        can('land.edit') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/lands/transfers/new')}>
            {tx('নতুন জমি হস্তান্তর')}
          </Button>
        )
      }
      cards={cards}
      filterClass="ll-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={380}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('জমির নং, মালিক বা নতুন মালিকের নাম দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => set({ search: e.target.value || undefined })}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('মৌজা')}>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.mouza_id ?? ''} options={[...all, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]} onChange={(v) => set({ mouza_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('উপজেলা')}>
            <Select value={draft.upazila_id ?? ''} options={[...all, ...upazilaOptions.map((u) => ({ value: u.id, label: u.name_bn }))]} onChange={(v) => set({ upazila_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('জেলা')}>
            <Select value={draft.district_id ?? ''} options={[...all, ...(places.data?.districts ?? []).map((d) => ({ value: d.id, label: d.name_bn }))]} onChange={(v) => set({ district_id: v === '' ? undefined : Number(v), upazila_id: undefined })} />
          </Field>
          <span className="ll-break" />
          <Field label={tx('হস্তান্তরের ধরন')}>
            <Select value={draft.type ?? ''} options={[...all, ...Object.entries(tMeta.data?.types ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ type: v || undefined })} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(TRANSFER_STATUS).map(([value, [label]]) => ({ value, label }))]} onChange={(v) => set({ status: v || undefined })} />
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
      tableTitle={tx('জমি হস্তান্তরের তালিকা ({{p0}})', { p0: n0(total) })}
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
        className="fl-table ml-table pl-table ll-table bg-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('এখনো কোনো হস্তান্তর হয়নি') }}
      />
    </ListFrame>
  )
}
