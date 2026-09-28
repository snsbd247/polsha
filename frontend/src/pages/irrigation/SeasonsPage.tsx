import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Input, Modal, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, ClockCircleOutlined, CloseOutlined, DeleteFilled, DownloadOutlined, EditFilled, EyeFilled, PlusOutlined, PrinterOutlined, SearchOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import type { Season } from '../../lib/irrigation'
import { t as tx } from '../../lib/i18n'
import { download } from '../../lib/reports'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './seasons.css'

type Data = { data: Season[]; statuses: Record<string, string>; types: Record<string, string>; current: { id: number; name_bn: string } | null }
type Filters = { search?: string; type?: string; status?: string; from?: number; to?: number }

// tag colours as in the approved design
export const SEASON_TYPE_TONE: Record<string, string> = { rabi: 'll-blue', kharif: 'll-green', summer: 'll-orange', other: 'll-gray' }
export const SEASON_STATUS_TONE: Record<string, string> = { open: 'fl-tag-green', planned: 'll-blue', closed: 'fl-tag-red' }
const month = (d: string) => new Date(d + 'T00:00:00').toLocaleString(document.documentElement.lang === 'en' ? 'en' : 'bn-BD', { month: 'short' })

/** Seasons: the time windows irrigation is billed in. */
export default function SeasonsPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [years, setYears] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [selected, setSelected] = useState<number[]>([])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const { data, isFetching } = useQuery({ queryKey: ['seasons'], queryFn: async () => (await api.get<Data>('/seasons')).data })
  const all = useMemo(() => data?.data ?? [], [data])
  const rows = all.filter(
    (s) =>
      (!filters.search || `${s.name_bn} ${s.code ?? ''} ${s.crop ?? ''}`.toLowerCase().includes(filters.search.toLowerCase())) &&
      (!filters.type || s.type === filters.type) &&
      (!filters.status || s.status === filters.status) &&
      (!filters.from || Number(s.start_date.slice(0, 4)) >= filters.from) &&
      (!filters.to || Number(s.start_date.slice(0, 4)) <= filters.to),
  )
  const shown = rows.slice((page - 1) * perPage, page * perPage)
  const from = rows.length ? (page - 1) * perPage + 1 : 0
  const canEdit = can('irrigation.edit')

  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setYears({})
    setPage(1)
  }
  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = [tx('মৌসুমের নাম'), tx('মৌসুমের কোড'), tx('ধরন'), tx('শুরুর তারিখ'), tx('শেষের তারিখ'), tx('অবস্থা'), tx('ইনভয়েস')]
    const lines = rows.map((s) => [s.name_bn, s.code, data?.types[s.type ?? ''] ?? s.type, s.start_date, s.end_date, data?.statuses[s.status], s.invoice_count].map(q).join(','))
    // BOM so Excel reads Bangla
    download(new Blob(['﻿' + [head.map(q).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'seasons.csv')
  }
  const remove = (s: Season) =>
    Modal.confirm({
      title: tx('"{{p0}}" মুছে ফেলবেন?', { p0: s.name_bn }),
      content: s.invoice_count ? tx('এই মৌসুমে ইনভয়েস বা রেট আছে; মুছে না ফেলে বন্ধ করুন।') : tx('এই মৌসুমে কোনো ইনভয়েস নেই।'),
      okText: tx('মুছে ফেলুন'),
      okButtonProps: { danger: true, disabled: s.invoice_count > 0 },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const r = await api.delete(`/seasons/${s.id}`)
          message.success(r.data.message)
          queryClient.invalidateQueries({ queryKey: ['seasons'] })
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const cards = [
    { key: 'total', label: tx('মোট মৌসুম'), value: data ? all.length : undefined, icon: 'sprout', color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({}) },
    { key: 'open', label: tx('চলমান মৌসুম'), value: data ? all.filter((s) => s.status === 'open').length : undefined, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'open' }) },
    { key: 'closed', label: tx('বন্ধ মৌসুম'), value: data ? all.filter((s) => s.status === 'closed').length : undefined, icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'closed' }) },
    {
      key: 'current',
      label: tx('বর্তমান মৌসুম'),
      value: data ? (data.current?.name_bn ?? '—') : undefined,
      icon: '',
      solid: <ClockCircleOutlined />,
      color: '#f5a524',
      tint: '#fdefd6',
      onClick: data?.current ? () => navigate(`/irrigation/seasons/${data.current!.id}`) : undefined,
    },
  ]

  const columns: ColumnsType<Season> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('মৌসুমের নাম'),
      dataIndex: 'name_bn',
      render: (v, s) => (
        <button type="button" className="lt-name" onClick={() => navigate(`/irrigation/seasons/${s.id}`)}>
          {v}
        </button>
      ),
    },
    { title: tx('মৌসুমের কোড'), dataIndex: 'code', render: (v) => v ?? '—' },
    { title: tx('ধরন'), dataIndex: 'type', render: (v: string | null) => (v ? <Tag className={`fl-tag ${SEASON_TYPE_TONE[v] ?? 'll-gray'}`}>{data?.types[v] ?? v}</Tag> : '—') },
    { title: tx('শুরুর মাস'), dataIndex: 'start_date', render: (v: string) => <span title={fmtDate(v)}>{month(v)}</span> },
    { title: tx('শেষের মাস'), dataIndex: 'end_date', render: (v: string) => <span title={fmtDate(v)}>{month(v)}</span> },
    { title: tx('বিবরণ'), dataIndex: 'remarks', className: 'lt-desc', render: (v, s) => v || s.crop || '—' },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag ${SEASON_STATUS_TONE[v] ?? 'll-gray'}`}>{data?.statuses[v] ?? v}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      render: (_, s) => (
        <div className="mg-actions lt-actions">
          <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/irrigation/seasons/${s.id}`)} />
          {canEdit && (
            <>
              <Button type="text" className="mg-view" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => navigate(`/irrigation/seasons/${s.id}/edit`)} />
              <Button type="text" className="mg-view lt-del" icon={<DeleteFilled />} aria-label={tx('মুছুন')} disabled={s.invoice_count > 0} onClick={() => remove(s)} />
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tx('মৌসুমের তালিকা')}
      subtitle={tx('কৃষি মৌসুম পরিচালনা করুন। সেচের রেট, ইনভয়েস ও চাষের রেকর্ডে এই মৌসুমগুলো ব্যবহার হয়।')}
      actions={
        canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/irrigation/seasons/new')}>
            {tx('নতুন মৌসুম')}
          </Button>
        )
      }
      cards={cards}
      statsClass="sn-stats"
      filterClass="sn-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={370}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('মৌসুমের নাম বা কোড দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => setFilters(draft)}
            />
          </Field>
          <Field label={tx('ধরন')}>
            <Select value={draft.type ?? ''} options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.types ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.status ?? ''} options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.statuses ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))} />
          </Field>
          <Field label={tx('সাল (থেকে)')}>
            <DatePicker picker="year" placeholder="yyyy" value={years.from ?? null} onChange={(d) => setYears((y) => ({ ...y, from: d }))} style={{ width: '100%' }} />
          </Field>
          <Field label={tx('সাল (পর্যন্ত)')}>
            <DatePicker picker="year" placeholder="yyyy" value={years.to ?? null} onChange={(d) => setYears((y) => ({ ...y, to: d }))} style={{ width: '100%' }} />
          </Field>
        </>
      }
      onSearch={() => {
        setFilters({ ...draft, from: years.from?.year(), to: years.to?.year() })
        setPage(1)
      }}
      onReset={() => show({})}
      tableTitle={tx('মৌসুমের তালিকা ({{p0}})', { p0: n0(rows.length) })}
      tableTools={
        <>
          <Button icon={<DownloadOutlined />} className="ml-columns pl-columns" onClick={exportCsv}>
            {tx('এক্সপোর্ট')}
          </Button>
          <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
        </>
      }
      paging={{
        page,
        perPage,
        total: rows.length,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, rows.length)), p2: n0(rows.length) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Season>
        className="fl-table ml-table pl-table lt-table sn-table"
        rowKey="id"
        loading={isFetching}
        dataSource={shown}
        pagination={false}
        scroll={{ x: 'max-content' }}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('এখনো কোনো মৌসুম নেই') }}
      />
    </ListFrame>
  )
}
