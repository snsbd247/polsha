import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EyeFilled, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { useLandMeta } from '../../lib/land'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { acres, ExportMenu, Field, initials, n0 } from './ListFrame'

type Person = { id: number; farmer_code: string; name_bn: string; name_en: string | null; mobile: string | null; photo_url: string | null; member_no: number | null }
type Row = {
  id: number
  land_id: number
  land_code: string
  dag_no: string
  khatian_no: string
  area_decimal: number
  mouza: string | null
  type: 'borga' | 'lease'
  terms: string | null
  remarks: string | null
  start_date: string
  end_date: string | null
  cultivator: Person | null
  owners: { id: number; name_bn: string }[]
}
type Summary = { borga: number; lease: number; area_decimal: number; ended_this_year: number }
type Filters = { search?: string; mouza_id?: number; type?: string; status?: string; from?: string; to?: string }

/** How long an arrangement has run, in years and months. */
function duration(start: string, end: string | null) {
  const months = dayjs(end ?? undefined).diff(dayjs(start), 'month')
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y ? tx('{{p0}} বছর', { p0: digits(y) }) : '', m || !y ? tx('{{p0}} মাস', { p0: digits(m) }) : ''].filter(Boolean).join(' ')
}

/** Borga (sharecropping) and lease arrangements, current and past. */
export default function BorgaPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data: meta } = useLandMeta()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({ status: 'current' })
  const [filters, setFilters] = useState<Filters>({ status: 'current' })
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['land-cultivations', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-register/cultivations', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-cultivations', 'summary'], queryFn: async () => (await api.get<Summary>('/land-register/cultivations/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') })
    setPage(1)
  }

  const cards = [
    { key: 'borga', label: tx('চলমান বর্গা'), value: s?.borga, icon: 'sprout', color: '#f08c00', tint: '#fdf0dc', onClick: () => show({ type: 'borga', status: 'current' }) },
    { key: 'lease', label: tx('চলমান লিজ'), value: s?.lease, icon: 'file', color: '#2563eb', tint: '#e4edfd', onClick: () => show({ type: 'lease', status: 'current' }) },
    { key: 'area', label: tx('বর্গা/লিজের জমি'), value: s ? acres(s.area_decimal) : undefined, unit: tx('একর'), icon: 'layers', color: '#1f9d55', tint: '#e3f5ea' },
    { key: 'ended', label: tx('এ বছর শেষ হয়েছে'), value: s?.ended_this_year, icon: 'calendar', color: '#e0383e', tint: '#fde6e7', onClick: () => show({ status: 'ended', from: undefined }) },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('জমির নং'), dataIndex: 'land_code', width: 100, render: (v, r) => <Link to={`/lands/${r.land_id}`} className="fl-link">{v}</Link> },
    { title: tx('মৌজা'), dataIndex: 'mouza', render: (v) => v || '—' },
    { title: tx('দাগ নং'), dataIndex: 'dag_no', render: (v) => digits(v) },
    { title: tx('পরিমাণ (একর)'), dataIndex: 'area_decimal', render: (v) => acres(v) },
    { title: tx('মালিক'), render: (_, r) => r.owners.map((o) => o.name_bn).join(', ') || '—' },
    {
      title: tx('চাষি'),
      render: (_, r) =>
        r.cultivator ? (
          <span className="bg-person">
            {r.cultivator.photo_url ? <ProtectedImage url={r.cultivator.photo_url} size={30} shape="square" /> : <span className="ml-initials bg-initials">{initials(nameOf(r.cultivator))}</span>}
            <span>
              <Link to={`/farmers/${r.cultivator.id}`} className="fl-name">{nameOf(r.cultivator)}</Link>
              <small>{digits(r.cultivator.mobile ?? '') || r.cultivator.farmer_code}</small>
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    { title: tx('ধরন'), dataIndex: 'type', render: (t) => <Tag className={`fl-tag ${t === 'borga' ? 'fl-tag-orange' : 'lp-tag-blue bg-blue'}`}>{meta?.cultivation_types[t] ?? t}</Tag> },
    { title: tx('শর্ত'), dataIndex: 'terms', render: (v) => (v ? <Tooltip title={v}><span className="bg-terms">{v}</span></Tooltip> : '—') },
    { title: tx('শুরু'), dataIndex: 'start_date', render: fmtDate },
    { title: tx('কতদিন চলছে'), render: (_, r) => duration(r.start_date, r.end_date) },
    { title: tx('অবস্থা'), render: (_, r) => (r.end_date ? <Tooltip title={fmtDate(r.end_date)}><Tag className="fl-tag ml-tag-gray">{tx('শেষ')}</Tag></Tooltip> : <Tag className="fl-tag fl-tag-green">{tx('চলমান')}</Tag>) },
    {
      title: tx('অ্যাকশন'),
      width: 80,
      align: 'center',
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/lands/${r.land_id}?tab=borga`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('বর্গা / লিজ চাষ')}
      subtitle={tx('অন্যের জমিতে বর্গা বা লিজে চাষের সব চুক্তি — চলমান ও শেষ হওয়া।')}
      actions={
        <>
          {can('land.edit') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/lands/lookup')}>
              {tx('নতুন বর্গা দিন')}
            </Button>
          )}
          <ExportMenu reports={[{ key: 'borga', label: tx('বর্গা/লিজ চাষ রিপোর্ট') }]} filters={{ q: filters.search, mouza_id: filters.mouza_id }} />
        </>
      }
      cards={cards}
      filters={
        <>
          <Field grow={260}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('চাষির নাম, কৃষক নং, জমির নং বা দাগ...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('ধরন')}>
            <Select
              value={draft.type ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'borga', label: meta?.cultivation_types.borga ?? tx('বর্গা') },
                { value: 'lease', label: meta?.cultivation_types.lease ?? tx('লিজ') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))}
            />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.status ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'current', label: tx('চলমান') },
                { value: 'ended', label: tx('শেষ') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </Field>
          <Field label={tx('মৌজা')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.mouza_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, mouza_id: v === '' ? undefined : Number(v) }))}
            />
          </Field>
          <Field label={tx('শুরুর তারিখের পরিসর')} grow={200}>
            <DatePicker.RangePicker format="DD-MM-YYYY" value={range} onChange={(r) => setRange(r as [Dayjs | null, Dayjs | null] | null)} placeholder={[tx('শুরু'), tx('শেষ')]} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => {
        setRange(null)
        show({})
      }}
      tableTitle={tx('বর্গা / লিজ চুক্তি ({{p0}})', { p0: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Row>
        className="fl-table ml-table pl-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 1250 }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো বর্গা বা লিজ চুক্তি নেই') }}
      />
    </ListFrame>
  )
}
