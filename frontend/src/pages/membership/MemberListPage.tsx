import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, ConfigProvider, DatePicker, Dropdown, Form, Input, InputNumber, Modal, Pagination, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  EyeFilled,
  HomeOutlined,
  IdcardOutlined,
  InsertRowRightOutlined,
  MoreOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FarmerPicker from '../../components/FarmerPicker'
import ProtectedImage from '../../components/ProtectedImage'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import { downloadExport, MEMBER_STATUS, toOptions, useFarmerMeta, type MemberStatus } from '../../lib/phase2'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../farmers/farmer-list.css'
import './member-list.css'

type Row = {
  id: number
  member_no: number
  admitted_on: string
  status: MemberStatus
  is_legacy: boolean
  photo_url: string | null
  farmer: {
    id: number
    farmer_code: string
    name_bn: string
    name_en: string | null
    father_name: string
    mobile: string | null
    nid: string | null
    occupation: string | null
    education_level: string | null
    mouza: { name_bn: string } | null
  }
}
type Summary = { total: number; active: number; inactive: number; cancelled: number; new: number; change: Record<'total' | 'active' | 'inactive' | 'new', number | null> }
type Filters = { search?: string; status?: string; education_level?: string; mouza_id?: number; occupation?: string; from?: string; to?: string }
type Params = Filters & { page: number; per_page: number }

type Action = 'deactivate' | 'activate' | 'cancel' | 'reactivate'
const ACTIONS: Record<Action, { label: string; from: MemberStatus[] }> = {
  deactivate: { label: tx('নিষ্ক্রিয় করুন'), from: ['active'] },
  activate: { label: tx('সক্রিয় করুন'), from: ['inactive'] },
  cancel: { label: tx('সদস্যপদ বাতিল'), from: ['active', 'inactive'] },
  reactivate: { label: tx('পুনর্বহাল'), from: ['cancelled'] },
}
const STATUS_CLASS: Record<MemberStatus, string> = { active: 'fl-tag-green', inactive: 'fl-tag-red', cancelled: 'ml-tag-gray' }

const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const initials = (name: string) =>
  name
    .replace(/^(Md\.|Mst\.|মোঃ|মোছাঃ)\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

export default function MemberListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [change, setChange] = useState<{ member: Row; action: Action } | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [statusForm] = Form.useForm()
  const [legacyForm] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['members', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/members', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['members', 'summary'], queryFn: async () => (await api.get<Summary>('/members/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const rows = useMemo(() => data?.data ?? [], [data])
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / params.per_page))
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)

  const apply = () => setParams((p) => ({ page: 1, per_page: p.per_page, ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') }))
  const reset = () => {
    setDraft({})
    setRange(null)
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }
  const exportCsv = () => downloadExport('/members/export', { ...params, page: undefined, per_page: undefined }, 'members.csv').catch((e) => message.error(errorMessage(e)))

  const openChange = (member: Row, action: Action) => {
    setChange({ member, action })
    statusForm.resetFields()
    statusForm.setFieldsValue({ effective_date: dayjs() })
  }
  const submitChange = async () => {
    const v = await statusForm.validateFields()
    try {
      const r = await api.post(`/members/${change!.member.id}/status`, { ...v, action: change!.action, effective_date: (v.effective_date as Dayjs).format('YYYY-MM-DD') })
      message.success(r.data.message)
      setChange(null)
      queryClient.invalidateQueries({ queryKey: ['members'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
    } catch (e) {
      if (!applyFormErrors(statusForm, e)) message.error(errorMessage(e))
    }
  }
  const submitLegacy = async () => {
    const v = await legacyForm.validateFields()
    try {
      await api.post('/members/legacy', { ...v, member_no: toEnDigits(String(v.member_no)), admitted_on: (v.admitted_on as Dayjs).format('YYYY-MM-DD') })
      message.success(tx('পুরোনো সদস্য এন্ট্রি হয়েছে।'))
      setLegacyOpen(false)
      legacyForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['members'] })
    } catch (e) {
      if (!applyFormErrors(legacyForm, e)) message.error(errorMessage(e))
    }
  }

  const s = summary.data
  const cards = [
    { key: 'total', label: tx('মোট সদস্য'), value: s?.total, change: s?.change.total, icon: 'users', color: '#2563eb', tint: '#e4edfd', caption: tx('গত মাসের তুলনায়'), filter: {} },
    { key: 'active', label: tx('মোট সক্রিয় সদস্য'), value: s?.active, change: s?.change.active, icon: 'userCheck', color: '#1f9d55', tint: '#e3f5ea', caption: tx('গত মাসের তুলনায়'), filter: { status: 'active' } },
    { key: 'inactive', label: tx('মোট নিষ্ক্রিয় সদস্য'), value: s?.inactive, change: s?.change.inactive, icon: 'userX', color: '#e0383e', tint: '#fde6e7', caption: tx('গত মাসের তুলনায়'), filter: { status: 'inactive' }, upIsBad: true },
    { key: 'new', label: tx('নতুন সদস্য'), value: s?.new, change: s?.change.new, icon: 'userPlus', color: '#6d4ae6', tint: '#ece7fc', caption: tx('এই মাসে'), filter: { from: dayjs().startOf('month').format('YYYY-MM-DD') } },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      key: 'photo',
      title: tx('ছবি'),
      width: 58,
      render: (_, m) => (m.photo_url ? <ProtectedImage url={m.photo_url} size={34} shape="square" /> : <span className="ml-initials">{initials(nameOf(m.farmer))}</span>),
    },
    { key: 'member_no', title: tx('সদস্য নং'), dataIndex: 'member_no', width: 96, render: (v, m) => <Link to={`/farmers/${m.farmer.id}`} className="fl-link">{digits(v)}</Link> },
    { key: 'name', title: tx('সদস্যের পুরো নাম'), render: (_, m) => <Link to={`/farmers/${m.farmer.id}`} className="fl-name">{nameOf(m.farmer)}</Link> },
    { key: 'father', title: tx('পিতার নাম'), render: (_, m) => m.farmer.father_name },
    { key: 'mobile', title: tx('মোবাইল'), render: (_, m) => digits(m.farmer.mobile) || '—' },
    { key: 'nid', title: 'NID', render: (_, m) => digits(m.farmer.nid) || '—' },
    { key: 'mouza', title: tx('মৌজা'), render: (_, m) => m.farmer.mouza?.name_bn ?? '—' },
    { key: 'joined', title: tx('যোগদানের তারিখ'), dataIndex: 'admitted_on', render: fmtDate },
    {
      key: 'status',
      title: tx('অবস্থা'),
      dataIndex: 'status',
      render: (st: MemberStatus, m) => (
        <>
          <Tag className={`fl-tag ${STATUS_CLASS[st]}`}>{MEMBER_STATUS[st].label}</Tag>
          {m.is_legacy && <span className="ml-legacy" title={tx('পুরোনো খাতার সদস্য')} />}
        </>
      ),
    },
    { key: 'education', title: tx('শিক্ষাগত যোগ্যতা'), render: (_, m) => (m.farmer.education_level ? meta?.education_levels[m.farmer.education_level] : '—') },
    { key: 'occupation', title: tx('পেশা'), render: (_, m) => (m.farmer.occupation ? meta?.occupations[m.farmer.occupation] : '—') },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 128,
      render: (_, m) => {
        const items = [
          { key: 'profile', icon: <IdcardOutlined />, label: tx('প্রোফাইল'), onClick: () => navigate(`/farmers/${m.farmer.id}`) },
          ...(can('member.edit')
            ? (Object.entries(ACTIONS) as [Action, (typeof ACTIONS)[Action]][])
                .filter(([, a]) => a.from.includes(m.status))
                .map(([key, a]) => ({ key, icon: undefined, label: a.label, danger: key === 'cancel', onClick: () => openChange(m, key) }))
            : []),
        ]
        return (
          <div className="fl-actions">
            <Button className="fl-act fl-act-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/farmers/${m.farmer.id}`)} />
            <Button className="fl-act fl-act-view" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!can('farmer.edit')} onClick={() => navigate(`/farmers/${m.farmer.id}/edit`)} />
            <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
              <Button className="fl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
            </Dropdown>
          </div>
        )
      },
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  const addItems = [
    can('membership.create') && { key: 'apply', label: tx('নতুন সদস্যপদ আবেদন'), onClick: () => navigate('/membership/applications/new') },
    can('member.admin') && { key: 'legacy', label: tx('পুরোনো খাতার সদস্য এন্ট্রি'), onClick: () => setLegacyOpen(true) },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]
  const exportItems = [
    can('member.export') && { key: 'excel', label: tx('সদস্য তালিকা (Excel)'), onClick: exportCsv },
    { key: 'register', label: tx('ভর্তি রেজিস্টার'), onClick: () => navigate('/members/admission-register') },
    { key: 'voters', label: tx('ভোটার তালিকা'), onClick: () => navigate('/members/voters') },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('সদস্য তালিকা')}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{tx('সদস্য তালিকা')}</h1>
            <p>{tx('সমবায়ের সব সদস্য দেখুন ও পরিচালনা করুন। খোঁজা, ফিল্টার ও দ্রুত কাজ করা যাবে।')}</p>
          </div>
          <div className="fl-head-btns">
            {addItems.length === 1 && (
              <Button type="primary" icon={<PlusOutlined />} onClick={addItems[0].onClick}>
                {tx('সদস্য যোগ করুন')}
              </Button>
            )}
            {addItems.length > 1 && (
              <Dropdown menu={{ items: addItems }} trigger={['click']} placement="bottomRight">
                <Button type="primary" icon={<PlusOutlined />}>
                  {tx('সদস্য যোগ করুন')}
                </Button>
              </Dropdown>
            )}
            <Dropdown menu={{ items: exportItems }} trigger={['click']} placement="bottomRight">
              <Button icon={<DownloadOutlined />}>
                {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <div className="fl-stats ml-stats">
          {cards.map((c) => {
            const up = (c.change ?? 0) >= 0
            const good = c.upIsBad ? !up : up
            return (
              <button key={c.key} type="button" className="fl-stat" style={{ ['--tint' as string]: c.tint }} onClick={() => setParams((p) => ({ page: 1, per_page: p.per_page, ...c.filter }))}>
                <span className="fl-stat-icon" style={{ background: c.tint }}>
                  <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
                </span>
                <span className="fl-stat-body">
                  <span className="fl-stat-label">{c.label}</span>
                  <span className="fl-stat-value">{c.value === undefined ? '—' : n0(c.value)}</span>
                </span>
                <span className="ml-change">
                  {c.change !== null && c.change !== undefined && (
                    <strong className={good ? 'good' : 'bad'}>
                      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {digits(Math.abs(c.change))}%
                    </strong>
                  )}
                  <small>{c.caption}</small>
                </span>
              </button>
            )
          })}
        </div>

        <div className="fl-card fl-filters ml-filters">
          <div className="fl-filter-row">
            <div className="fl-field fl-field-search">
              <span className="ml-hidden">&nbsp;</span>
              <Input
                prefix={<SearchOutlined />}
                allowClear
                placeholder={tx('নাম, মোবাইল, NID, সদস্য নং, পিতার নাম দিয়ে খুঁজুন...')}
                value={draft.search}
                onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
                onPressEnter={apply}
              />
            </div>
            <div className="fl-field">
              <span>{tx('সদস্যপদের অবস্থা')}</span>
              <Select
                value={draft.status ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...Object.entries(MEMBER_STATUS).map(([value, st]) => ({ value, label: st.label }))]}
                onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
              />
            </div>
            <div className="fl-field">
              <span>{tx('শিক্ষাগত যোগ্যতা')}</span>
              <Select value={draft.education_level ?? ''} options={[{ value: '', label: tx('সকল') }, ...toOptions(meta?.education_levels)]} onChange={(v) => setDraft((d) => ({ ...d, education_level: v || undefined }))} />
            </div>
            <div className="fl-field">
              <span>{tx('মৌজা')}</span>
              <Select
                showSearch={{ optionFilterProp: 'label' }}
                value={draft.mouza_id ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]}
                onChange={(v) => setDraft((d) => ({ ...d, mouza_id: v === '' ? undefined : Number(v) }))}
              />
            </div>
            <div className="fl-field">
              <span>{tx('পেশা')}</span>
              <Select value={draft.occupation ?? ''} options={[{ value: '', label: tx('সকল') }, ...toOptions(meta?.occupations)]} onChange={(v) => setDraft((d) => ({ ...d, occupation: v || undefined }))} />
            </div>
            <div className="fl-field ml-range">
              <span>{tx('যোগদানের তারিখের পরিসর')}</span>
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
          <div className="fl-table-head ml-table-head">
            <h3>{tx('সদস্য তালিকা ({{p0}})', { p0: n0(total) })}</h3>
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
              <Button icon={<InsertRowRightOutlined />} className="ml-columns">
                {tx('কলাম')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
          <Table<Row>
            className="fl-table ml-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1250 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            columns={columns}
            locale={{ emptyText: tx('কোনো সদস্য নেই') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}} জন সদস্য', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
            <span className="ml-pager">
              <Button className="ml-edge" icon={<DoubleLeftOutlined />} disabled={params.page <= 1} aria-label={tx('প্রথম পাতা')} onClick={() => setParams((p) => ({ ...p, page: 1 }))} />
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
              <Button className="ml-edge" icon={<DoubleRightOutlined />} disabled={params.page >= lastPage} aria-label={tx('শেষ পাতা')} onClick={() => setParams((p) => ({ ...p, page: lastPage }))} />
            </span>
            <span className="fl-rows">
              {tx('প্রতি পাতায় সারি')}{' '}
              <Select value={params.per_page} className="fl-size" options={[10, 25, 50, 100].map((v) => ({ value: v, label: digits(v) }))} onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))} />
            </span>
          </div>
        </div>

        <Modal
          open={!!change}
          title={change ? tx('{{p0}} — {{p1}} (নং {{p2}})', { p0: ACTIONS[change.action].label, p1: change.member.farmer.name_bn, p2: digits(change.member.member_no) }) : ''}
          onCancel={() => setChange(null)}
          onOk={submitChange}
          okText={tx('অনুমোদনের জন্য পাঠান')}
          cancelText={tx('বাতিল')}
          okButtonProps={{ danger: change?.action === 'cancel' }}
          forceRender
        >
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('ম্যানেজার ও সভাপতি/বোর্ডের অনুমোদনের পর কার্যকর হবে।')} />
          <Form form={statusForm} layout="vertical">
            <Form.Item name="effective_date" label={tx('কার্যকর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
            {change?.action === 'cancel' && (
              <>
                <Form.Item name="reason_type" label={tx('বাতিলের কারণ')} rules={[required(tx('কারণ বাছাই করুন'))]}>
                  <Select options={toOptions(meta?.cancel_reasons)} />
                </Form.Item>
                <Form.Item name="resolution_no" label={tx('সভার সিদ্ধান্ত নম্বর')} rules={[required(tx('সিদ্ধান্ত নম্বর দিন'))]}>
                  <Input />
                </Form.Item>
              </>
            )}
            <Form.Item name="reason" label={tx('বিস্তারিত কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
              <Input.TextArea rows={3} />
            </Form.Item>
            {change?.action === 'reactivate' && (
              <Form.Item name="fee" label={tx('পুনর্ভর্তি ফি')}>
                <InputNumber min={0} prefix={tx('৳')} style={{ width: '100%' }} />
              </Form.Item>
            )}
          </Form>
        </Modal>

        <Modal open={legacyOpen} title={tx('পুরোনো খাতার সদস্য এন্ট্রি')} onCancel={() => setLegacyOpen(false)} onOk={submitLegacy} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')} forceRender>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('খাতার সদস্য নম্বর হুবহু বসবে। নতুন সদস্যের নম্বর স্বয়ংক্রিয়ভাবে সবচেয়ে বড় পুরোনো নম্বরের পর থেকে চলবে।')} />
          <Form form={legacyForm} layout="vertical">
            <Form.Item name="farmer_id" label={tx('কৃষক')} rules={[required(tx('কৃষক বাছাই করুন'))]}>
              <FarmerPicker type="non_member" />
            </Form.Item>
            <Form.Item name="member_no" label={tx('খাতার সদস্য নম্বর')} rules={[required(tx('সদস্য নম্বর দিন'))]}>
              <Input inputMode="numeric" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="admitted_on" label={tx('ভর্তির তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="remarks" label={tx('মন্তব্য')}>
              <Input />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </ConfigProvider>
  )
}
