import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, Dropdown, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, DownloadOutlined, DownOutlined, EditOutlined, EyeFilled, MoreOutlined, PlusOutlined, PrinterOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { useLandMeta } from '../../lib/land'
import { usePublicSettings } from '../../lib/settings'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { acres, exportReport, Field, initials, n0 } from './ListFrame'
import './land-list.css'

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
  share_percent: number | null
  start_date: string
  contract_end: string | null
  end_date: string | null
  status: 'active' | 'expired' | 'ended'
  cultivator: Person | null
  owners: (Person & { share_percent: number })[]
}
type Named = { id: number; name_bn: string; name_en: string | null }
type Place = { id: number; name_bn: string; district_id?: number }
type Summary = { records: number; area_decimal: number; farmers: number; active: number; expired: number; owners: Named[]; cultivators: Named[] }
type Filters = { search?: string; mouza_id?: number; upazila_id?: number; district_id?: number; owner_id?: number; cultivator_id?: number; land_type_id?: number; status?: string }

const STATUS: Record<Row['status'], [string, string]> = {
  active: [tx('সক্রিয়'), 'fl-tag-green'],
  expired: [tx('মেয়াদোত্তীর্ণ'), 'fl-tag-red'],
  ended: [tx('শেষ'), 'ml-tag-gray'],
}

function Who({ p }: { p: Person }) {
  return (
    <span className="ll-owner bg-who">
      {p.photo_url ? <ProtectedImage url={p.photo_url} size={30} shape="square" /> : <span className="ml-initials ll-initials">{initials(nameOf(p))}</span>}
      <Link to={`/farmers/${p.id}`} className="fl-name">
        {nameOf(p)}
      </Link>
    </span>
  )
}

/** Borga (sharecropping) and lease arrangements with their share, dates and contract status. */
export default function BorgaPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const { data: meta } = useLandMeta()
  const { data: settings } = usePublicSettings()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['land-cultivations', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-register/cultivations', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-cultivations', 'summary'], queryFn: async () => (await api.get<Summary>('/land-register/cultivations/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const places = useQuery({ queryKey: ['mouzas', 'summary'], queryFn: async () => (await api.get<{ districts: Place[]; upazilas: Place[] }>('/mouzas-summary')).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }
  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en })
  const run = (format: 'xlsx' | 'csv' | 'print') => exportReport('borga', { mouza_id: filters.mouza_id, q: filters.search }, format, society).catch((e) => message.error(errorMessage(e)))
  const upazilaOptions = (places.data?.upazilas ?? []).filter((u) => !draft.district_id || u.district_id === draft.district_id)
  const all = [{ value: '', label: tx('সকল') }]
  const people = (list?: Named[]) => [...all, ...(list ?? []).map((p) => ({ value: p.id, label: nameOf(p) }))]

  const cards = [
    { key: 'records', label: tx('মোট বর্গা রেকর্ড'), value: s?.records, icon: 'share', color: '#6d4ae6', tint: '#ece7fc', onClick: () => show({}) },
    { key: 'area', label: tx('মোট বর্গা জমি'), value: s ? acres(s.area_decimal) : undefined, unit: tx('একর'), icon: 'sprout', color: '#1f9d55', tint: '#e3f5ea' },
    { key: 'farmers', label: tx('মোট বর্গাচাষি'), value: s?.farmers, icon: 'users', color: '#2563eb', tint: '#e4edfd' },
    { key: 'active', label: tx('সক্রিয় বর্গা চুক্তি'), value: s?.active, icon: 'file', color: '#f08c00', tint: '#fdf0dc', onClick: () => show({ status: 'active' }) },
  ]

  const group = (key: string, title: string, children: ColumnsType<Row>) => ({ key, title, className: 'bg-group', children })
  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'code', title: tx('জমির নং'), dataIndex: 'land_code', width: 90, render: (v, r) => <Link to={`/lands/${r.land_id}`} className="fl-link">{v}</Link> },
    { key: 'mouza', title: tx('মৌজা'), dataIndex: 'mouza', render: (v) => v || '—' },
    { key: 'dag', title: tx('দাগ নং'), dataIndex: 'dag_no', render: (v) => digits(v) },
    { key: 'khatian', title: tx('খতিয়ান নং'), dataIndex: 'khatian_no', render: (v) => digits(v) },
    {
      ...group('owner', tx('মালিকের তথ্য'), [
        {
          key: 'owner_name',
          title: tx('নাম'),
          render: (_, r) =>
            r.owners[0] ? (
              <span className="ll-owner">
                <Who p={r.owners[0]} />
                {r.owners.length > 1 && (
                  <Tooltip title={r.owners.slice(1).map((o) => nameOf(o)).join(', ')}>
                    <Tag className="fl-tag ml-tag-gray">+{digits(r.owners.length - 1)}</Tag>
                  </Tooltip>
                )}
              </span>
            ) : (
              '—'
            ),
        },
        { key: 'owner_no', title: tx('সদস্য নং'), render: (_, r) => (r.owners[0]?.member_no ? digits(r.owners[0].member_no) : '—') },
      ]),
    },
    {
      ...group('cultivator', tx('চাষির তথ্য'), [
        { key: 'cult_name', title: tx('নাম'), render: (_, r) => (r.cultivator ? <Who p={r.cultivator} /> : '—') },
        { key: 'cult_no', title: tx('সদস্য নং'), render: (_, r) => (r.cultivator?.member_no ? digits(r.cultivator.member_no) : '—') },
      ]),
    },
    {
      key: 'share',
      title: tx('অংশ %'),
      dataIndex: 'share_percent',
      render: (v, r) => (
        <Tooltip title={[meta?.cultivation_types[r.type], r.terms].filter(Boolean).join(' · ')}>
          {v != null ? `${digits(v)}%` : '—'}
        </Tooltip>
      ),
    },
    { key: 'area', title: tx('পরিমাণ (একর)'), dataIndex: 'area_decimal', render: (v) => acres(v) },
    { key: 'start', title: tx('শুরুর তারিখ'), dataIndex: 'start_date', render: fmtDate },
    { key: 'end', title: tx('শেষের তারিখ'), render: (_, r) => (r.end_date ? fmtDate(r.end_date) : r.contract_end ? fmtDate(r.contract_end) : '—') },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (st: Row['status']) => <Tag className={`fl-tag ${STATUS[st][1]}`}>{STATUS[st][0]}</Tag> },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/lands/${r.land_id}?tab=borga`)} />
          <Button className="fl-act pl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!can('land.edit')} onClick={() => navigate(`/lands/${r.land_id}?tab=cultivation`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'land', label: tx('জমির প্রোফাইল'), onClick: () => navigate(`/lands/${r.land_id}`) },
                ...(r.cultivator ? [{ key: 'farmer', label: tx('চাষির প্রোফাইল'), onClick: () => navigate(`/farmers/${r.cultivator!.id}`) }] : []),
                { key: 'history', label: tx('জমির ইতিহাস'), onClick: () => navigate(`/lands/${r.land_id}?tab=history`) },
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
      title={tx('বর্গা / লিজ চাষ')}
      subtitle={tx('বর্গা চাষের রেকর্ড পরিচালনা করুন। বর্গায় দেওয়া জমি দেখুন, যোগ করুন, হালনাগাদ করুন ও নজরে রাখুন।')}
      actions={
        <>
          {can('land.edit') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/lands/lookup')}>
              {tx('বর্গা রেকর্ড যোগ করুন')}
            </Button>
          )}
          {can('import.create') && (
            <Button icon={<UploadOutlined />} onClick={() => navigate('/imports?type=lands')}>
              {tx('ইমপোর্ট')}
            </Button>
          )}
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'x', label: 'Excel (.xlsx)', onClick: () => run('xlsx') },
                { key: 'c', label: 'CSV', onClick: () => run('csv') },
                { key: 'p', label: tx('প্রিন্ট / PDF'), onClick: () => run('print') },
              ],
            }}
          >
            <Button icon={<DownloadOutlined />}>
              {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
            </Button>
          </Dropdown>
        </>
      }
      cards={cards}
      filterClass="ll-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={340}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('জমির নং, মালিক বা চাষির নাম, দাগ নং দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => set({ search: e.target.value || undefined })}
              onPressEnter={() => show(draft)}
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
          <Field label={tx('মালিকের নাম')}>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.owner_id ?? ''} options={people(s?.owners)} onChange={(v) => set({ owner_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('চাষির নাম')}>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.cultivator_id ?? ''} options={people(s?.cultivators)} onChange={(v) => set({ cultivator_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('জমির ধরন')}>
            <Select value={draft.land_type_id ?? ''} options={[...all, ...(meta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => set({ land_type_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('চুক্তির অবস্থা')}>
            <Select
              value={draft.status ?? ''}
              options={[...all, { value: 'active', label: STATUS.active[0] }, { value: 'expired', label: STATUS.expired[0] }, { value: 'ended', label: STATUS.ended[0] }]}
              onChange={(v) => set({ status: v || undefined })}
            />
          </Field>
        </>
      }
      onSearch={() => show(draft)}
      onReset={() => show({})}
      tableTitle={tx('বর্গা / লিজ তালিকা ({{p0}})', { p0: n0(total) })}
      tableTools={
        <>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            popupRender={() => (
              <div className="fl-colmenu">
                {hideable.map((c) => (
                  <Checkbox key={c.key} checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                    {c.title as string}
                  </Checkbox>
                ))}
              </div>
            )}
          >
            <Button icon={<AppstoreFilled />} className="ml-columns pl-columns">
              {tx('কলাম')} <DownOutlined className="fl-caret" />
            </Button>
          </Dropdown>
          <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => run('print')}>
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
        scroll={{ x: 1400 }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('কোনো বর্গা বা লিজ চুক্তি নেই') }}
      />
    </ListFrame>
  )
}
