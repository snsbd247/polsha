import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, ConfigProvider, Descriptions, Drawer, Dropdown, Form, Input, Modal, Pagination, Select, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AppstoreFilled,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeFilled,
  HomeOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import LocationCascader, { type LocationPath } from '../../components/LocationCascader'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, toEnDigits } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { usePublicSettings } from '../../lib/settings'
import type { LocationItem, Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../farmers/farmer-list.css'
import '../membership/member-list.css'
import '../farmers/deleted-farmers.css'
import './patwari-list.css'
import PageTabs from '../../components/PageTabs'

type Row = Mouza & { district: string | null; patwari: string | null; farmers_count: number; lands_count: number; land_acre: number }
type Place = { id: number; name_bn: string; district_id?: number }
type Summary = { mouzas: number; farmers: number; lands: number; land_acre: number; districts: Place[]; upazilas: Place[]; patwaris: { id: number; name: string }[] }
type Filters = { search?: string; district_id?: number; upazila_id?: number; patwari_id?: number }
type Params = Filters & { page: number; per_page: number }

const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const acres = (v: number) => digits(v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default function MouzaPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: settings } = usePublicSettings()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Filters>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [editing, setEditing] = useState<Mouza | 'new' | null>(null)
  const [viewing, setViewing] = useState<Row | null>(null)
  const [printing, setPrinting] = useState(false)
  const [formPath, setFormPath] = useState<LocationPath>([])
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['mouzas', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/mouzas', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['mouzas', 'summary'], queryFn: async () => (await api.get<Summary>('/mouzas-summary')).data })

  const unionId = formPath[3]
  const villages = useQuery({
    queryKey: ['locations', 'villages', unionId ?? null, 'active'],
    queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { parent_id: unionId, active_only: 1 } })).data,
    enabled: !!unionId,
  })

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / params.per_page))
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)
  const s = summary.data

  const apply = () => setParams((p) => ({ page: 1, per_page: p.per_page, ...draft, search: draft.search ? toEnDigits(draft.search) : undefined }))
  const reset = () => {
    setDraft({})
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }

  const openForm = async (m: Mouza | 'new') => {
    setEditing(m)
    if (m === 'new') {
      setFormPath([])
      form.setFieldsValue({ name_bn: '', name_en: '', jl_no: '', village_ids: [], is_active: true })
    } else {
      const full = (await api.get(`/mouzas/${m.id}`)).data
      const u = full.union
      setFormPath([u.upazila.district.division_id, u.upazila.district_id, u.upazila_id, u.id])
      form.setFieldsValue({ name_bn: m.name_bn, name_en: m.name_en, jl_no: m.jl_no, is_active: m.is_active, village_ids: full.villages.map((v: { id: number }) => v.id) })
    }
  }

  const save = async () => {
    const values = await form.validateFields()
    if (!unionId) {
      message.error(tx('ইউনিয়ন বাছাই করুন।'))
      return
    }
    const payload = { ...values, union_id: unionId, jl_no: toEnDigits(String(values.jl_no)) }
    try {
      if (editing === 'new') await api.post('/mouzas', payload)
      else await api.put(`/mouzas/${(editing as Mouza).id}`, payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['mouzas'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const exportCsv = () => downloadExport('/mouzas', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'mouzas.csv').catch((e) => message.error(errorMessage(e)))

  /** Every mouza matching the filters, as a printable table. */
  const print = async () => {
    setPrinting(true)
    try {
      const all: Row[] = []
      for (let page = 1; ; page++) {
        const r = (await api.get<Paginated<Row>>('/mouzas', { params: { ...params, page, per_page: 100 } })).data
        all.push(...r.data)
        if (page * 100 >= r.total) break
      }
      const w = window.open('', '_blank', 'width=1000,height=700')
      if (!w) return
      const body = all
        .map(
          (m, i) =>
            `<tr><td>${esc(digits(i + 1))}</td><td>${esc(digits(m.jl_no))}</td><td>${esc(nameOf(m))}</td><td>${esc(m.district)}</td><td>${esc(m.upazila?.name_bn)}</td><td>${esc(m.patwari ?? '—')}</td><td>${esc(n0(m.farmers_count))}</td><td>${esc(n0(m.lands_count))}</td><td>${esc(acres(m.land_acre))}</td><td>${esc(m.is_active ? tx('সক্রিয়') : tx('নিষ্ক্রিয়'))}</td></tr>`,
        )
        .join('')
      w.document.write(
        `<html><head><title>${esc(tx('মৌজা তালিকা'))}</title><style>body{font-family:sans-serif;margin:16px}h2,h3{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12.5px}th,td{border:1px solid #444;padding:5px 6px;text-align:left}</style></head><body>` +
          `<h2>${esc(nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }))}</h2><h3>${esc(tx('মৌজা তালিকা ({{p0}})', { p0: n0(all.length) }))}</h3>` +
          `<table><thead><tr><th>#</th><th>${esc(tx('মৌজা কোড'))}</th><th>${esc(tx('মৌজার নাম'))}</th><th>${esc(tx('জেলা'))}</th><th>${esc(tx('উপজেলা'))}</th><th>${esc(tx('পাটোয়ারী'))}</th><th>${esc(tx('মোট কৃষক'))}</th><th>${esc(tx('মোট জমির রেকর্ড'))}</th><th>${esc(tx('মোট জমির পরিমাণ (একর)'))}</th><th>${esc(tx('অবস্থা'))}</th></tr></thead><tbody>${body}</tbody></table></body></html>`,
      )
      w.document.close()
      w.focus()
      setTimeout(() => w.print(), 300)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setPrinting(false)
    }
  }

  const cards = [
    { key: 'mouzas', label: tx('মোট মৌজা'), value: s ? n0(s.mouzas) : '—', icon: 'mapPin', color: '#2563eb', tint: '#e4edfd' },
    { key: 'farmers', label: tx('মোট কৃষক'), value: s ? n0(s.farmers) : '—', icon: 'users', color: '#1f9d55', tint: '#e3f5ea' },
    { key: 'lands', label: tx('মোট জমির রেকর্ড'), value: s ? n0(s.lands) : '—', icon: 'layers', color: '#f08c00', tint: '#fdf0dc' },
    { key: 'area', label: tx('মোট জমির পরিমাণ'), value: s ? acres(s.land_acre) : '—', unit: tx('একর'), icon: 'mapPin', color: '#6d4ae6', tint: '#ece7fc' },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'code', title: tx('মৌজা কোড'), dataIndex: 'jl_no', width: 92, render: (v) => digits(v) },
    {
      key: 'name',
      title: tx('মৌজার নাম'),
      render: (_, m) => (
        <a className="fl-name" onClick={() => setViewing(m)}>
          {nameOf(m)}
        </a>
      ),
    },
    { key: 'district', title: tx('জেলা'), dataIndex: 'district', render: (v) => v || '—' },
    { key: 'upazila', title: tx('উপজেলা'), render: (_, m) => m.upazila?.name_bn ?? '—' },
    { key: 'patwari', title: tx('পাটোয়ারী'), dataIndex: 'patwari', render: (v) => v || '—' },
    { key: 'farmers', title: tx('মোট কৃষক'), dataIndex: 'farmers_count', render: (v) => n0(v ?? 0) },
    { key: 'lands', title: tx('মোট জমির রেকর্ড'), dataIndex: 'lands_count', render: (v) => n0(v ?? 0) },
    { key: 'area', title: tx('মোট জমির পরিমাণ (একর)'), dataIndex: 'land_acre', render: (v) => acres(v ?? 0) },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'is_active', render: (v) => (v ? <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>) },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      render: (_, m) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setViewing(m)} />
          <Button className="fl-act pl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!can('mouza.edit')} onClick={() => openForm(m)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'view', icon: <EnvironmentOutlined />, label: tx('বিস্তারিত'), onClick: () => setViewing(m) },
                { key: 'locations', label: <Link to="/masters/locations">{tx('এলাকা')}</Link> },
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

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml pl mz">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('মৌজা ব্যবস্থাপনা')}</span>
        </nav>
        <PageTabs />

        <div className="fl-head">
          <div>
            <h1>{tx('মৌজা ব্যবস্থাপনা')}</h1>
            <p>{tx('সমিতির সব মৌজা পরিচালনা করুন। মৌজা যোগ, সম্পাদনা, বিস্তারিত দেখা এবং সংশ্লিষ্ট কৃষক ও জমির রেকর্ড দেখা যাবে।')}</p>
          </div>
          <div className="fl-head-btns">
            {can('mouza.create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm('new')}>
                {tx('মৌজা যোগ করুন')}
              </Button>
            )}
            <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [{ key: 'excel', label: tx('Excel (CSV)'), onClick: exportCsv }] }}>
              <Button icon={<DownloadOutlined />}>
                {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <div className="fl-stats ml-stats pl-stats">
          {cards.map((c) => (
            <div key={c.key} className="fl-stat mz-stat" style={{ ['--tint' as string]: c.tint }}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-value">
                  {c.value}
                  {c.unit && <small className="mz-unit">{c.unit}</small>}
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="dl-filters pl-filters">
          <div className="fl-field dl-search">
            <span className="ml-hidden">.</span>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('মৌজার নাম বা কোড দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={apply} />
          </div>
          <div className="fl-field">
            <span>{tx('জেলা')}</span>
            <Select
              value={draft.district_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(s?.districts ?? []).map((d) => ({ value: d.id, label: d.name_bn }))]}
              onChange={(v) => setDraft((d) => ({ ...d, district_id: v === '' ? undefined : Number(v), upazila_id: undefined }))}
            />
          </div>
          <div className="fl-field">
            <span>{tx('উপজেলা')}</span>
            <Select
              value={draft.upazila_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...upazilaOptions.map((u) => ({ value: u.id, label: u.name_bn }))]}
              onChange={(v) => setDraft((d) => ({ ...d, upazila_id: v === '' ? undefined : Number(v) }))}
            />
          </div>
          <div className="fl-field">
            <span>{tx('পাটোয়ারী')}</span>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.patwari_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(s?.patwaris ?? []).map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => setDraft((d) => ({ ...d, patwari_id: v === '' ? undefined : Number(v) }))}
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
            <h3>{tx('মৌজা তালিকা ({{p0}})', { p0: n0(total) })}</h3>
            <div className="vl-tools">
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
              <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" loading={printing} onClick={print}>
                {tx('প্রিন্ট')}
              </Button>
            </div>
          </div>
          <Table<Row>
            className="fl-table ml-table pl-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1150 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            columns={columns}
            locale={{ emptyText: tx('কোনো মৌজা নেই') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি মৌজা', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
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
              {tx('প্রতি পাতায় সারি')} <Select value={params.per_page} className="fl-size" options={[10, 25, 50, 100].map((n) => ({ value: n, label: digits(n) }))} onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))} />
            </span>
          </div>
        </div>

        <Modal open={!!editing} title={editing === 'new' ? tx('নতুন মৌজা') : tx('মৌজা সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')} forceRender width={640}>
          <Form form={form} layout="vertical">
            <Form.Item label={tx('এলাকা (ইউনিয়ন পর্যন্ত)')} required>
              <LocationCascader
                depth={4}
                value={formPath}
                onChange={(v) => {
                  setFormPath(v)
                  form.setFieldValue('village_ids', [])
                }}
              />
            </Form.Item>
            <Form.Item name="name_bn" label={tx('মৌজার নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
              <Input />
            </Form.Item>
            <Form.Item name="name_en" label={tx('মৌজার নাম (ইংরেজি)')}>
              <Input />
            </Form.Item>
            <Form.Item name="jl_no" label={tx('JL নম্বর / মৌজা কোড')} rules={[required(tx('JL নম্বর দিন'))]}>
              <Input style={{ maxWidth: 200 }} />
            </Form.Item>
            <Form.Item name="village_ids" label={tx('অন্তর্ভুক্ত গ্রাম')}>
              <Select
                mode="multiple"
                disabled={!unionId}
                placeholder={unionId ? tx('গ্রাম বাছাই করুন') : tx('আগে ইউনিয়ন বাছাই করুন')}
                options={villages.data?.map((v) => ({ value: v.id, label: v.name_bn }))}
                showSearch={{ optionFilterProp: 'label' }}
              />
            </Form.Item>
            <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
              <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
            </Form.Item>
          </Form>
        </Modal>

        <Drawer open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${nameOf(viewing)} (JL ${digits(viewing.jl_no)})` : ''} size={480}>
          {viewing && (
            <>
              <Descriptions size="small" column={1} bordered className="pl-desc">
                <Descriptions.Item label={tx('জেলা')}>{viewing.district ?? '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('উপজেলা')}>{viewing.upazila?.name_bn ?? '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('ইউনিয়ন')}>{viewing.union?.name_bn ?? '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('গ্রাম')}>
                  {viewing.villages?.map((v) => (
                    <Tag key={v.id}>{v.name_bn}</Tag>
                  ))}
                </Descriptions.Item>
                <Descriptions.Item label={tx('পাটোয়ারী')}>{viewing.patwari ?? '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('মোট কৃষক')}>{n0(viewing.farmers_count)}</Descriptions.Item>
                <Descriptions.Item label={tx('মোট জমির রেকর্ড')}>{n0(viewing.lands_count)}</Descriptions.Item>
                <Descriptions.Item label={tx('মোট জমির পরিমাণ (একর)')}>{acres(viewing.land_acre)}</Descriptions.Item>
                <Descriptions.Item label={tx('অবস্থা')}>{viewing.is_active ? tx('সক্রিয়') : tx('নিষ্ক্রিয়')}</Descriptions.Item>
              </Descriptions>
              {can('mouza.edit') && (
                <Button
                  icon={<EditOutlined />}
                  onClick={() => {
                    const m = viewing
                    setViewing(null)
                    openForm(m)
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
