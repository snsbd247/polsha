import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, Dropdown, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, DownloadOutlined, DownOutlined, EditOutlined, EyeFilled, MoreOutlined, PlusOutlined, PrinterOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { useLandMeta, type LandRow } from '../../lib/land'
import { downloadExport } from '../../lib/phase2'
import { usePublicSettings } from '../../lib/settings'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { acres, exportReport, Field, initials, n0 } from './ListFrame'
import './land-list.css'

type Row = LandRow & { owners: (LandRow['owners'][number] & { name_en?: string | null; photo_url?: string | null })[] }
type Place = { id: number; name_bn: string; district_id?: number }
type Summary = { lands: number; owners: number; area_decimal: number; mouzas: number }
type Filters = {
  search?: string
  mouza_id?: number
  upazila_id?: number
  district_id?: number
  land_type_id?: number
  ownership?: string
  status?: string
  cultivation?: string
  area_min?: string
  area_max?: string
}

// land-type tags cycle through the design's colours in the order the types are listed
const TYPE_TONES = ['ll-green', 'll-blue', 'll-gold', 'll-purple', 'll-orange', 'll-gray']
const STATUS_TONE: Record<string, string> = { cultivated: 'fl-tag-green', fallow: 'ml-tag-gray', disputed: 'fl-tag-red', inactive: 'fl-tag-red' }

/** All land records with search, filters, quick actions and exports. */
export default function LandListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const { data: meta } = useLandMeta()
  const { data: settings } = usePublicSettings()
  const [sp] = useSearchParams()
  const urlSearch = sp.get('search') || undefined
  const initial: Filters = {
    search: urlSearch,
    mouza_id: sp.get('mouza_id') ? Number(sp.get('mouza_id')) : undefined,
    land_type_id: sp.get('land_type_id') ? Number(sp.get('land_type_id')) : undefined,
  }
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>(initial)
  const [filters, setFilters] = useState<Filters>(initial)
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  // the top-bar search opens this list with ?search=
  useEffect(() => {
    setDraft((d) => ({ ...d, search: urlSearch }))
    setFilters((f) => ({ ...f, search: urlSearch }))
    setPage(1)
  }, [urlSearch])
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['lands', params],
    queryFn: async () => (await api.get<Paginated<Row> & { total_area: number }>('/lands', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['lands', 'summary'], queryFn: async () => (await api.get<Summary>('/lands/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const places = useQuery({ queryKey: ['mouzas', 'summary'], queryFn: async () => (await api.get<{ districts: Place[]; upazilas: Place[] }>('/mouzas-summary')).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const apply = () => {
    setFilters(draft)
    setPage(1)
  }
  const reset = () => {
    setDraft({})
    setFilters({})
    setPage(1)
  }
  const exportCsv = () => downloadExport('/lands/export', { ...filters }, 'lands.csv').catch((e) => message.error(errorMessage(e)))
  const print = () =>
    exportReport('lands', { mouza_id: filters.mouza_id, land_type_id: filters.land_type_id, status: filters.status }, 'print', nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en })).catch((e) =>
      message.error(errorMessage(e)),
    )

  const typeTone = (name: string | null) => {
    const i = meta?.land_types.findIndex((t) => t.name_bn === name) ?? -1
    return i < 0 ? 'll-gray' : TYPE_TONES[i % TYPE_TONES.length]
  }
  const upazilaOptions = (places.data?.upazilas ?? []).filter((u) => !draft.district_id || u.district_id === draft.district_id)

  const cards = [
    { key: 'lands', label: tx('মোট জমির রেকর্ড'), value: s?.lands, icon: 'sprout', color: '#1f9d55', tint: '#e3f5ea', onClick: reset },
    { key: 'owners', label: tx('মোট মালিক'), value: s?.owners, icon: 'users', color: '#2563eb', tint: '#e4edfd', onClick: () => navigate('/lands/owners') },
    { key: 'area', label: tx('মোট জমির পরিমাণ'), value: s ? acres(s.area_decimal) : undefined, unit: tx('একর'), icon: 'layers', color: '#f08c00', tint: '#fdf0dc' },
    { key: 'mouzas', label: tx('মোট মৌজা'), value: s?.mouzas, icon: 'mapPin', color: '#6d4ae6', tint: '#ece7fc', onClick: () => navigate('/masters/mouzas') },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'code', title: tx('জমির নং'), dataIndex: 'land_code', width: 96, render: (v, l) => <Link to={`/lands/${l.id}`} className="fl-link">{v}</Link> },
    {
      key: 'owner',
      title: tx('মালিকের নাম'),
      render: (_, l) => {
        const o = l.owners[0]
        if (!o) return <span className="hs-muted">{tx('মালিক নেই')}</span>
        return (
          <span className="ll-owner">
            {o.photo_url ? <ProtectedImage url={o.photo_url} size={32} shape="square" /> : <span className="ml-initials ll-initials">{initials(nameOf(o))}</span>}
            <Link to={`/farmers/${o.farmer_id}`} className="fl-name">
              {nameOf(o)}
            </Link>
            {l.owners.length > 1 && (
              <Tooltip title={l.owners.slice(1).map((x) => `${nameOf(x)} (${digits(x.share_percent)}%)`).join(', ')}>
                <Tag className="fl-tag ml-tag-gray">+{digits(l.owners.length - 1)}</Tag>
              </Tooltip>
            )}
          </span>
        )
      },
    },
    { key: 'mouza', title: tx('মৌজা'), dataIndex: 'mouza', render: (v) => v || '—' },
    { key: 'khatian', title: tx('খতিয়ান নং'), dataIndex: 'khatian_no', render: (v, l) => <Tooltip title={meta?.surveys[l.survey]}>{digits(v)}</Tooltip> },
    { key: 'dag', title: tx('দাগ নং'), dataIndex: 'dag_no', render: (v) => digits(v) },
    { key: 'type', title: tx('জমির ধরন'), dataIndex: 'land_type', render: (v) => (v ? <Tag className={`fl-tag ll-type ${typeTone(v)}`}>{v}</Tag> : '—') },
    { key: 'area', title: tx('মোট পরিমাণ (একর)'), dataIndex: 'area_decimal', render: (v) => acres(v) },
    {
      key: 'cultivator',
      title: tx('চাষি'),
      render: (_, l) => {
        const c = l.cultivation
        if (!c) return '—'
        // an owner farming their own plot shows as "Self", as in the design
        if (c.type === 'own' && l.owners.some((o) => o.farmer_id === c.farmer_id)) return tx('নিজে')
        return (
          <Tooltip title={meta?.cultivation_types[c.type]}>
            <Link to={`/farmers/${c.farmer_id}`}>{nameOf(c as never)}</Link>
          </Tooltip>
        )
      },
    },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (st) => <Tag className={`fl-tag ${STATUS_TONE[st] ?? 'ml-tag-gray'}`}>{meta?.statuses[st] ?? st}</Tag> },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      render: (_, l) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/lands/${l.id}`)} />
          <Button className="fl-act pl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!can('land.edit')} onClick={() => navigate(`/lands/${l.id}/edit`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'profile', label: tx('জমির প্রোফাইল'), onClick: () => navigate(`/lands/${l.id}`) },
                { key: 'owners', label: tx('মালিকানার বিবরণ'), onClick: () => navigate(`/lands/${l.id}?tab=ownership`) },
                { key: 'history', label: tx('জমির ইতিহাস'), onClick: () => navigate(`/lands/${l.id}?tab=history`) },
                ...(can('irrigation.create') ? [{ key: 'invoice', label: tx('সেচ ইনভয়েস'), onClick: () => navigate(`/irrigation/invoices/new?land_id=${l.id}`) }] : []),
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
  const all = (label: string) => [{ value: '', label }]

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('জমির তালিকা')}
      subtitle={tx('সব জমির রেকর্ড দেখুন ও পরিচালনা করুন। খোঁজা, ফিল্টার, বিস্তারিত দেখা ও দ্রুত কাজ করা যাবে।')}
      actions={
        <>
          {can('land.create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/lands/new')}>
              {tx('জমি যোগ করুন')}
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
                ...(can('land.export') ? [{ key: 'csv', label: tx('Excel (CSV)'), onClick: exportCsv }] : []),
                { key: 'print', label: tx('প্রিন্ট / PDF'), onClick: print },
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
              placeholder={tx('জমির নং, মালিকের নাম, খতিয়ান নং, দাগ নং...')}
              value={draft.search}
              onChange={(e) => set({ search: e.target.value || undefined })}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('মৌজা')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.mouza_id ?? ''}
              options={[...all(tx('সকল')), ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]}
              onChange={(v) => set({ mouza_id: v === '' ? undefined : Number(v) })}
            />
          </Field>
          <Field label={tx('উপজেলা')}>
            <Select value={draft.upazila_id ?? ''} options={[...all(tx('সকল')), ...upazilaOptions.map((u) => ({ value: u.id, label: u.name_bn }))]} onChange={(v) => set({ upazila_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('জেলা')}>
            <Select
              value={draft.district_id ?? ''}
              options={[...all(tx('সকল')), ...(places.data?.districts ?? []).map((d) => ({ value: d.id, label: d.name_bn }))]}
              onChange={(v) => set({ district_id: v === '' ? undefined : Number(v), upazila_id: undefined })}
            />
          </Field>
          <Field label={tx('জমির ধরন')}>
            <Select value={draft.land_type_id ?? ''} options={[...all(tx('সকল')), ...(meta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => set({ land_type_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <span className="ll-break" />
          <Field label={tx('মালিকানার ধরন')}>
            <Select
              value={draft.ownership ?? ''}
              options={[...all(tx('সকল')), { value: 'single', label: tx('একক') }, { value: 'joint', label: tx('যৌথ') }]}
              onChange={(v) => set({ ownership: v || undefined })}
            />
          </Field>
          <Field label={tx('চাষের অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all(tx('সকল')), ...Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
          <Field label={tx('বর্গা / লিজ')}>
            <Select
              value={draft.cultivation ?? ''}
              options={[...all(tx('সকল')), ...Object.entries(meta?.cultivation_types ?? {}).map(([value, label]) => ({ value, label })), { value: 'none', label: tx('চাষি নেই') }]}
              onChange={(v) => set({ cultivation: v || undefined })}
            />
          </Field>
          <Field label={tx('পরিমাণের পরিসর (একর)')} grow={250}>
            <span className="ll-range">
              <Input placeholder={tx('সর্বনিম্ন')} inputMode="decimal" value={draft.area_min} onChange={(e) => set({ area_min: e.target.value || undefined })} onPressEnter={apply} />
              <span className="ll-dash">–</span>
              <Input placeholder={tx('সর্বোচ্চ সীমা')} inputMode="decimal" value={draft.area_max} onChange={(e) => set({ area_max: e.target.value || undefined })} onPressEnter={apply} />
            </span>
          </Field>
        </>
      }
      onSearch={apply}
      onReset={reset}
      tableTitle={tx('জমির তালিকা ({{p0}})', { p0: n0(total) })}
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
          <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={print}>
            {tx('প্রিন্ট')}
          </Button>
        </>
      }
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি জমির রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Row>
        className="fl-table ml-table pl-table ll-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 1250 }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('কোনো জমি পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
