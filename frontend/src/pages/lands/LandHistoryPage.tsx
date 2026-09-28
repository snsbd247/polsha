import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AppstoreFilled,
  DownOutlined,
  EditOutlined,
  EyeFilled,
  FileAddFilled,
  FileTextFilled,
  PrinterOutlined,
  SearchOutlined,
  SolutionOutlined,
  StopOutlined,
  SwapOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import ListFrame, { Field, initials, n0 } from './ListFrame'
import './land-list.css'
import '../farmers/farmer-merge-list.css'
import './land-history.css'

type Person = { id: number; name_bn: string; name_en: string | null; role: string | null; photo_url?: string | null }
type Row = {
  key: string
  kind: string
  date: string
  source_id: number
  ref: string
  land: { id: number; land_code: string; dag_no: string; mouza: string | null } | null
  detail: string
  detail2: string | null
  person: Person | null
  by: Person | null
}
type Place = { id: number; name_bn: string; district_id?: number }
type Summary = {
  total: number
  ownership: number
  cultivation: number
  borga: number
  transfers: number
  irrigation: number
  kinds: Record<string, string>
  users: { id: number; name_bn: string; name_en: string | null }[]
}
type Filters = { search?: string; kind?: string; mouza_id?: number; upazila_id?: number; district_id?: number; user_id?: number; from?: string; to?: string }

// tag colour and icon for each kind of event, as in the approved design
const KIND: Record<string, [string, ReactNode]> = {
  land_created: ['ll-blue', <FileAddFilled />],
  ownership_added: ['ll-green', <TeamOutlined />],
  cultivation_added: ['ll-orange', <UserAddOutlined />],
  cultivation_updated: ['ll-orange', <UserSwitchOutlined />],
  borga_agreement: ['ll-purple', <SolutionOutlined />],
  borga_ended: ['ll-purple', <StopOutlined />],
  transfer: ['hs-red', <SwapOutlined />],
  irrigation: ['hs-teal', <DashIcon name="drop" size={13} color="currentColor" stroke={2.4} />],
  details_updated: ['ll-gray', <EditOutlined />],
}

/** Everything that happened to every plot — created, owners, cultivators, borga, transfers, irrigation and edits. */
export default function LandHistoryPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const wide = Grid.useBreakpoint().lg
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [selected, setSelected] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['land-activities', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-register/activities', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-activities', 'summary'], queryFn: async () => (await api.get<Summary>('/land-register/activities/summary')).data })
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
  const exportCsv = () => downloadExport('/land-register/activities', { ...filters, export: 'csv' }, 'land-history.csv').catch((e) => message.error(errorMessage(e)))
  const upazilaOptions = (places.data?.upazilas ?? []).filter((u) => !draft.district_id || u.district_id === draft.district_id)
  const all = [{ value: '', label: tx('সকল') }]
  const open = (r: Row) =>
    navigate(r.kind === 'transfer' ? `/lands/transfers/${r.source_id}` : r.kind === 'irrigation' ? `/irrigation/invoices/${r.source_id}` : `/lands/lookup/history/${r.land?.id}`)

  const cards = [
    { key: 'total', label: tx('মোট ইতিহাস রেকর্ড'), value: s?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'ownership', label: tx('মালিকানা পরিবর্তন'), value: s?.ownership, icon: 'users', color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ kind: 'ownership_added' }) },
    { key: 'cultivation', label: tx('চাষাবাদ পরিবর্তন'), value: s?.cultivation, icon: 'sprout', color: '#f08c00', tint: '#fdefd6', onClick: () => show({ kind: 'cultivation_added,cultivation_updated' }) },
    { key: 'borga', label: tx('বর্গা চুক্তি'), value: s?.borga, icon: 'share', color: '#8b3fe0', tint: '#efe4fc', onClick: () => show({ kind: 'borga_agreement' }) },
    { key: 'transfers', label: tx('হস্তান্তর'), value: s?.transfers, icon: '', glyph: <SwapOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({ kind: 'transfer' }) },
    { key: 'irrigation', label: tx('সেচ কার্যক্রম'), value: s?.irrigation, icon: 'drop', color: '#0e9f9a', tint: '#d9f4f2', onClick: () => show({ kind: 'irrigation' }) },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'date', title: tx('তারিখ'), dataIndex: 'date', render: (v: string) => fmtDate(v.slice(0, 10)) },
    { key: 'code', title: tx('জমির নং'), render: (_, r) => (r.land ? <Link to={`/lands/${r.land.id}`} className="fl-link hs-code">{r.land.land_code}</Link> : '—') },
    { key: 'mouza', title: tx('মৌজা'), render: (_, r) => r.land?.mouza ?? '—' },
    { key: 'dag', title: tx('দাগ নং'), render: (_, r) => digits(r.land?.dag_no ?? '—') },
    {
      key: 'kind',
      title: tx('কার্যক্রমের ধরন'),
      dataIndex: 'kind',
      render: (k: string) => (
        <Tag className={`fl-tag hs-kind ${KIND[k]?.[0] ?? 'll-gray'}`}>
          {KIND[k]?.[1]}
          <span>{s?.kinds[k] ?? k}</span>
        </Tag>
      ),
    },
    {
      key: 'detail',
      title: tx('বিস্তারিত'),
      className: 'hs-detail',
      render: (_, r) => (
        <span className="hs-two">
          {digits(r.detail)}
          {r.detail2 && <span>{digits(r.detail2)}</span>}
        </span>
      ),
    },
    {
      key: 'person',
      title: tx('সংশ্লিষ্ট ব্যক্তি'),
      className: 'hs-person-cell',
      render: (_, r) =>
        r.person ? (
          <span className="mg-who">
            {r.person.photo_url ? <ProtectedImage url={r.person.photo_url} size={34} shape="square" /> : <span className="ml-initials mg-initials">{initials(nameOf(r.person))}</span>}
            <span className="hs-two">
              <Link to={`/farmers/${r.person.id}`} className="hs-person">
                {nameOf(r.person)}
              </Link>
              <span>({r.person.role})</span>
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'by',
      title: tx('সম্পাদনকারী'),
      className: 'hs-by-cell',
      render: (_, r) =>
        r.by ? (
          <span className="hs-two">
            {r.by.role ?? nameOf(r.by)}
            {r.by.role && <span>{nameOf(r.by)}</span>}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'ref', title: tx('রেফারেন্স নং'), dataIndex: 'ref', render: (v: string) => digits(v) },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 64,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="mg-act hs-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => open(r)} />,
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('জমির ইতিহাসের তালিকা')}
      subtitle={tx('সব জমির পূর্ণ ইতিহাস দেখুন। এই তালিকায় মালিকানা, চাষাবাদ, বর্গা, হস্তান্তর, সেচ ও অন্যান্য কার্যক্রম দেখা যায়।')}
      cards={cards}
      statsClass="hs-six"
      filterClass="ll-filters hs-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={380}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('জমির নং, মালিকের নাম, মৌজা বা রেফারেন্স দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => set({ search: e.target.value || undefined })}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('কার্যক্রমের ধরন')}>
            <Select value={draft.kind ?? ''} options={[...all, ...Object.entries(s?.kinds ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ kind: v || undefined })} />
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
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('সম্পাদনকারী')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.user_id ?? ''}
              options={[...all, ...(s?.users ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]}
              onChange={(v) => set({ user_id: v === '' ? undefined : Number(v) })}
            />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('জমির ইতিহাসের তালিকা ({{p0}})', { p0: n0(total) })}
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
        className="fl-table ml-table pl-table mg-table hs-table"
        rowKey="key"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('কোনো কার্যক্রম পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
