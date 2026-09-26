import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowRightOutlined, EyeFilled, SearchOutlined, SwapOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { acres, ExportMenu, Field, n0 } from './ListFrame'

type Party = { id: number; name_bn: string; farmer_code: string; share_percent: number }
type Row = { key: string; land_id: number; date: string; land_code: string; dag_no: string; mouza: string | null; area_decimal: number; from: Party[]; to: Party[]; remarks: string | null }
type Summary = { total: number; this_year: number; this_month: number; area_this_year: number }
type Filters = { search?: string; mouza_id?: number; from?: string; to?: string }

const people = (list: Party[]) => (
  <span className="tr-people">
    {list.map((p, i) => (
      <span key={`${p.id}-${i}`}>
        <Link to={`/farmers/${p.id}`}>{p.name_bn}</Link>
        {p.share_percent < 100 && <small> ({digits(p.share_percent)}%)</small>}
      </span>
    ))}
  </span>
)

/** Every change of a plot's owners (sale, inheritance, gift) — who handed over to whom and when. */
export default function LandTransferPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['land-transfers', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-register/transfers', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-transfers', 'summary'], queryFn: async () => (await api.get<Summary>('/land-register/transfers/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const apply = () => {
    setFilters({ ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const year = new Date().getFullYear()

  const cards = [
    { key: 'total', label: tx('মোট হস্তান্তর'), value: s?.total, icon: 'share', color: '#2563eb', tint: '#e4edfd' },
    { key: 'year', label: tx('এ বছরের হস্তান্তর'), value: s?.this_year, icon: 'calendar', color: '#1f9d55', tint: '#e3f5ea', onClick: () => { setRange(null); setFilters({ from: `${year}-01-01` }); setPage(1) } },
    { key: 'month', label: tx('এ মাসের হস্তান্তর'), value: s?.this_month, icon: 'bars', color: '#f08c00', tint: '#fdf0dc' },
    { key: 'area', label: tx('এ বছরে হস্তান্তরিত জমি'), value: s ? acres(s.area_this_year) : undefined, unit: tx('একর'), icon: 'layers', color: '#6d4ae6', tint: '#ece7fc' },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('তারিখ'), dataIndex: 'date', width: 100, render: fmtDate },
    { title: tx('জমির নং'), dataIndex: 'land_code', width: 100, render: (v, r) => <Link to={`/lands/${r.land_id}`} className="fl-link">{v}</Link> },
    { title: tx('মৌজা'), dataIndex: 'mouza', render: (v) => v || '—' },
    { title: tx('দাগ নং'), dataIndex: 'dag_no', render: (v) => digits(v) },
    { title: tx('পরিমাণ (একর)'), dataIndex: 'area_decimal', render: (v) => acres(v) },
    { title: tx('আগের মালিক'), render: (_, r) => people(r.from) },
    { title: '', width: 30, render: () => <ArrowRightOutlined className="tr-arrow" /> },
    { title: tx('নতুন মালিক'), render: (_, r) => people(r.to) },
    {
      title: tx('ধরন'),
      render: (_, r) => {
        const kept = r.to.some((t) => r.from.some((f) => f.id === t.id))
        return kept ? <Tag className="fl-tag fl-tag-gold">{tx('অংশ বদল')}</Tag> : <Tag className="fl-tag fl-tag-green">{tx('পূর্ণ হস্তান্তর')}</Tag>
      },
    },
    { title: tx('মন্তব্য'), dataIndex: 'remarks', render: (v) => v || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 80,
      align: 'center',
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/lands/${r.land_id}?tab=ownership`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('জমি হস্তান্তর')}
      subtitle={tx('জমির মালিকানা বদলের সব রেকর্ড — কে কাকে, কবে, কতটুকু হস্তান্তর করেছেন। নতুন হস্তান্তর জমির প্রোফাইল থেকে করা যায়।')}
      actions={
        <>
          {can('land.edit') && (
            <Button type="primary" icon={<SwapOutlined />} onClick={() => navigate('/lands/lookup')}>
              {tx('নতুন হস্তান্তর')}
            </Button>
          )}
          <ExportMenu
            reports={[{ key: 'land_history', label: tx('জমি হস্তান্তর ও চাষ পরিবর্তন') }]}
            filters={{ mouza_id: filters.mouza_id, from: filters.from ?? `${year}-01-01`, to: filters.to ?? `${year}-12-31` }}
          />
        </>
      }
      cards={cards}
      filters={
        <>
          <Field grow={300}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('জমির নং, দাগ, মালিকের নাম বা কৃষক নং...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
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
          <Field label={tx('হস্তান্তরের তারিখের পরিসর')} grow={220}>
            <DatePicker.RangePicker format="DD-MM-YYYY" value={range} onChange={(r) => setRange(r as [Dayjs | null, Dayjs | null] | null)} placeholder={[tx('শুরু'), tx('শেষ')]} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => {
        setDraft({})
        setRange(null)
        setFilters({})
        setPage(1)
      }}
      tableTitle={tx('হস্তান্তরের তালিকা ({{p0}})', { p0: n0(total) })}
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
        rowKey="key"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 1200 }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('এখনো কোনো হস্তান্তর হয়নি') }}
      />
    </ListFrame>
  )
}
