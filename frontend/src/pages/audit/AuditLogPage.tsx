import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarFilled, DeleteFilled, EyeFilled, FileSearchOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { AuditDetailDrawer } from '../../components/AuditLogTable'
import { api, type Paginated } from '../../lib/api'
import { ACTION_LABELS, digits, fmtDateTime, toEnDigits } from '../../lib/format'
import type { AuditLog, UserRow } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../accounting/accounting.css'

type Resp = Paginated<AuditLog> & { counts: { total: number; today: number; users_today: number; deletes_today: number } }
type Filters = { module?: string; action?: string; user_id?: number; auditable_id?: string; from?: string; to?: string }

const ACTION_TONE: Record<string, string> = {
  create: 'fl-tag-green',
  update: 'll-blue',
  delete: 'fl-tag-red',
  purge: 'fl-tag-red',
  approve: 'fl-tag-green',
  reject: 'fl-tag-red',
  return: 'll-orange',
  submit: 'll-purple',
  login: 'll-gray',
  merge: 'll-orange',
  restore: 'll-blue',
  rollback: 'fl-tag-gold',
  import: 'll-purple',
  ownership_transfer: 'll-orange',
}

/** Who changed what and when: every create / update / delete / approval, with old and new values. */
export default function AuditLogPage() {
  const wide = Grid.useBreakpoint().lg
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [open, setOpen] = useState<AuditLog | null>(null)

  const meta = useQuery({
    queryKey: ['audit-meta'],
    queryFn: async () => (await api.get<{ modules: Record<string, string>; actions: string[] }>('/audit-logs/meta')).data,
  })
  const users = useQuery({
    queryKey: ['users', 'all-for-filter'],
    queryFn: async () => (await api.get<Paginated<UserRow>>('/users', { params: { per_page: 100 } })).data.data,
    retry: false,
  })
  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: async () => (await api.get<Resp>('/audit-logs', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const today = dayjs().format('YYYY-MM-DD')
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange({ from: f.from ? dayjs(f.from) : null, to: f.to ? dayjs(f.to) : null })
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'total', label: tx('মোট লগ'), value: c?.total, icon: '', glyph: <FileSearchOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'today', label: tx('আজকের লগ'), value: c?.today, icon: '', glyph: <CalendarFilled />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ from: today, to: today }) },
    { key: 'users', label: tx('আজ কাজ করেছেন'), value: c?.users_today, unit: tx('জন'), icon: '', glyph: <TeamOutlined />, color: '#8b3fe0', tint: '#efe4fc', onClick: () => show({ from: today, to: today }) },
    { key: 'del', label: tx('আজ মুছে ফেলা'), value: c?.deletes_today, icon: '', glyph: <DeleteFilled />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ action: 'delete', from: today, to: today }) },
  ]

  const columns: ColumnsType<AuditLog> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('সময়'), dataIndex: 'created_at', render: (v: string) => fmtDateTime(v) },
    {
      title: tx('ইউজার'),
      render: (_, r) =>
        r.user ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(r.user.name_bn)}</span>
            <span className="hs-two">
              <span className="mg-name">{r.user.name_bn}</span>
              <span>{r.user.username}</span>
            </span>
          </span>
        ) : (
          <span className="ac-muted">{tx('সিস্টেম')}</span>
        ),
    },
    { title: tx('মডিউল'), dataIndex: 'module', render: (m: string) => meta.data?.modules[m] ?? m },
    { title: tx('কাজ'), dataIndex: 'action', render: (a: string) => <Tag className={`fl-tag ${ACTION_TONE[a] ?? 'll-gray'}`}>{ACTION_LABELS[a] ?? a}</Tag> },
    { title: tx('রেকর্ড'), render: (_, r) => (r.auditable_type ? <span className="iv-no">{`${r.auditable_type} #${digits(r.auditable_id)}`}</span> : '—') },
    { title: tx('বিবরণ'), dataIndex: 'description', render: (v: string | null) => <span className="jl-narr">{v || '—'}</span> },
    { title: 'IP', dataIndex: 'ip_address', render: (v: string | null) => v || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setOpen(r)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('অডিট ও পর্যবেক্ষণ'), to: '/audit/logs' }}
      title={tx('সিস্টেম অডিট লগ')}
      subtitle=""
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('ইউজার')} grow={200}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.user_id ?? 0}
              options={[{ value: 0, label: tx('সকল') }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name_bn }))]}
              onChange={(v) => set({ user_id: v || undefined })}
            />
          </Field>
          <Field label={tx('মডিউল')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.module ?? ''}
              options={[...all, ...Object.entries(meta.data?.modules ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => set({ module: v || undefined })}
            />
          </Field>
          <Field label={tx('কাজ')}>
            <Select value={draft.action ?? ''} options={[...all, ...(meta.data?.actions ?? []).map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }))]} onChange={(v) => set({ action: v || undefined })} />
          </Field>
          <Field label={tx('রেকর্ড ID')}>
            <Input prefix={<SearchOutlined />} allowClear placeholder="ID" value={draft.auditable_id} onChange={(e) => set({ auditable_id: e.target.value ? toEnDigits(e.target.value) : undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('অডিট লগ'), p1: n0(total) })}
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
      <Table<AuditLog>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো লগ পাওয়া যায়নি') }}
      />
      <AuditDetailDrawer log={open} modules={meta.data?.modules} onClose={() => setOpen(null)} />
    </ListFrame>
  )
}
