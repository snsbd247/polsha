import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, ConfigProvider, DatePicker, Descriptions, Drawer, Dropdown, Form, Input, Modal, Pagination, Select, Switch, Table, Tag, Timeline } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AppstoreFilled,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  EyeFilled,
  HistoryOutlined,
  HomeOutlined,
  IdcardOutlined,
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
import { downloadExport } from '../../lib/phase2'
import { mobileRules, required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../farmers/farmer-list.css'
import '../membership/member-list.css'
import '../farmers/deleted-farmers.css'
import './patwari-list.css'

type Assignment = { id: number; mouza_id: number; start_date: string; end_date: string | null; mouza: { id: number; name_bn: string; jl_no: string } }
type Patwari = {
  id: number
  name: string
  father_name: string
  mobile: string
  nid: string | null
  farmer_id: number | null
  farmer: { id: number; farmer_code: string; name_bn: string } | null
  is_active: boolean
  current_assignments: Assignment[]
  lands_count?: number
  joined_on?: string | null
  district?: string | null
  upazila?: string | null
  mouza_count?: number
  photo_url?: string | null
  assignments?: Assignment[]
}
type Place = { id: number; name_bn: string; district_id?: number }
type Summary = { total: number; active: number; inactive: number; mouzas: number; districts: Place[]; upazilas: Place[] }
type Filters = { search?: string; is_active?: string; district_id?: number; upazila_id?: number; mouza_id?: number }
type Params = Filters & { page: number; per_page: number }

const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const initials = (name: string) =>
  name
    .replace(/^(Md\.|Mst\.|মোঃ|মোছাঃ)\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

export default function PatwariPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Filters>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [editing, setEditing] = useState<Patwari | 'new' | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['patwaris', params],
    queryFn: async () => (await api.get<Paginated<Patwari>>('/patwaris', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['patwaris', 'summary'], queryFn: async () => (await api.get<Summary>('/patwaris/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const detail = useQuery({
    queryKey: ['patwaris', viewing, 'detail'],
    queryFn: async () => (await api.get<Patwari>(`/patwaris/${viewing}`)).data,
    enabled: !!viewing,
  })
  const mouzaOptions = mouzas.data?.map((m) => ({ value: m.id, label: `${m.name_bn} (JL ${m.jl_no})` }))

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / params.per_page))
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)
  const s = summary.data

  const apply = () => setParams((p) => ({ page: 1, per_page: p.per_page, ...draft }))
  const reset = () => {
    setDraft({})
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }

  const open = (p: Patwari | 'new') => {
    setEditing(p)
    form.resetFields()
    form.setFieldsValue(
      p === 'new'
        ? { is_active: true, start_date: dayjs(), mouza_ids: [] }
        : { ...p, start_date: dayjs(), mouza_ids: p.current_assignments.map((a) => a.mouza_id) },
    )
  }

  const save = async () => {
    const v = await form.validateFields()
    const payload = { ...v, mobile: toEnDigits(v.mobile), nid: v.nid ? toEnDigits(v.nid) : null, start_date: (v.start_date as Dayjs).format('YYYY-MM-DD') }
    try {
      if (editing === 'new') await api.post('/patwaris', payload)
      else await api.put(`/patwaris/${(editing as Patwari).id}`, payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['patwaris'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const exportCsv = () => downloadExport('/patwaris/export', { ...params, page: undefined, per_page: undefined }, 'patwaris.csv').catch((e) => message.error(errorMessage(e)))

  const cards = [
    { key: 'total', label: tx('মোট পাটোয়ারী'), value: s?.total, icon: 'users', color: '#2563eb', tint: '#e4edfd', filter: {} },
    { key: 'active', label: tx('সক্রিয় পাটোয়ারী'), value: s?.active, icon: 'userCheck', color: '#1f9d55', tint: '#e3f5ea', filter: { is_active: '1' } },
    { key: 'inactive', label: tx('নিষ্ক্রিয় পাটোয়ারী'), value: s?.inactive, icon: 'userX', color: '#e0383e', tint: '#fde6e7', filter: { is_active: '0' } },
    { key: 'mouzas', label: tx('মোট দায়িত্বপ্রাপ্ত মৌজা'), value: s?.mouzas, icon: 'mapPin', color: '#6d4ae6', tint: '#ece7fc', filter: {} },
  ]

  const allColumns: (ColumnsType<Patwari>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      key: 'photo',
      title: tx('ছবি'),
      width: 62,
      render: (_, p) => (p.photo_url ? <ProtectedImage url={p.photo_url} size={38} shape="square" /> : <span className="ml-initials pl-initials">{initials(p.name)}</span>),
    },
    { key: 'name', title: tx('পাটোয়ারীর নাম'), dataIndex: 'name', render: (v, p) => <a className="fl-name" onClick={() => setViewing(p.id)}>{v}</a> },
    { key: 'mobile', title: tx('মোবাইল'), dataIndex: 'mobile', render: (v) => digits(v) },
    { key: 'nid', title: 'NID', dataIndex: 'nid', render: (v) => digits(v) || '—' },
    { key: 'district', title: tx('জেলা'), dataIndex: 'district', render: (v) => v || '—' },
    { key: 'upazila', title: tx('উপজেলা'), dataIndex: 'upazila', render: (v) => v || '—' },
    {
      key: 'mouzas',
      title: tx('দায়িত্বপ্রাপ্ত মৌজা'),
      dataIndex: 'mouza_count',
      render: (v, p) => <span title={p.current_assignments.map((a) => a.mouza.name_bn).join(', ')}>{digits(v ?? 0)}</span>,
    },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'is_active', render: (v) => (v ? <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>) },
    { key: 'joined', title: tx('যোগদানের তারিখ'), dataIndex: 'joined_on', render: (v) => (v ? fmtDate(v) : '—') },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      render: (_, p) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setViewing(p.id)} />
          <Button className="fl-act pl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!can('patwari.edit')} onClick={() => open(p)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'history', icon: <HistoryOutlined />, label: tx('দায়িত্বের ইতিহাস'), onClick: () => setViewing(p.id) },
                ...(p.farmer ? [{ key: 'farmer', icon: <IdcardOutlined />, label: <Link to={`/farmers/${p.farmer.id}`}>{tx('কৃষক প্রোফাইল')}</Link> }] : []),
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
  const upazilaOptions = (s?.upazilas ?? []).filter((u) => !draft.district_id || u.district_id === draft.district_id)
  const v = detail.data

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml pl">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('পাটোয়ারী তালিকা')}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{tx('পাটোয়ারী তালিকা')}</h1>
            <p>{tx('সব পাটোয়ারী দেখুন ও পরিচালনা করুন। খোঁজা, ফিল্টার, প্রোফাইল দেখা ও দ্রুত কাজ করা যাবে।')}</p>
          </div>
          <div className="fl-head-btns">
            {can('patwari.create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
                {tx('নতুন পাটোয়ারী')}
              </Button>
            )}
            <Dropdown trigger={['click']} placement="bottomRight" disabled={!can('patwari.export')} menu={{ items: [{ key: 'excel', label: tx('Excel (CSV)'), onClick: exportCsv }] }}>
              <Button icon={<DownloadOutlined />}>
                {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <div className="fl-stats ml-stats pl-stats">
          {cards.map((c) => (
            <button key={c.key} type="button" className="fl-stat" style={{ ['--tint' as string]: c.tint }} onClick={() => setParams((p) => ({ page: 1, per_page: p.per_page, ...c.filter }))}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-value">{c.value === undefined ? '—' : n0(c.value)}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="dl-filters pl-filters">
          <div className="fl-field dl-search">
            <span className="ml-hidden">.</span>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('পাটোয়ারীর নাম, মোবাইল, NID, পিতার নাম দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </div>
          <div className="fl-field">
            <span>{tx('অবস্থা')}</span>
            <Select
              value={draft.is_active ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: '1', label: tx('সক্রিয়') },
                { value: '0', label: tx('নিষ্ক্রিয়') },
              ]}
              onChange={(val) => setDraft((d) => ({ ...d, is_active: val || undefined }))}
            />
          </div>
          <div className="fl-field">
            <span>{tx('জেলা')}</span>
            <Select
              value={draft.district_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(s?.districts ?? []).map((d) => ({ value: d.id, label: d.name_bn }))]}
              onChange={(val) => setDraft((d) => ({ ...d, district_id: val === '' ? undefined : Number(val), upazila_id: undefined }))}
            />
          </div>
          <div className="fl-field">
            <span>{tx('উপজেলা')}</span>
            <Select
              value={draft.upazila_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...upazilaOptions.map((u) => ({ value: u.id, label: u.name_bn }))]}
              onChange={(val) => setDraft((d) => ({ ...d, upazila_id: val === '' ? undefined : Number(val) }))}
            />
          </div>
          <div className="fl-field">
            <span>{tx('মৌজা')}</span>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.mouza_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]}
              onChange={(val) => setDraft((d) => ({ ...d, mouza_id: val === '' ? undefined : Number(val) }))}
            />
          </div>
          <div className="fl-filter-btns">
            <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
              {tx('খুঁজুন')}
            </Button>
            <Button onClick={reset}>{tx('রিসেট')}</Button>
          </div>
        </div>

        <div className="fl-card fl-table-card">
          <div className="fl-table-head ml-table-head">
            <h3>{tx('পাটোয়ারী তালিকা ({{p0}})', { p0: n0(total) })}</h3>
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
          </div>
          <Table<Patwari>
            className="fl-table ml-table pl-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1150 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            columns={columns}
            locale={{ emptyText: tx('কোনো পাটোয়ারী নেই') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}} জন পাটোয়ারী', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
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
              <Select value={params.per_page} className="fl-size" options={[10, 25, 50, 100].map((n) => ({ value: n, label: digits(n) }))} onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))} />
            </span>
          </div>
        </div>

        <Modal open={!!editing} title={editing === 'new' ? tx('নতুন পাটোয়ারী') : tx('পাটোয়ারী সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')} forceRender width={600}>
          <Form form={form} layout="vertical">
            <Form.Item name="name" label={tx('নাম')} rules={[required(tx('নাম দিন'))]}>
              <Input />
            </Form.Item>
            <Form.Item name="father_name" label={tx('পিতার নাম')} rules={[required(tx('পিতার নাম দিন'))]}>
              <Input />
            </Form.Item>
            <Form.Item name="mobile" label={tx('মোবাইল')} rules={mobileRules}>
              <Input inputMode="numeric" />
            </Form.Item>
            <Form.Item name="nid" label="NID">
              <Input inputMode="numeric" />
            </Form.Item>
            <Form.Item name="mouza_ids" label={tx('দায়িত্বাধীন মৌজা')} rules={[{ required: true, type: 'array', min: 1, message: tx('কমপক্ষে একটি মৌজা দিন') }]}>
              <Select mode="multiple" showSearch={{ optionFilterProp: 'label' }} options={mouzaOptions} />
            </Form.Item>
            <Form.Item name="start_date" label={editing === 'new' ? tx('দায়িত্ব শুরুর তারিখ') : tx('মৌজা পরিবর্তন কার্যকর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="farmer_id" label={tx('নিজেও কৃষক হলে (ঐচ্ছিক)')}>
              <FarmerPicker initialLabel={editing && editing !== 'new' && editing.farmer ? `${editing.farmer.name_bn} (${editing.farmer.farmer_code})` : undefined} />
            </Form.Item>
            <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
              <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
            </Form.Item>
          </Form>
        </Modal>

        <Drawer open={!!viewing} onClose={() => setViewing(null)} title={v?.name ?? tx('পাটোয়ারী')} size={520}>
          {v && (
            <>
              <Descriptions size="small" column={1} bordered className="pl-desc">
                <Descriptions.Item label={tx('পিতার নাম')}>{v.father_name}</Descriptions.Item>
                <Descriptions.Item label={tx('মোবাইল')}>{digits(v.mobile)}</Descriptions.Item>
                <Descriptions.Item label="NID">{digits(v.nid) || '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('অবস্থা')}>{v.is_active ? tx('সক্রিয়') : tx('নিষ্ক্রিয়')}</Descriptions.Item>
                {v.farmer && (
                  <Descriptions.Item label={tx('কৃষক প্রোফাইল')}>
                    <Link to={`/farmers/${v.farmer.id}`}>
                      {v.farmer.name_bn} ({v.farmer.farmer_code})
                    </Link>
                  </Descriptions.Item>
                )}
              </Descriptions>
              <h4 className="pl-history-title">{tx('দায়িত্বের ইতিহাস')}</h4>
              <Timeline
                items={(v.assignments ?? []).map((a) => ({
                  color: a.end_date ? 'gray' : 'green',
                  content: (
                    <>
                      <strong>{a.mouza.name_bn}</strong> (JL {digits(a.mouza.jl_no)})
                      <div>
                        {fmtDate(a.start_date)} — {a.end_date ? fmtDate(a.end_date) : tx('বর্তমান')}
                      </div>
                    </>
                  ),
                }))}
              />
              {can('patwari.edit') && (
                <Button
                  icon={<EditOutlined />}
                  onClick={() => {
                    const row = rows.find((r) => r.id === v.id)
                    setViewing(null)
                    open(row ?? { ...v, current_assignments: (v.assignments ?? []).filter((a) => !a.end_date) })
                  }}
                >
                  {tx('সম্পাদনা')}
                </Button>
              )}
            </>
          )}
        </Drawer>
      </div>
    </ConfigProvider>
  )
}
