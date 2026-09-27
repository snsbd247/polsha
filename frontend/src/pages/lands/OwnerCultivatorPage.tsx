import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

type Party = { farmer_id: number; name_bn: string; name_en?: string | null; photo_url?: string | null }
type Row = LandRow & { owners: (LandRow['owners'][number] & Party)[]; cultivation: (NonNullable<LandRow['cultivation']> & Party) | null }
type Place = { id: number; name_bn: string; district_id?: number }
type Summary = { lands: number; owners: number; cultivators: number; borga: number }
type Filters = { search?: string; mouza_id?: number; upazila_id?: number; district_id?: number; land_type_id?: number; ownership?: string; status?: string; cultivation?: string }

const TYPE_TONES = ['ll-green', 'll-blue', 'll-gold', 'll-purple', 'll-orange', 'll-gray']
const STATUS_TONE: Record<string, string> = { cultivated: 'fl-tag-green', fallow: 'ml-tag-gray', disputed: 'fl-tag-red', inactive: 'fl-tag-red' }
const CULT_TONE: Record<string, string> = { own: 'll-blue', borga: 'll-purple', lease: 'll-orange' }

function Person({ p, self }: { p: Party; self?: boolean }) {
  return (
    <span className="ll-owner">
      {p.photo_url ? <ProtectedImage url={p.photo_url} size={30} shape="square" /> : <span className="ml-initials ll-initials">{initials(nameOf(p))}</span>}
      {self ? tx('নিজে') : <Link to={`/farmers/${p.farmer_id}`} className="fl-name">{nameOf(p)}</Link>}
    </span>
  )
}

/** Every plot with its current owner(s) and cultivator. */
export default function OwnerCultivatorPage() {
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
    queryKey: ['lands', 'parties', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/lands', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['lands', 'summary'], queryFn: async () => (await api.get<Summary>('/lands/summary')).data })
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
  const exportCsv = () => downloadExport('/lands/export', { ...filters }, 'owners-cultivators.csv').catch((e) => message.error(errorMessage(e)))
  const print = () => exportReport('land_cultivators', { mouza_id: filters.mouza_id, q: filters.search }, 'print', society).catch((e) => message.error(errorMessage(e)))
  const typeTone = (name: string | null) => {
    const i = meta?.land_types.findIndex((t) => t.name_bn === name) ?? -1
    return i < 0 ? 'll-gray' : TYPE_TONES[i % TYPE_TONES.length]
  }
  const upazilaOptions = (places.data?.upazilas ?? []).filter((u) => !draft.district_id || u.district_id === draft.district_id)
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'lands', label: tx('মোট জমির রেকর্ড'), value: s?.lands, icon: 'users', color: '#2563eb', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'owners', label: tx('মোট মালিক'), value: s?.owners, icon: 'users', color: '#1f9d55', tint: '#e3f5ea' },
    { key: 'cultivators', label: tx('মোট চাষি'), value: s?.cultivators, icon: 'users', color: '#f08c00', tint: '#fdf0dc' },
    { key: 'borga', label: tx('বর্গা / লিজ'), value: s?.borga, icon: 'userClock', color: '#6d4ae6', tint: '#ece7fc', onClick: () => show({ cultivation: 'borga' }) },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'code', title: tx('জমির নং'), dataIndex: 'land_code', width: 92, render: (v, l) => <Link to={`/lands/${l.id}`} className="fl-link">{v}</Link> },
    { key: 'mouza', title: tx('মৌজা'), dataIndex: 'mouza', render: (v) => v || '—' },
    { key: 'dag', title: tx('দাগ নং'), dataIndex: 'dag_no', render: (v) => digits(v) },
    {
      key: 'owner',
      title: tx('মালিকের তথ্য'),
      render: (_, l) =>
        l.owners[0] ? (
          <span className="ll-owner">
            <Person p={l.owners[0]} />
            {l.owners.length > 1 && (
              <Tooltip title={l.owners.slice(1).map((x) => `${nameOf(x)} (${digits(x.share_percent)}%)`).join(', ')}>
                <Tag className="fl-tag ml-tag-gray">+{digits(l.owners.length - 1)}</Tag>
              </Tooltip>
            )}
          </span>
        ) : (
          <span className="hs-muted">{tx('মালিক নেই')}</span>
        ),
    },
    {
      key: 'cultivator',
      title: tx('বর্তমান চাষি'),
      render: (_, l) => {
        const c = l.cultivation
        if (!c) return <span className="hs-muted">—</span>
        return <Person p={c} self={c.type === 'own' && l.owners.some((o) => o.farmer_id === c.farmer_id)} />
      },
    },
    {
      key: 'ctype',
      title: tx('চাষের ধরন'),
      render: (_, l) => (l.cultivation ? <Tag className={`fl-tag ${CULT_TONE[l.cultivation.type] ?? 'll-gray'}`}>{meta?.cultivation_types[l.cultivation.type]}</Tag> : '—'),
    },
    { key: 'type', title: tx('জমির ধরন'), dataIndex: 'land_type', render: (v) => (v ? <Tag className={`fl-tag ll-type ${typeTone(v)}`}>{v}</Tag> : '—') },
    { key: 'area', title: tx('পরিমাণ (একর)'), dataIndex: 'area_decimal', render: (v) => acres(v) },
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
                { key: 'owners', label: tx('মালিকানা হস্তান্তর'), disabled: !can('land.edit'), onClick: () => navigate(`/lands/${l.id}?tab=ownership`) },
                { key: 'cult', label: tx('চাষি পরিবর্তন'), disabled: !can('land.edit'), onClick: () => navigate(`/lands/${l.id}?tab=cultivation`) },
                { key: 'history', label: tx('জমির ইতিহাস'), onClick: () => navigate(`/lands/${l.id}?tab=history`) },
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
      title={tx('মালিক ও চাষি')}
      subtitle={tx('জমির মালিক ও বর্তমান চাষিদের দেখুন ও পরিচালনা করুন। খোঁজা, ফিল্টার, বিস্তারিত দেখা এবং মালিকানা বা চাষের তথ্য হালনাগাদ করা যাবে।')}
      actions={
        <>
          {can('land.edit') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/lands/lookup')}>
              {tx('মালিক / চাষি যোগ করুন')}
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
                { key: 'owners', label: tx('মালিক রিপোর্ট'), onClick: () => exportReport('land_owners', { mouza_id: filters.mouza_id, q: filters.search }, 'xlsx', society).catch((e) => message.error(errorMessage(e))) },
                { key: 'cults', label: tx('চাষি রিপোর্ট'), onClick: () => exportReport('land_cultivators', { mouza_id: filters.mouza_id, q: filters.search }, 'xlsx', society).catch((e) => message.error(errorMessage(e))) },
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
          <Field grow={380}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('জমির নং, মালিক বা চাষির নাম, NID, মোবাইল দিয়ে খুঁজুন...')}
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
          <Field label={tx('মালিকানার ধরন')}>
            <Select value={draft.ownership ?? ''} options={[...all, { value: 'single', label: tx('একক') }, { value: 'joint', label: tx('যৌথ') }]} onChange={(v) => set({ ownership: v || undefined })} />
          </Field>
          <Field label={tx('চাষের অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
          <Field label={tx('বর্গা / লিজ')}>
            <Select
              value={draft.cultivation ?? ''}
              options={[...all, ...Object.entries(meta?.cultivation_types ?? {}).map(([value, label]) => ({ value, label })), { value: 'none', label: tx('চাষি নেই') }]}
              onChange={(v) => set({ cultivation: v || undefined })}
            />
          </Field>
          <Field label={tx('জমির ধরন')}>
            <Select value={draft.land_type_id ?? ''} options={[...all, ...(meta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => set({ land_type_id: v === '' ? undefined : Number(v) })} />
          </Field>
        </>
      }
      onSearch={() => show(draft)}
      onReset={() => show({})}
      tableTitle={tx('মালিক ও চাষির তালিকা ({{p0}})', { p0: n0(total) })}
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
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
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
        scroll={{ x: 1300 }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('কোনো তথ্য নেই') }}
      />
    </ListFrame>
  )
}
