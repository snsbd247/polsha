import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Dropdown, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditFilled, EyeFilled, InfoCircleFilled, LinkOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import PageFrame from '../../components/PageFrame'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import type { RatePage, Season } from '../../lib/irrigation'
import { t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { n0 } from '../lands/ListFrame'
import { SEASON_STATUS_TONE } from './SeasonsPage'
import '../membership/member-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './invoice-detail.css'
import './rates.css'
import './seasons.css'

type LandType = { id: number; name_bn: string; display_name: string; code: string | null; description: string | null; display_category: string | null; is_active: boolean; lands_count: number }
type SeasonData = { data: Season[]; statuses: Record<string, string> }

/** The seasons and land types that rates and invoices are set by, side by side. */
export default function LookupPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [tab, setTab] = useState<'season' | 'land'>('season')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [applied, setApplied] = useState({ search: '', status: '' })

  const seasons = useQuery({ queryKey: ['seasons'], queryFn: async () => (await api.get<SeasonData>('/seasons')).data })
  const landTypes = useQuery({ queryKey: ['land-types'], queryFn: async () => (await api.get<LandType[]>('/land-types')).data })
  const rates = useQuery({ queryKey: ['irrigation-rates', 'all', 'lookup'], queryFn: async () => (await api.get<RatePage>('/irrigation-rates/all', { params: { per_page: 10 } })).data })

  const q = applied.search.toLowerCase()
  const seasonRows = (seasons.data?.data ?? []).filter(
    (s) => (!q || `${s.name_bn} ${s.code ?? ''} ${s.remarks ?? ''} ${s.crop ?? ''}`.toLowerCase().includes(q)) && (!applied.status || s.status === applied.status),
  )
  const landRows = (landTypes.data ?? []).filter(
    (t) => (!q || `${t.display_name} ${t.code ?? ''} ${t.description ?? ''}`.toLowerCase().includes(q)) && (!applied.status || (applied.status === 'active') === t.is_active),
  )

  const seasonCols: ColumnsType<Season> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => n0(i + 1) },
    { title: tx('মৌসুমের নাম'), dataIndex: 'name_bn', render: (v) => <span className="fl-name">{v}</span> },
    { title: tx('কোড'), dataIndex: 'code', render: (v) => v ?? '—' },
    { title: tx('শুরুর তারিখ'), dataIndex: 'start_date', render: fmtDate },
    { title: tx('শেষের তারিখ'), dataIndex: 'end_date', render: fmtDate },
    { title: tx('বিবরণ'), dataIndex: 'remarks', className: 'lt-desc', render: (v, s) => v || s.crop || '—' },
    { title: tx('অবস্থা'), dataIndex: 'status', align: 'center', render: (v: string) => <Tag className={`fl-tag rt-state ${SEASON_STATUS_TONE[v] ?? 'll-gray'}`}>{seasons.data?.statuses[v] ?? v}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 100,
      align: 'center',
      render: (_, s) => (
        <div className="mg-actions lt-actions">
          <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/irrigation/seasons/${s.id}`)} />
          {can('irrigation.edit') && <Button type="text" className="mg-view" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => navigate(`/irrigation/seasons/${s.id}/edit`)} />}
        </div>
      ),
    },
  ]
  const landCols: ColumnsType<LandType> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => n0(i + 1) },
    { title: tx('জমির ধরনের নাম'), dataIndex: 'display_name', render: (v) => <span className="fl-name">{v}</span> },
    { title: tx('কোড'), dataIndex: 'code', render: (v) => v ?? '—' },
    { title: tx('বিবরণ'), dataIndex: 'description', className: 'lt-desc', render: (v, t) => v || t.display_category || '—' },
    { title: tx('জমি'), dataIndex: 'lands_count', align: 'right', render: (v: number) => n0(v) },
    { title: tx('অবস্থা'), dataIndex: 'is_active', align: 'center', render: (v) => (v ? <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>) },
    {
      title: tx('অ্যাকশন'),
      width: 90,
      align: 'center',
      render: (_, t) => <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/lands?land_type_id=${t.id}`)} />,
    },
  ]

  const cards = [
    { key: 'seasons', label: tx('মোট মৌসুম'), value: seasons.data?.data.length, icon: 'sprout', color: '#1f9d55', tint: '#dcf3e5', onClick: () => setTab('season') },
    { key: 'lands', label: tx('মোট জমির ধরন'), value: landTypes.data?.length, icon: 'layers', color: '#1769e0', tint: '#e4edfd', onClick: () => setTab('land') },
    { key: 'combos', label: tx('সক্রিয় সমন্বয়'), value: rates.data?.summary.combinations, icon: '', color: '#1769e0', tint: '#e4edfd', onClick: () => navigate('/irrigation/category-rates') },
  ]

  const tableHead = (title: string, add?: () => void, addLabel?: string) => (
    <div className="fl-table-head ml-table-head lk-head">
      <h3>{title}</h3>
      {add && can('irrigation.edit') && (
        <Button icon={<PlusOutlined />} className="ml-columns pl-columns" onClick={add}>
          {addLabel}
        </Button>
      )}
    </div>
  )

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('মৌসুম / জমির ধরন অনুসন্ধান') }]}
      title={tx('মৌসুম / জমির ধরন অনুসন্ধান')}
      subtitle={tx('সেচের রেট নির্ধারণ ও ইনভয়েস তৈরিতে ব্যবহৃত মৌসুম ও জমির ধরন পরিচালনা করুন।')}
      actions={
        can('irrigation.edit') && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'season', label: tx('নতুন মৌসুম'), onClick: () => navigate('/irrigation/seasons/new') },
                ...(can('settings.admin') ? [{ key: 'land', label: tx('নতুন জমির ধরন'), onClick: () => navigate('/settings/land-types') }] : []),
              ],
            }}
          >
            <Button type="primary" icon={<PlusOutlined />}>
              {tx('নতুন যোগ করুন')}
            </Button>
          </Dropdown>
        )
      }
    >
      <div className="lk-tabs">
        <button type="button" className={tab === 'season' ? 'on' : ''} onClick={() => setTab('season')}>
          <DashIcon name="sprout" size={18} color={tab === 'season' ? '#1769e0' : '#374151'} stroke={2.2} /> {tx('মৌসুমের তালিকা')}
        </button>
        <button type="button" className={tab === 'land' ? 'on' : ''} onClick={() => setTab('land')}>
          <DashIcon name="layers" size={18} color={tab === 'land' ? '#1769e0' : '#374151'} stroke={2.2} /> {tx('জমির ধরনের তালিকা')}
        </button>
      </div>

      <div className="lk-stats">
        {cards.map((c) => (
          <button key={c.key} type="button" className="fl-stat" style={{ ['--tint' as string]: c.tint }} onClick={c.onClick}>
            <span className="fl-stat-icon" style={{ background: c.tint }}>
              {c.icon ? <DashIcon name={c.icon} size={28} color={c.color} stroke={2.1} /> : <LinkOutlined style={{ fontSize: 26, color: c.color }} />}
            </span>
            <span className="fl-stat-body">
              <span className="fl-stat-label">{c.label}</span>
              <span className="fl-stat-value">{c.value === undefined ? '—' : n0(c.value)}</span>
            </span>
          </button>
        ))}
        <div className="lk-info">
          <InfoCircleFilled />
          {tx('এই মূল তথ্যগুলো সেচের রেট, ইনভয়েস তৈরি ও রিপোর্টে ব্যবহার হয়।')}
        </div>
      </div>

      <section className="fl-card fl-table-card lk-card">
        {tableHead(tab === 'season' ? tx('মৌসুমের তালিকা') : tx('জমির ধরনের তালিকা'), tab === 'season' ? () => navigate('/irrigation/seasons/new') : undefined, tx('নতুন মৌসুম'))}
        <div className="lk-filters">
          <Input prefix={<SearchOutlined />} allowClear placeholder={tab === 'season' ? tx('মৌসুমের নাম বা বিবরণ দিয়ে খুঁজুন...') : tx('জমির ধরনের নাম বা কোড দিয়ে খুঁজুন...')} value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => setApplied({ search, status })} />
          <label>
            <span>{tx('অবস্থা')}</span>
            <Select
              value={status}
              onChange={setStatus}
              options={
                tab === 'season'
                  ? [{ value: '', label: tx('সকল') }, ...Object.entries(seasons.data?.statuses ?? {}).map(([value, label]) => ({ value, label }))]
                  : [
                      { value: '', label: tx('সকল') },
                      { value: 'active', label: tx('সক্রিয়') },
                      { value: 'inactive', label: tx('নিষ্ক্রিয়') },
                    ]
              }
            />
          </label>
          <Button type="primary" icon={<SearchOutlined />} onClick={() => setApplied({ search, status })}>
            {tx('খুঁজুন')}
          </Button>
          <Button
            onClick={() => {
              setSearch('')
              setStatus('')
              setApplied({ search: '', status: '' })
            }}
          >
            {tx('রিসেট')}
          </Button>
        </div>
        {tab === 'season' ? (
          <Table<Season> className="fl-table ml-table lt-table" rowKey="id" size="small" loading={seasons.isFetching} dataSource={seasonRows} columns={seasonCols} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} />
        ) : (
          <Table<LandType> className="fl-table ml-table lt-table" rowKey="id" size="small" loading={landTypes.isFetching} dataSource={landRows} columns={landCols} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} />
        )}
      </section>

      <section className="fl-card fl-table-card lk-card">
        {tableHead(tab === 'season' ? tx('জমির ধরনের তালিকা') : tx('মৌসুমের তালিকা'), tab === 'land' ? () => navigate('/irrigation/seasons/new') : undefined, tx('নতুন মৌসুম'))}
        {tab === 'season' ? (
          <Table<LandType> className="fl-table ml-table lt-table" rowKey="id" size="small" dataSource={landTypes.data ?? []} columns={landCols} pagination={false} scroll={{ x: 'max-content' }} />
        ) : (
          <Table<Season> className="fl-table ml-table lt-table" rowKey="id" size="small" dataSource={seasons.data?.data ?? []} columns={seasonCols} pagination={false} scroll={{ x: 'max-content' }} />
        )}
      </section>
    </PageFrame>
  )
}
