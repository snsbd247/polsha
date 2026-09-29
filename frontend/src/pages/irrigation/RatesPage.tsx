import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditFilled, EyeFilled, PlusOutlined, PrinterOutlined, SearchOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { RATE_STATE_TONE, useInvoiceMeta, type RatePage, type RateRow } from '../../lib/irrigation'
import { useLandMeta } from '../../lib/land'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './rates.css'

type Filters = { search?: string; season_id?: number; irrigation_type_id?: number; land_type_id?: number; state?: string }

/** Every irrigation rate — per season, source and land type — with its period and state. */
export default function RatesPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [sp] = useSearchParams()
  const init: Filters = { season_id: Number(sp.get('season_id')) || undefined }
  const [draft, setDraft] = useState<Filters>(init)
  const [filters, setFilters] = useState<Filters>(init)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['irrigation-rates', 'all', params],
    queryFn: async () => (await api.get<RatePage>('/irrigation-rates/all', { params })).data,
    placeholderData: keepPreviousData,
  })
  const s = data?.summary
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }
  const propose = (r?: RateRow) =>
    navigate(r ? `/irrigation/rates/new?season_id=${r.season_id}&irrigation_type_id=${r.irrigation_type_id}${r.land_type_id ? `&land_type_id=${r.land_type_id}` : ''}` : '/irrigation/rates/new')

  const cards = [
    { key: 'total', label: tx('মোট রেট'), value: s?.total, icon: 'layers', color: '#8b3fe0', tint: '#efe4fc', onClick: () => show({}) },
    { key: 'active', label: tx('সক্রিয় রেট'), value: s?.active, icon: 'sprout', color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ state: 'active' }) },
    { key: 'inactive', label: tx('নিষ্ক্রিয় রেট'), value: s?.inactive, icon: 'bars', color: '#f08c00', tint: '#fdefd6', onClick: () => show({ state: 'expired,rejected' }) },
    { key: 'sources', label: tx('সেচের উৎস'), value: s?.sources, icon: 'drop', color: '#1769e0', tint: '#e4edfd', onClick: () => navigate('/settings/irrigation-types') },
  ]

  const columns: ColumnsType<RateRow> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('মৌসুম'),
      dataIndex: 'season',
      render: (v, r) => (
        <button type="button" className="lt-name" onClick={() => navigate(`/irrigation/seasons/${r.season_id}`)}>
          {v}
        </button>
      ),
    },
    { title: tx('সেচের উৎস'), render: (_, r) => `${r.irrigation_type ?? '—'}${r.irrigation_code ? ` (${r.irrigation_code})` : ''}` },
    { title: tx('জমির ধরন'), dataIndex: 'land_type' },
    { title: tx('রেট (৳/শতক)'), dataIndex: 'rate', align: 'right', render: money },
    { title: tx('মাপের একক'), render: () => tx('প্রতি শতক') },
    { title: tx('কার্যকর শুরু'), dataIndex: 'effective_from', render: fmtDate },
    { title: tx('কার্যকর শেষ'), dataIndex: 'effective_to', render: (v) => (v ? fmtDate(v) : '—') },
    { title: tx('অবস্থা'), dataIndex: 'state', align: 'center', render: (v: string) => <Tag className={`fl-tag rt-state ${RATE_STATE_TONE[v] ?? 'll-gray'}`}>{data?.states[v] ?? v}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      render: (_, r) => (
        <div className="mg-actions lt-actions">
          {r.approval_request_id && (
            <Tooltip title={tx('অনুমোদন দেখুন')}>
              <Button type="text" className="mg-view" icon={<EyeFilled />} onClick={() => navigate(`/approvals/${r.approval_request_id}`)} />
            </Tooltip>
          )}
          {can('irrigation.edit') && (
            <Tooltip title={tx('নতুন রেট প্রস্তাব')}>
              <Button type="text" className="mg-view" icon={<EditFilled />} onClick={() => propose(r)} />
            </Tooltip>
          )}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tx('সেচের রেটের তালিকা')}
      subtitle={tx('সেচের উৎস, মৌসুম ও জমির ধরন অনুযায়ী সেচের রেট দেখুন ও পরিচালনা করুন।')}
      actions={
        can('irrigation.edit') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => propose()}>
            {tx('নতুন সেচের রেট')}
          </Button>
        )
      }
      cards={cards}
      filterClass="rt-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={300}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('উৎস, মৌসুম বা জমির ধরন দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={() => show(draft)} />
          </Field>
          <Field label={tx('মৌসুম')}>
            <Select value={draft.season_id ?? ''} options={[{ value: '', label: tx('সব মৌসুম') }, ...(meta?.seasons ?? []).map((x) => ({ value: x.id, label: x.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, season_id: v === '' ? undefined : Number(v) }))} />
          </Field>
          <Field label={tx('সেচের উৎস')}>
            <Select value={draft.irrigation_type_id ?? ''} options={[{ value: '', label: tx('সব উৎস') }, ...(meta?.irrigation_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, irrigation_type_id: v === '' ? undefined : Number(v) }))} />
          </Field>
          <Field label={tx('জমির ধরন')}>
            <Select value={draft.land_type_id ?? ''} options={[{ value: '', label: tx('সব ধরনের জমি') }, ...(landMeta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, land_type_id: v === '' ? undefined : Number(v) }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.state ?? ''} options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.states ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft((d) => ({ ...d, state: v || undefined }))} />
          </Field>
        </>
      }
      onSearch={() => show(draft)}
      onReset={() => show({})}
      tableTitle={tx('সেচের রেট ({{p0}})', { p0: n0(total) })}
      tableTools={
        <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => window.print()}>
          {tx('প্রিন্ট')}
        </Button>
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
      <Table<RateRow>
        className="fl-table ml-table pl-table rt-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        locale={{ emptyText: tx('কোনো রেট পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
