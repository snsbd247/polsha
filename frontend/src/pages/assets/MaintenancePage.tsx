import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Grid, Input, Popconfirm, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarFilled, CheckOutlined, CheckCircleFilled, CloseOutlined, ClockCircleFilled, EyeFilled, PlusOutlined, SearchOutlined, StopOutlined, WarningFilled } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { MAINT_TONE, useAssetMeta } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import { AssetPickModal, CompleteModal, LIVE, ScheduleModal, journalLink, type AssetLike, type Maintenance } from './AssetModals'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../irrigation/rates.css'
import '../approvals/approvals.css'

type Row = Maintenance & { asset: { id: number; asset_code: string; name_bn: string; name_en: string | null; location: string | null } }
type View = 'due' | 'overdue' | 'd30' | 'done' | 'cancelled'
type Resp = Paginated<Row> & { counts: { scheduled: number; overdue: number; due_30: number; done_year: number; cost_year: number; done: number; cancelled: number } }
type Filters = { search?: string; kind?: string }

/** Repair schedule: service/repair jobs across all assets, what is late or due soon, and the done log. */
export default function MaintenancePage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const meta = useAssetMeta()
  const [view, setView] = useState<View>('due')
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [completing, setCompleting] = useState<Maintenance | null>(null)
  const [picking, setPicking] = useState(false)
  const [scheduling, setScheduling] = useState<AssetLike | null>(null)

  const params = {
    page,
    per_page: perPage,
    status: view === 'done' || view === 'cancelled' ? view : 'scheduled',
    overdue: view === 'overdue' ? 1 : undefined,
    within_days: view === 'd30' ? 30 : undefined,
    ...filters,
  }
  const { data, isFetching } = useQuery({
    queryKey: ['asset-maintenances', params],
    queryFn: async () => (await api.get<Resp>('/assets/maintenances', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const today = dayjs().format('YYYY-MM-DD')
  const open = (v: View) => {
    setView(v)
    setPage(1)
  }
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-maintenances'] })
    queryClient.invalidateQueries({ queryKey: ['asset-dashboard'] })
  }
  const cancel = async (m: Row) => {
    try {
      await api.post(`/assets/maintenances/${m.id}/cancel`)
      message.success(tx('বাতিল হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const cards = [
    { key: 'due', label: tx('নির্ধারিত কাজ'), value: c?.scheduled, icon: '', glyph: <ClockCircleFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => open('due') },
    { key: 'overdue', label: tx('মেয়াদোত্তীর্ণ'), value: c?.overdue, icon: '', glyph: <WarningFilled />, color: '#e5383b', tint: '#fde4e5', onClick: () => open('overdue') },
    { key: 'd30', label: tx('৩০ দিনের মধ্যে'), value: c?.due_30, icon: '', glyph: <CalendarFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => open('d30') },
    { key: 'done', label: tx('এ বছর সম্পন্ন · খরচ ৳{{p0}}', { p0: money(c?.cost_year ?? 0) }), value: c?.done_year, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => open('done') },
  ]
  const tabs: { key: View; label: string; count?: number }[] = [
    { key: 'due', label: tx('সব নির্ধারিত'), count: c?.scheduled },
    { key: 'overdue', label: tx('মেয়াদোত্তীর্ণ'), count: c?.overdue },
    { key: 'd30', label: tx('৩০ দিনের মধ্যে'), count: c?.due_30 },
    { key: 'done', label: tx('সম্পন্ন'), count: c?.done },
    { key: 'cancelled', label: tx('বাতিল'), count: c?.cancelled },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('নির্ধারিত তারিখ'),
      dataIndex: 'due_on',
      render: (v: string | null, m) => (v && m.status === 'scheduled' && v < today ? <Tag className="fl-tag fl-tag-red">{fmtDate(v)}</Tag> : fmtDate(v) || '—'),
    },
    {
      title: tx('সম্পদ'),
      render: (_, m) => (
        <span className="hs-two">
          <Link to={`/assets/${m.asset.id}`} className="mg-name">
            {nameOf(m.asset)}
          </Link>
          <span>
            {digits(m.asset.asset_code)}
            {m.asset.location ? ` · ${m.asset.location}` : ''}
          </span>
        </span>
      ),
    },
    { title: tx('ধরন'), dataIndex: 'kind', render: (v: string) => <Tag className={`fl-tag ${v === 'repair' ? 'll-orange' : 'll-blue'}`}>{meta.data?.maintenance_kinds[v] ?? v}</Tag> },
    { title: tx('কাজ'), dataIndex: 'title' },
    { title: tx('পুনরাবৃত্তি'), dataIndex: 'repeat_months', render: (v: number | null) => (v ? tx('{{p0}} মাস পর পর', { p0: digits(v) }) : '—') },
    ...(view === 'done'
      ? [
          { title: tx('সম্পন্ন'), dataIndex: 'done_on', render: fmtDate },
          { title: tx('খরচ (৳)'), dataIndex: 'cost', align: 'right' as const, render: moneyOrBlank },
          { title: tx('মেকানিক / প্রতিষ্ঠান'), dataIndex: 'vendor', render: (v: string | null) => v || '—' },
          { title: tx('ভাউচার'), render: (_: unknown, m: Row) => journalLink(m.journal, can('accounting.view')) ?? '—' },
        ]
      : []),
    { title: tx('স্ট্যাটাস'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${MAINT_TONE[v] ?? 'll-gray'}`}>{meta.data?.maintenance_statuses[v] ?? v}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, m) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} title={tx('সম্পদ দেখুন')} onClick={() => navigate(`/assets/${m.asset.id}`)} />
          {m.status === 'scheduled' && can('asset.edit') && (
            <>
              <Button className="fl-act pl-act" icon={<CheckCircleFilled />} aria-label={tx('সম্পন্ন')} title={tx('সম্পন্ন')} onClick={() => setCompleting(m)} />
              <Popconfirm title={tx('এই কাজ বাতিল করবেন?')} onConfirm={() => cancel(m)}>
                <Button className="fl-act pl-act" icon={<StopOutlined />} aria-label={tx('বাতিল')} title={tx('বাতিল')} />
              </Popconfirm>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সম্পদ'), to: '/assets/dashboard' }}
      title={tx('মেরামত সূচি')}
      subtitle=""
      actions={
        can('asset.edit') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setPicking(true)}>
            {tx('সার্ভিস/মেরামত নির্ধারণ')}
          </Button>
        )
      }
      cards={cards}
      above={
        <div className="lk-tabs ap-tabs">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={view === t.key ? 'on' : ''} onClick={() => open(t.key)}>
              {t.key === 'cancelled' ? <CloseOutlined /> : t.key === 'done' ? <CheckOutlined /> : <ClockCircleFilled />} {t.label}
              {!!t.count && <span className="ap-count">{digits(t.count)}</span>}
            </button>
          ))}
        </div>
      }
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('সম্পদ, কাজ বা মেকানিক...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => (setFilters(draft), setPage(1))}
            />
          </Field>
          <Field label={tx('ধরন')}>
            <Select
              value={draft.kind ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...Object.entries(meta.data?.maintenance_kinds ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v || undefined }))}
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
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tabs.find((t) => t.key === view)?.label ?? '', p1: n0(total) })}
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
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো কাজ পাওয়া যায়নি') }}
      />
      <CompleteModal job={completing} onClose={() => setCompleting(null)} onDone={refresh} />
      <AssetPickModal open={picking} title={tx('সার্ভিস/মেরামত নির্ধারণ')} statuses={LIVE} onClose={() => setPicking(false)} onPick={setScheduling} />
      {scheduling && <ScheduleModal asset={scheduling} open onClose={() => setScheduling(null)} onDone={refresh} />}
    </ListFrame>
  )
}
