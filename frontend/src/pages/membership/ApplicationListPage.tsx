import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, ConfigProvider, DatePicker, Dropdown, Input, Pagination, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AuditOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  EyeFilled,
  FileTextOutlined,
  HomeOutlined,
  MoreOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { APPLICATION_STATUS, downloadExport } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../farmers/farmer-list.css'
import './application-list.css'

type Farmer = { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile: string | null; nid: string | null; mouza: { name_bn: string } | null }
type Row = {
  id: number
  application_no: string
  applied_on: string
  admission_fee: string
  fee_status: 'paid' | 'due'
  initial_shares: number | null
  status: string
  farmer: Farmer
  photo_url: string | null
  member: { member_no: number } | null
  approval_request: { id: number; status: string; current_step: number; total_steps: number } | null
}
type Summary = { total: number; pending: number; approved: number; rejected: number; fee_due: number }
type Filters = { search?: string; status?: string; fee_status?: string; mouza_id?: number; from?: string; to?: string }
type Params = Filters & { page: number; per_page: number }

const EDITABLE = ['draft', 'returned']
const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const tk = (v: number) => '৳ ' + digits(v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const STATUS_CLASS: Record<string, string> = { draft: 'gray', pending: 'gold', approved: 'green', rejected: 'red', returned: 'orange', cancelled: 'gray' }

/** Pending on a later approval step reads as "under review", like the approved design. */
function statusTag(r: Pick<Row, 'status' | 'approval_request'>) {
  const review = r.status === 'pending' && (r.approval_request?.current_step ?? 1) > 1
  return <Tag className={`fl-tag al-tag-${review ? 'blue' : STATUS_CLASS[r.status] ?? 'gray'}`}>{review ? tx('পর্যালোচনাধীন') : APPLICATION_STATUS[r.status]?.label ?? r.status}</Tag>
}
const feeTag = (s: string) => <Tag className={`fl-tag ${s === 'paid' ? 'fl-tag-green' : 'fl-tag-red'}`}>{s === 'paid' ? tx('পরিশোধিত') : tx('বাকি')}</Tag>

export default function ApplicationListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 5 })
  const [draft, setDraft] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selected, setSelected] = useState<number[]>([])

  const { data, isFetching } = useQuery({
    queryKey: ['membership-applications', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/membership-applications', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['membership-applications', 'summary'], queryFn: async () => (await api.get<Summary>('/membership-applications/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const rows = useMemo(() => data?.data ?? [], [data])
  const total = data?.total ?? 0
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)

  const apply = () => setParams((p) => ({ page: 1, per_page: p.per_page, ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') }))
  const reset = () => {
    setDraft({})
    setRange(null)
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }
  const exportCsv = async () => {
    try {
      await downloadExport('/membership-applications', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'membership-applications.csv')
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const open = (id: number) => navigate(`/membership/applications/${id}`)

  const s = summary.data
  const cards = [
    { key: 'total', label: tx('মোট আবেদন'), value: s?.total, icon: 'file', color: '#2563eb', tint: '#e4edfd', filter: {} },
    { key: 'pending', label: tx('পর্যালোচনার অপেক্ষায়'), value: s?.pending, icon: 'calendar', color: '#f08c00', tint: '#fdf0dc', tone: 'orange', filter: { status: 'pending' } },
    { key: 'approved', label: tx('অনুমোদিত'), value: s?.approved, icon: 'userCheck', color: '#1f9d55', tint: '#e3f5ea', tone: 'green', filter: { status: 'approved' } },
    { key: 'rejected', label: tx('প্রত্যাখ্যাত'), value: s?.rejected, icon: 'userX', color: '#e0383e', tint: '#fde6e7', tone: 'red', filter: { status: 'rejected' } },
    { key: 'fee', label: tx('ভর্তি ফি বাকি'), value: s?.fee_due, icon: 'layers', color: '#6d4ae6', tint: '#ece7fc', tone: 'purple', filter: { fee_status: 'due' } },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 42, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: '', width: 50, render: (_, r) => <ProtectedImage url={r.photo_url} size={34} shape="square" /> },
    { title: tx('আবেদন নং'), dataIndex: 'application_no', render: (v, r) => <Link to={`/membership/applications/${r.id}`} className="fl-link">{v}</Link> },
    { title: tx('কৃষকের নাম'), render: (_, r) => <Link to={`/farmers/${r.farmer.id}`} className="fl-name">{nameOf(r.farmer)}</Link> },
    { title: tx('মোবাইল'), render: (_, r) => digits(r.farmer.mobile) || '—' },
    { title: 'NID', render: (_, r) => digits(r.farmer.nid) || '—' },
    { title: tx('মৌজা'), render: (_, r) => r.farmer.mouza?.name_bn ?? '—' },
    { title: tx('আবেদনের তারিখ'), dataIndex: 'applied_on', render: fmtDate },
    { title: tx('ভর্তি ফি'), dataIndex: 'admission_fee', render: (v) => tk(Number(v)) },
    { title: tx('অবস্থা'), render: (_, r) => statusTag(r) },
    { title: tx('পেমেন্ট'), dataIndex: 'fee_status', render: feeTag },
    {
      title: tx('অ্যাকশন'),
      width: 132,
      render: (_, r) => {
        const editable = EDITABLE.includes(r.status) && can(['membership.create', 'membership.edit'])
        const items = [
          { key: 'open', icon: <FileTextOutlined />, label: tx('আবেদন খুলুন'), onClick: () => navigate(`/membership/applications/${r.id}`) },
          { key: 'farmer', icon: <EyeFilled />, label: tx('কৃষকের প্রোফাইল'), onClick: () => navigate(`/farmers/${r.farmer.id}`) },
          r.approval_request && { key: 'approval', icon: <AuditOutlined />, label: tx('অনুমোদনের অবস্থা'), onClick: () => navigate(`/approvals/${r.approval_request!.id}`) },
        ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]
        return (
          <div className="fl-actions">
            <Button className="fl-act fl-act-view" icon={<EyeFilled />} aria-label={tx('আবেদন খুলুন')} onClick={() => open(r.id)} />
            <Button className="fl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!editable} onClick={() => navigate(`/membership/applications/${r.id}`)} />
            <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
              <Button className="fl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
            </Dropdown>
          </div>
        )
      },
    },
  ]

  const moreItems = [
    can('member.view') && { key: 'members', label: tx('সদস্য তালিকা'), onClick: () => navigate('/members') },
    can('member.view') && { key: 'register', label: tx('ভর্তি রেজিস্টার'), onClick: () => navigate('/members/admission-register') },
    { key: 'approvals', label: tx('অনুমোদন'), onClick: () => navigate('/approvals') },
    { key: 'excel', icon: <DownloadOutlined />, label: 'Excel', onClick: exportCsv },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl al">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('সদস্যপদ আবেদন')}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{tx('সদস্যপদ আবেদন')}</h1>
            <p>{tx('নতুন সদস্যপদের আবেদন পরিচালনা করুন। ডকুমেন্ট যাচাই, ভর্তি ফি আদায় ও আবেদন অনুমোদন করুন।')}</p>
          </div>
          <div className="fl-head-btns">
            {can('membership.create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/membership/applications/new')}>
                {tx('নতুন সদস্যপদ আবেদন')}
              </Button>
            )}
            <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
              <Button>
                {tx('আরও')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <div className="fl-stats al-stats">
          {cards.map((c) => (
            <button key={c.key} type="button" className="fl-stat" style={{ ['--tint' as string]: c.tint }} onClick={() => (c.key === 'total' ? reset() : setParams((p) => ({ page: 1, per_page: p.per_page, ...c.filter })))}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-row">
                  <span className={`fl-stat-value al-tone-${c.tone ?? ''}`}>{c.value === undefined ? '—' : n0(c.value)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="fl-card fl-filters al-filters">
          <div className="fl-filter-row">
            <div className="fl-field fl-field-search">
              <span className="al-hidden-label">&nbsp;</span>
              <Input
                prefix={<SearchOutlined />}
                allowClear
                placeholder={tx('নাম, মোবাইল, NID, আবেদন নং দিয়ে খুঁজুন...')}
                value={draft.search}
                onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
                onPressEnter={apply}
              />
            </div>
            <div className="fl-field">
              <span>{tx('আবেদনের অবস্থা')}</span>
              <Select
                value={draft.status ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...Object.entries(APPLICATION_STATUS).map(([value, st]) => ({ value, label: st.label }))]}
                onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
              />
            </div>
            <div className="fl-field">
              <span>{tx('পেমেন্টের অবস্থা')}</span>
              <Select
                value={draft.fee_status ?? ''}
                options={[
                  { value: '', label: tx('সকল') },
                  { value: 'paid', label: tx('পরিশোধিত') },
                  { value: 'due', label: tx('বাকি') },
                ]}
                onChange={(v) => setDraft((d) => ({ ...d, fee_status: v || undefined }))}
              />
            </div>
            <div className="fl-field">
              <span>{tx('মৌজা')}</span>
              <Select
                showSearch={{ optionFilterProp: 'label' }}
                value={draft.mouza_id ?? ''}
                options={[{ value: '', label: tx('সকল মৌজা') }, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]}
                onChange={(v) => setDraft((d) => ({ ...d, mouza_id: v === '' ? undefined : Number(v) }))}
              />
            </div>
            <div className="fl-field al-range">
              <span>{tx('তারিখের পরিসর')}</span>
              <DatePicker.RangePicker format="DD-MM-YYYY" value={range} onChange={(r) => setRange(r as [Dayjs | null, Dayjs | null] | null)} placeholder={[tx('শুরু'), tx('শেষ')]} />
            </div>
            <div className="fl-filter-btns">
              <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
                {tx('খুঁজুন')}
              </Button>
              <Button onClick={reset}>{tx('রিসেট')}</Button>
            </div>
          </div>
        </div>

        <div className="fl-card fl-table-card">
          <div className="fl-table-head al-table-head">
            <h3>{tx('সদস্যপদ আবেদন ({{p0}})', { p0: n0(total) })}</h3>
            <div className="fl-table-tools">
              <Button icon={<DownloadOutlined />} className="fl-export al-export" onClick={exportCsv}>
                {tx('এক্সপোর্ট')}
              </Button>
            </div>
          </div>
          <Table<Row>
            className="fl-table al-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1150 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            onRow={(r) => ({ onDoubleClick: () => open(r.id) })}
            columns={columns}
            locale={{ emptyText: tx('কোনো আবেদন নেই') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি আবেদন', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
            <Pagination
              className="fl-pager"
              current={params.page}
              pageSize={params.per_page}
              total={total}
              showSizeChanger={false}
              showLessItems
              itemRender={(page, type, el) => (type === 'page' ? <a>{digits(page)}</a> : el)}
              onChange={(page) => setParams((p) => ({ ...p, page }))}
            />
            <span className="fl-rows">
              {tx('প্রতি পাতায় সারি')}{' '}
              <Select value={params.per_page} className="fl-size" options={[5, 10, 25, 50].map((v) => ({ value: v, label: digits(v) }))} onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))} />
            </span>
          </div>
        </div>

      </div>
    </ConfigProvider>
  )
}
