import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, ConfigProvider, DatePicker, Dropdown, Input, Modal, Pagination, Popconfirm, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, DoubleLeftOutlined, DoubleRightOutlined, DownloadOutlined, DownOutlined, HomeOutlined, RightOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport, toOptions, useFarmerMeta } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import './farmer-list.css'
import '../membership/member-list.css'
import './deleted-farmers.css'
import PageTabs from '../../components/PageTabs'

type Named = { id: number; name_bn: string; name_en: string | null } | null
type Row = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string | null
  mobile: string | null
  nid: string | null
  deleted_at: string | null
  removed_at: string | null
  mouza: Named
  deleted_by: Named
  reason_code: string | null
  reason: string | null
  merged_into: { id: number; farmer_code: string; name_bn: string } | null
  photo_url: string | null
}
type Summary = { total: number; restored: number; purged: number; this_month: number; users: { id: number; name_bn: string; name_en: string | null }[] }
type Filters = { search?: string; deleted_by?: number; mouza_id?: number; reason?: string; from?: string; to?: string }
type Params = Filters & { page: number; per_page: number }

const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const REASON_TONE: Record<string, string> = { duplicate: 'dl-gold', wrong_data: 'dl-red', not_farmer: 'dl-purple', merged: 'dl-green', other: 'ml-tag-gray' }
const initials = (name: string) =>
  name
    .replace(/^(Md\.|Mst\.|মোঃ|মোছাঃ)\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

/** Deleted and merged-away farmers with who removed them and why; restore brings a deleted record back. */
export default function DeletedFarmersPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selected, setSelected] = useState<number[]>([])

  const { data, isFetching } = useQuery({
    queryKey: ['farmers-deleted', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/farmers-deleted', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['farmers-deleted', 'summary'], queryFn: async () => (await api.get<Summary>('/farmers-deleted/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / params.per_page))
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)
  const s = summary.data

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['farmers-deleted'] })
    queryClient.invalidateQueries({ queryKey: ['farmers'] })
  }
  const apply = () => setParams((p) => ({ page: 1, per_page: p.per_page, ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') }))
  const reset = () => {
    setDraft({})
    setRange(null)
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }
  const restore = async (f: Row) => {
    try {
      const r = await api.post(`/farmers/${f.id}/restore`)
      message.success(r.data.message)
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const purge = (f: Row) =>
    Modal.confirm({
      title: tx('স্থায়ীভাবে মুছবেন?'),
      content: tx('{{p0}} ({{p1}}) চিরতরে মুছে যাবে, আর পুনরুদ্ধার করা যাবে না।', { p0: nameOf(f), p1: f.farmer_code }),
      okText: tx('স্থায়ীভাবে মুছুন'),
      okButtonProps: { danger: true },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const r = await api.delete(`/farmers-deleted/${f.id}`)
          message.success(r.data.message)
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })
  const exportCsv = () => downloadExport('/farmers-deleted', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'deleted-farmers.csv').catch((e) => message.error(errorMessage(e)))

  const cards = [
    { key: 'total', label: tx('মোট মুছে ফেলা কৃষক'), value: s?.total, icon: 'trash', color: '#e0383e', tint: '#fde6e7', bg: '#fff8f8', onClick: reset },
    { key: 'restored', label: tx('পুনরুদ্ধার করা কৃষক'), value: s?.restored, icon: 'restore', color: '#1f9d55', tint: '#dff3e6', bg: '#f6fcf8' },
    { key: 'purged', label: tx('স্থায়ীভাবে মুছে ফেলা'), value: s?.purged, icon: 'trash', color: '#e0383e', tint: '#fde6e7', bg: '#fff8f8' },
    { key: 'month', label: tx('এই মাসে মুছে ফেলা'), value: s?.this_month, icon: 'calendar', color: '#2563eb', tint: '#e4edfd', bg: '#f8faff' },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('ছবি'),
      width: 58,
      render: (_, r) => (r.photo_url ? <ProtectedImage url={r.photo_url} size={34} shape="square" /> : <span className="ml-initials">{initials(nameOf(r))}</span>),
    },
    { title: tx('কৃষক নং'), dataIndex: 'farmer_code', width: 92, render: (v) => <span className="fl-link">{v}</span> },
    { title: tx('কৃষকের নাম'), render: (_, r) => <span className="fl-name">{nameOf(r)}</span> },
    { title: tx('পিতার নাম'), dataIndex: 'father_name', render: (v) => v || '—' },
    { title: tx('মোবাইল'), dataIndex: 'mobile', render: (v) => digits(v) || '—' },
    { title: 'NID', dataIndex: 'nid', render: (v) => digits(v) || '—' },
    { title: tx('মৌজা'), render: (_, r) => nameOf(r.mouza) || '—' },
    { title: tx('মুছার তারিখ'), dataIndex: 'removed_at', render: (v, r) => fmtDate(v ?? r.deleted_at) },
    { title: tx('মুছেছেন'), render: (_, r) => nameOf(r.deleted_by) || '—' },
    {
      title: tx('কারণ'),
      render: (_, r) => {
        const code = r.reason_code ?? 'other'
        const tag = <Tag className={`fl-tag ${REASON_TONE[code] ?? 'ml-tag-gray'}`}>{meta?.delete_reasons[code] ?? code}</Tag>
        const tip = r.merged_into ? tx('{{p0}}-এর সাথে মার্জ হয়েছে', { p0: r.merged_into.farmer_code }) : r.reason
        return tip ? <Tooltip title={tip}>{tag}</Tooltip> : tag
      },
    },
    {
      title: tx('অ্যাকশন'),
      width: 100,
      align: 'center',
      render: (_, r) =>
        r.merged_into ? (
          <Link to={`/farmers/${r.merged_into.id}`} className="dl-merged-link">
            {r.merged_into.farmer_code}
          </Link>
        ) : (
          <div className="fl-actions dl-actions">
            <Popconfirm title={tx('এই কৃষককে পুনরুদ্ধার করবেন?')} disabled={!can('farmer.delete')} onConfirm={() => restore(r)}>
              <Tooltip title={tx('পুনরুদ্ধার')}>
                <Button className="fl-act dl-restore" icon={<SyncOutlined />} aria-label={tx('পুনরুদ্ধার')} disabled={!can('farmer.delete')} />
              </Tooltip>
            </Popconfirm>
            <Tooltip title={tx('স্থায়ীভাবে মুছুন')}>
              <Button className="fl-act dl-purge" icon={<DeleteOutlined />} aria-label={tx('স্থায়ীভাবে মুছুন')} disabled={!can('farmer.delete')} onClick={() => purge(r)} />
            </Tooltip>
          </div>
        ),
    },
  ]

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml dl">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('মুছে ফেলা কৃষক')}</span>
        </nav>
        <PageTabs />

        <div className="fl-head">
          <div>
            <h1>{tx('মুছে ফেলা কৃষক')}</h1>
            <p>{tx('সিস্টেম থেকে মুছে ফেলা কৃষকদের তালিকা। বিস্তারিত দেখা ও প্রয়োজনে পুনরুদ্ধার করা যাবে।')}</p>
          </div>
          <div className="fl-head-btns">
            <Dropdown trigger={['click']} placement="bottomRight" disabled={!can('farmer.export')} menu={{ items: [{ key: 'excel', label: tx('Excel (CSV)'), onClick: exportCsv }] }}>
              <Button icon={<DownloadOutlined />}>
                {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <div className="fl-stats ml-stats dl-stats">
          {cards.map((c) => (
            <button key={c.key} type="button" className="fl-stat" style={{ background: c.bg }} onClick={c.onClick}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                <DashIcon name={c.icon} size={28} color={c.color} stroke={2.1} />
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-value">{c.value === undefined ? '—' : n0(c.value)}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="dl-filters">
          <div className="fl-field dl-search">
            <span className="ml-hidden">.</span>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('নাম, মোবাইল, NID, কৃষক নং দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </div>
          <div className="fl-field ml-range">
            <span>{tx('মুছার তারিখের পরিসর')}</span>
            <DatePicker.RangePicker format="DD-MM-YYYY" value={range} onChange={(r) => setRange(r as [Dayjs | null, Dayjs | null] | null)} placeholder={[tx('শুরু'), tx('শেষ')]} />
          </div>
          <div className="fl-field">
            <span>{tx('মুছেছেন')}</span>
            <Select
              value={draft.deleted_by ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(s?.users ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, deleted_by: v === '' ? undefined : Number(v) }))}
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
            <span>{tx('মুছার কারণ')}</span>
            <Select value={draft.reason ?? ''} options={[{ value: '', label: tx('সকল') }, ...toOptions(meta?.delete_reasons)]} onChange={(v) => setDraft((d) => ({ ...d, reason: v || undefined }))} />
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
            <h3>{tx('মুছে ফেলা কৃষক ({{p0}})', { p0: n0(total) })}</h3>
          </div>
          <Table<Row>
            className="fl-table ml-table dl-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1200 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            columns={columns}
            locale={{ emptyText: tx('কোনো মুছে ফেলা কৃষক নেই') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}} জন মুছে ফেলা কৃষক', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
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
      </div>
    </ConfigProvider>
  )
}
