import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, ConfigProvider, DatePicker, Dropdown, Form, Input, Modal, Pagination, Select, Table, Tag, Tooltip } from 'antd'
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
  PrinterOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport, MEMBER_STATUS, toOptions, useFarmerMeta, type MemberStatus } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { usePublicSettings } from '../../lib/settings'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../farmers/farmer-list.css'
import './member-list.css'
import PageTabs from '../../components/PageTabs'

type ListRef = { id: number; title: string; cutoff_date: string; eligible_count: number; ineligible_count: number }
type Row = {
  id: number
  serial: number | null
  member_id: number
  member_no: number
  name: string
  name_en: string | null
  father_name: string
  village: string | null
  eligible: boolean
  reason: string | null
  member_status: MemberStatus
  admitted_on: string
  farmer_id: number
  mobile: string | null
  nid: string | null
  mouza: string | null
  education_level: string | null
  occupation: string | null
  photo_url: string | null
}
type Resp = {
  list: ListRef | null
  previous: { id: number; title: string; cutoff_date: string } | null
  lists: ListRef[]
  summary: { total: number; eligible: number; excluded: number; new: number; change: Record<'total' | 'eligible' | 'excluded' | 'new', number | null> } | null
  items: Paginated<Row>
}
type Filters = { search?: string; eligible?: string; member_status?: string; mouza_id?: number; education_level?: string; occupation?: string; from?: string; to?: string }
type Params = Filters & { page: number; per_page: number; list_id?: number }
type PrintItem = { serial: number | null; member_no: number; name: string; father_name: string; village: string | null }

const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const initials = (name: string) =>
  name
    .replace(/^(Md\.|Mst\.|মোঃ|মোছাঃ)\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default function VoterListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const { data: settings } = usePublicSettings()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['voters', params],
    queryFn: async () => (await api.get<Resp>('/voters', { params })).data,
    placeholderData: keepPreviousData,
  })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const list = data?.list ?? null
  const rows = useMemo(() => data?.items.data ?? [], [data])
  const total = data?.items.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / params.per_page))
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)

  const apply = () => setParams((p) => ({ page: 1, per_page: p.per_page, list_id: p.list_id, ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') }))
  const reset = () => {
    setDraft({})
    setRange(null)
    setParams((p) => ({ page: 1, per_page: p.per_page, list_id: p.list_id }))
  }
  const exportCsv = (eligible: '1' | '0') => list && downloadExport(`/voter-lists/${list.id}/export`, { eligible }, eligible === '1' ? 'voters.csv' : 'voter-audit.csv').catch((e) => message.error(errorMessage(e)))

  /** Printable voter list with a signature column, as used at the meeting. */
  const print = async () => {
    if (!list) return
    setPrinting(true)
    try {
      const r = await api.get<{ items: Paginated<PrintItem> }>(`/voter-lists/${list.id}`, { params: { eligible: 1, per_page: 10000 } })
      const w = window.open('', '_blank', 'width=900,height=700')
      if (!w) return
      const body = r.data.items.data.map((i) => `<tr><td>${esc(digits(i.serial))}</td><td>${esc(digits(i.member_no))}</td><td>${esc(i.name)}</td><td>${esc(i.father_name)}</td><td>${esc(i.village)}</td><td></td></tr>`).join('')
      w.document.write(
        `<html><head><title>${esc(list.title)}</title><style>body{font-family:sans-serif;margin:16px}h2,h3,p{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th,td{border:1px solid #444;padding:5px 6px;text-align:left}td:last-child{width:130px}</style></head><body>` +
          `<h2>${esc(nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }))}</h2><h3>${esc(list.title)}</h3><p>${esc(tx('কাট-অফ তারিখ'))}: ${esc(fmtDate(list.cutoff_date))} · ${esc(tx('মোট ভোটার'))}: ${esc(digits(list.eligible_count))}</p>` +
          `<table><thead><tr><th>${esc(tx('ক্রমিক'))}</th><th>${esc(tx('সদস্য নং'))}</th><th>${esc(tx('নাম'))}</th><th>${esc(tx('পিতা'))}</th><th>${esc(tx('গ্রাম'))}</th><th>${esc(tx('স্বাক্ষর'))}</th></tr></thead><tbody>${body}</tbody></table></body></html>`,
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

  const create = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      const r = await api.post<ListRef>('/voter-lists', { title: v.title, cutoff_date: (v.cutoff_date as Dayjs).format('YYYY-MM-DD') })
      message.success(tx('ভোটার তালিকা তৈরি হয়েছে।'))
      setCreating(false)
      queryClient.invalidateQueries({ queryKey: ['voters'] })
      setParams((p) => ({ page: 1, per_page: p.per_page, list_id: r.data.id }))
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const s = data?.summary
  const since = data?.previous ? tx('আগের তালিকার তুলনায়') : ''
  const cards = [
    { key: 'total', label: tx('মোট ভোটার'), value: s?.total, change: s?.change.total, icon: 'users', color: '#2563eb', tint: '#e4edfd', caption: since, filter: {} },
    { key: 'eligible', label: tx('সক্রিয় ভোটার'), value: s?.eligible, change: s?.change.eligible, icon: 'userCheck', color: '#1f9d55', tint: '#e3f5ea', caption: since, filter: { eligible: '1' } },
    { key: 'excluded', label: tx('নিষ্ক্রিয় ভোটার'), value: s?.excluded, change: s?.change.excluded, icon: 'userX', color: '#e0383e', tint: '#fde6e7', caption: since, filter: { eligible: '0' }, upIsBad: true },
    { key: 'new', label: tx('নতুন ভোটার'), value: s?.new, change: s?.change.new, icon: 'userPlus', color: '#6d4ae6', tint: '#ece7fc', caption: tx('এই তালিকায়'), filter: {} },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      key: 'photo',
      title: tx('ছবি'),
      width: 58,
      render: (_, r) => (r.photo_url ? <ProtectedImage url={r.photo_url} size={34} shape="square" /> : <span className="ml-initials">{initials(nameOf({ name_bn: r.name, name_en: r.name_en }))}</span>),
    },
    { key: 'serial', title: tx('ভোটার নং'), dataIndex: 'serial', width: 92, render: (v) => (v ? <span className="fl-link">{digits(v)}</span> : '—') },
    {
      key: 'name',
      title: tx('ভোটারের নাম'),
      render: (_, r) => (
        <Link to={`/farmers/${r.farmer_id}`} className="fl-name">
          {nameOf({ name_bn: r.name, name_en: r.name_en })}
        </Link>
      ),
    },
    { key: 'father', title: tx('পিতার নাম'), dataIndex: 'father_name' },
    { key: 'mobile', title: tx('মোবাইল'), dataIndex: 'mobile', render: (v) => digits(v) || '—' },
    { key: 'nid', title: 'NID', dataIndex: 'nid', render: (v) => digits(v) || '—' },
    { key: 'mouza', title: tx('মৌজা'), dataIndex: 'mouza', render: (v) => v ?? '—' },
    { key: 'joined', title: tx('যোগদানের তারিখ'), dataIndex: 'admitted_on', render: fmtDate },
    {
      key: 'status',
      title: tx('অবস্থা'),
      render: (_, r) =>
        r.eligible ? (
          <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag>
        ) : (
          <Tooltip title={r.reason}>
            <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>
          </Tooltip>
        ),
    },
    {
      key: 'member_status',
      title: tx('সদস্যপদের অবস্থা'),
      render: (_, r) => <Tag className={`fl-tag ${r.member_status === 'active' ? 'fl-tag-green' : r.member_status === 'inactive' ? 'fl-tag-orange' : 'ml-tag-gray'}`}>{MEMBER_STATUS[r.member_status]?.label}</Tag>,
    },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 128,
      render: (_, r) => (
        <div className="fl-actions">
          <Button className="fl-act fl-act-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/farmers/${r.farmer_id}`)} />
          <Button className="fl-act fl-act-view" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!can('farmer.edit')} onClick={() => navigate(`/farmers/${r.farmer_id}/edit`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'profile', icon: <IdcardOutlined />, label: tx('প্রোফাইল'), onClick: () => navigate(`/farmers/${r.farmer_id}`) },
                { key: 'members', label: tx('সদস্য তালিকায় দেখুন'), onClick: () => navigate('/members') },
                ...(!r.eligible && r.reason ? [{ key: 'reason', label: tx('বাদ পড়ার কারণ: {{p0}}', { p0: r.reason }), disabled: true }] : []),
              ],
            }}
          >
            <Button className="fl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
          </Dropdown>
        </div>
      ),
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  const exportItems = [
    can('member.export') && { key: 'voters', label: tx('ভোটার তালিকা (Excel)'), onClick: () => exportCsv('1') },
    can('member.export') && { key: 'audit', label: tx('বাদ পড়াদের তালিকা (Excel)'), onClick: () => exportCsv('0') },
    { key: 'print', label: tx('স্বাক্ষরসহ তালিকা প্রিন্ট'), onClick: print },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml vl">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('ভোটার তালিকা')}</span>
        </nav>
        <PageTabs />

        <div className="fl-head">
          <div>
            <h1>{tx('ভোটার তালিকা')}</h1>
            <p>{tx('সমবায় সমিতির সব ভোটার দেখুন ও পরিচালনা করুন। খোঁজা, ফিল্টার ও দ্রুত কাজ করা যাবে।')}</p>
          </div>
          <div className="fl-head-btns">
            {can('member.admin') && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  form.setFieldsValue({ title: tx('বার্ষিক সাধারণ সভা {{p0}}', { p0: digits(dayjs().format('YYYY')) }), cutoff_date: dayjs() })
                  setCreating(true)
                }}
              >
                {tx('নতুন ভোটার তালিকা')}
              </Button>
            )}
            <Dropdown menu={{ items: exportItems }} trigger={['click']} placement="bottomRight" disabled={!list}>
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
              <button key={c.key} type="button" className="fl-stat" style={{ ['--tint' as string]: c.tint }} onClick={() => setParams((p) => ({ page: 1, per_page: p.per_page, list_id: p.list_id, ...c.filter }))}>
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

        <div className="fl-card fl-filters vl-filters">
          <div className="vl-search-row">
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('ভোটারের নাম, সদস্য নং, NID, মোবাইল, পিতার নাম দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
            {data && data.lists.length > 0 && (
              <Select
                className="vl-list-pick"
                value={list?.id}
                onChange={(id) => setParams((p) => ({ page: 1, per_page: p.per_page, list_id: id }))}
                options={data.lists.map((l) => ({ value: l.id, label: `${l.title} · ${fmtDate(l.cutoff_date)}` }))}
              />
            )}
          </div>
          <div className="fl-filter-row">
            <div className="fl-field">
              <span>{tx('ভোটারের অবস্থা')}</span>
              <Select
                value={draft.eligible ?? ''}
                options={[
                  { value: '', label: tx('সকল') },
                  { value: '1', label: tx('সক্রিয়') },
                  { value: '0', label: tx('নিষ্ক্রিয়') },
                ]}
                onChange={(v) => setDraft((d) => ({ ...d, eligible: v || undefined }))}
              />
            </div>
            <div className="fl-field">
              <span>{tx('সদস্যপদের অবস্থা')}</span>
              <Select
                value={draft.member_status ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...Object.entries(MEMBER_STATUS).map(([value, st]) => ({ value, label: st.label }))]}
                onChange={(v) => setDraft((d) => ({ ...d, member_status: v || undefined }))}
              />
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
              <span>{tx('শিক্ষাগত যোগ্যতা')}</span>
              <Select value={draft.education_level ?? ''} options={[{ value: '', label: tx('সকল') }, ...toOptions(meta?.education_levels)]} onChange={(v) => setDraft((d) => ({ ...d, education_level: v || undefined }))} />
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
            <h3>{tx('ভোটার তালিকা ({{p0}})', { p0: n0(total) })}</h3>
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
                <Button icon={<InsertRowRightOutlined />} className="ml-columns">
                  {tx('কলাম')} <DownOutlined className="fl-caret" />
                </Button>
              </Dropdown>
              <Button icon={<PrinterOutlined />} className="ml-columns" loading={printing} disabled={!list} onClick={print}>
                {tx('প্রিন্ট')}
              </Button>
            </div>
          </div>
          <Table<Row>
            className="fl-table ml-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1200 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            columns={columns}
            locale={{ emptyText: list ? tx('কোনো ভোটার নেই') : tx('এখনো কোনো ভোটার তালিকা তৈরি হয়নি') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}} জন ভোটার', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
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
              {tx('প্রতি পাতায় সারি')} <Select value={params.per_page} className="fl-size" options={[10, 25, 50, 100].map((v) => ({ value: v, label: digits(v) }))} onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))} />
            </span>
          </div>
        </div>

        <Modal open={creating} title={tx('নতুন ভোটার তালিকা')} forceRender onCancel={() => setCreating(false)} onOk={create} confirmLoading={saving} okText={tx('তৈরি করুন')} cancelText={tx('বাতিল')}>
          <p className="vl-note">{tx('কাট-অফ তারিখে যারা সক্রিয় সদস্য, তারা সবাই ভোটার। তালিকা তৈরির সময়ের তথ্য স্থায়ীভাবে সংরক্ষিত থাকে — পরে কারো তথ্য বদলালেও ছাপা তালিকা বদলাবে না।')}</p>
          <Form form={form} layout="vertical">
            <Form.Item name="title" label={tx('শিরোনাম')} rules={[required(tx('শিরোনাম দিন'))]}>
              <Input />
            </Form.Item>
            <Form.Item name="cutoff_date" label={tx('কাট-অফ তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </ConfigProvider>
  )
}
