import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Dropdown, Input, Segmented, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EyeFilled, MoreOutlined, SearchOutlined } from '@ant-design/icons'
import ProtectedImage from '../../components/ProtectedImage'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { useLandMeta } from '../../lib/land'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { acres, ExportMenu, Field, initials, n0 } from './ListFrame'

type Role = 'owner' | 'cultivator'
type Row = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string
  mobile: string | null
  member_no: number | null
  member_status: string | null
  photo_url: string | null
  lands: number
  area_decimal: number
  since: string
  land_mouzas: string | null
  also: boolean
  own_count: number
  tenancy_count: number
}
type Summary = { owners: number; cultivators: number; owner_cultivators: number; tenants: number; lands: number; uncultivated: number }
type Filters = { search?: string; mouza_id?: number; type?: string; membership?: string }

/** Who owns land and who farms it now, one row per farmer. */
export default function OwnerCultivatorPage() {
  const navigate = useNavigate()
  const { data: meta } = useLandMeta()
  const [role, setRole] = useState<Role>('owner')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const params = { role, page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['land-parties', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-register/parties', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-parties', 'summary'], queryFn: async () => (await api.get<Summary>('/land-register/parties/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const switchRole = (r: Role) => {
    setRole(r)
    setPage(1)
    if (r === 'owner') setFilters(({ type: _t, ...f }) => f)
  }

  const cards = [
    { key: 'owners', label: tx('মোট মালিক'), value: s?.owners, icon: 'users', color: '#2563eb', tint: '#e4edfd', onClick: () => switchRole('owner') },
    { key: 'cultivators', label: tx('মোট চাষি'), value: s?.cultivators, icon: 'sprout', color: '#1f9d55', tint: '#e3f5ea', onClick: () => switchRole('cultivator') },
    { key: 'both', label: tx('মালিক ও নিজে চাষি'), value: s?.owner_cultivators, icon: 'userCheck', color: '#6d4ae6', tint: '#ece7fc' },
    { key: 'tenants', label: tx('বর্গা / লিজ চাষি'), value: s?.tenants, icon: 'userClock', color: '#f08c00', tint: '#fdf0dc', onClick: () => navigate('/lands/borga') },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('ছবি'), width: 58, render: (_, r) => (r.photo_url ? <ProtectedImage url={r.photo_url} size={34} shape="square" /> : <span className="ml-initials">{initials(nameOf(r))}</span>) },
    { title: tx('কৃষক নং'), dataIndex: 'farmer_code', width: 96, render: (v, r) => <Link to={`/farmers/${r.id}`} className="fl-link">{v}</Link> },
    { title: tx('নাম'), render: (_, r) => <Link to={`/farmers/${r.id}`} className="fl-name">{nameOf(r)}</Link> },
    { title: tx('পিতার নাম'), dataIndex: 'father_name' },
    { title: tx('মোবাইল'), dataIndex: 'mobile', render: (v) => digits(v) || '—' },
    { title: tx('সদস্য নং'), dataIndex: 'member_no', render: (v) => (v ? <span className="fl-link">{digits(v)}</span> : <Tag className="fl-tag ml-tag-gray">{tx('সদস্য নন')}</Tag>) },
    { title: tx('জমির মৌজা'), dataIndex: 'land_mouzas', render: (v) => v || '—' },
    { title: tx('জমি'), dataIndex: 'lands', align: 'center', render: (v) => n0(v) },
    { title: role === 'owner' ? tx('মালিকানা (একর)') : tx('চাষের জমি (একর)'), dataIndex: 'area_decimal', render: (v) => acres(v) },
    role === 'owner'
      ? { title: tx('চাষ'), render: (_, r) => (r.also ? <Tag className="fl-tag fl-tag-green">{tx('নিজেও চাষ করেন')}</Tag> : <Tag className="fl-tag ml-tag-gray">{tx('অন্যে চাষ করে')}</Tag>) }
      : {
          title: tx('চাষের ধরন'),
          render: (_, r) => (
            <span className="oc-types">
              {r.own_count > 0 && <Tag className="fl-tag fl-tag-green">{tx('নিজ চাষ {{p0}}', { p0: digits(r.own_count) })}</Tag>}
              {r.tenancy_count > 0 && <Tag className="fl-tag fl-tag-orange">{tx('বর্গা/লিজ {{p0}}', { p0: digits(r.tenancy_count) })}</Tag>}
            </span>
          ),
        },
    { title: tx('শুরু থেকে'), dataIndex: 'since', render: fmtDate },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/farmers/${r.id}`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'profile', label: tx('কৃষকের প্রোফাইল'), onClick: () => navigate(`/farmers/${r.id}`) },
                { key: 'list', label: tx('জমির তালিকায় খুঁজুন'), onClick: () => navigate(`/lands?search=${encodeURIComponent(r.farmer_code)}`) },
              ],
            }}
          >
            <Button className="fl-act pl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
          </Dropdown>
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('মালিক ও চাষি')}
      subtitle={tx('কে কোন জমির মালিক আর কে চাষ করছেন — কৃষকভিত্তিক বর্তমান চিত্র। খোঁজা ও ফিল্টার করা যাবে।')}
      actions={
        <ExportMenu
          reports={role === 'owner' ? [{ key: 'land_owners', label: tx('মালিক রিপোর্ট') }] : [{ key: 'land_cultivators', label: tx('চাষি রিপোর্ট') }]}
          filters={{ q: filters.search, mouza_id: filters.mouza_id, type: filters.type }}
        />
      }
      cards={cards}
      above={
        <Segmented
          className="oc-switch"
          value={role}
          onChange={(v) => switchRole(v as Role)}
          options={[
            { value: 'owner', label: tx('মালিক ({{p0}})', { p0: s ? n0(s.owners) : '—' }) },
            { value: 'cultivator', label: tx('চাষি ({{p0}})', { p0: s ? n0(s.cultivators) : '—' }) },
          ]}
        />
      }
      filters={
        <>
          <Field grow={300}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('কৃষকের নাম, কৃষক নং, মোবাইল, জমির নং বা দাগ...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => {
                setFilters(draft)
                setPage(1)
              }}
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
          {role === 'cultivator' && (
            <Field label={tx('চাষের ধরন')}>
              <Select
                value={draft.type ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...Object.entries(meta?.cultivation_types ?? {}).map(([value, label]) => ({ value, label }))]}
                onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))}
              />
            </Field>
          )}
          <Field label={tx('সদস্যপদ')}>
            <Select
              value={draft.membership ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'member', label: tx('সদস্য') },
                { value: 'non_member', label: tx('সদস্য নন') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, membership: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => {
        setFilters(draft)
        setPage(1)
      }}
      onReset={() => {
        setDraft({})
        setFilters({})
        setPage(1)
      }}
      tableTitle={role === 'owner' ? tx('জমির মালিক ({{p0}})', { p0: n0(total) }) : tx('চাষি ({{p0}})', { p0: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}} জন', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
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
        scroll={{ x: 1200 }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো তথ্য নেই') }}
      />
    </ListFrame>
  )
}
