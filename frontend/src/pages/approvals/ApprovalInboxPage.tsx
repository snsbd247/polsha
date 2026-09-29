import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Grid, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, ClockCircleFilled, CloseOutlined, EyeFilled, InboxOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { APPROVAL_STATUS, digits, fmtDateTime } from '../../lib/format'
import type { ApprovalRequest } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../irrigation/rates.css'
import './approvals.css'

type Resp = Paginated<ApprovalRequest> & { counts: { mine: number; sent_pending: number; sent_approved: number; sent_rejected: number }; modules: Record<string, string> }
type Tab = 'mine' | 'sent' | 'all'
type Filters = { status?: string; module?: string }

const STATUS_TONE: Record<string, string> = { pending: 'fl-tag-gold', approved: 'fl-tag-green', rejected: 'fl-tag-red', returned: 'll-orange', cancelled: 'll-gray' }

/** Requests waiting for my decision, the ones I sent and (for admins) all of them. */
export default function ApprovalInboxPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const [tab, setTab] = useState<Tab>('mine')
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const params = { tab, page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['approvals', params],
    queryFn: async () => (await api.get<Resp>('/approvals', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const open = (t: Tab, f: Filters = {}) => {
    setTab(t)
    setDraft(f)
    setFilters(f)
    setPage(1)
  }

  const cards = [
    { key: 'mine', label: tx('আমার কাছে অপেক্ষমাণ'), value: c?.mine, icon: '', glyph: <InboxOutlined />, color: '#f08c00', tint: '#fdefd6', onClick: () => open('mine') },
    { key: 'sent', label: tx('আমার পাঠানো — অপেক্ষমাণ'), value: c?.sent_pending, icon: '', glyph: <ClockCircleFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => open('sent', { status: 'pending' }) },
    { key: 'approved', label: tx('আমার পাঠানো — অনুমোদিত'), value: c?.sent_approved, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => open('sent', { status: 'approved' }) },
    { key: 'rejected', label: tx('আমার পাঠানো — প্রত্যাখ্যাত'), value: c?.sent_rejected, icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => open('sent', { status: 'rejected' }) },
  ]
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'mine', label: tx('আমার কাছে অপেক্ষমাণ'), icon: <InboxOutlined /> },
    { key: 'sent', label: tx('আমার পাঠানো'), icon: <SendOutlined /> },
    ...(can('approval.admin') ? [{ key: 'all' as Tab, label: tx('সব'), icon: <ClockCircleFilled /> }] : []),
  ]

  const columns: ColumnsType<ApprovalRequest> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('বিষয়'), dataIndex: 'title', render: (v: string, r) => <Link to={`/approvals/${r.id}`} className="fl-link">{digits(v)}</Link> },
    { title: tx('মডিউল'), dataIndex: 'module', render: (v: string) => data?.modules[v] ?? v },
    {
      title: tx('পাঠিয়েছেন'),
      render: (_, r) =>
        r.requester ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(r.requester.name_bn)}</span>
            <span className="mg-name">{r.requester.name_bn}</span>
          </span>
        ) : (
          '—'
        ),
    },
    { title: tx('সময়'), dataIndex: 'created_at', render: (v: string) => fmtDateTime(v) },
    { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: (v: string | null) => (v ? money(v) : '—') },
    { title: tx('ধাপ'), render: (_, r) => (r.total_steps ? `${digits(Math.min(r.current_step, r.total_steps))} / ${digits(r.total_steps)}` : '—') },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag className={`fl-tag iv-status ${STATUS_TONE[s] ?? 'll-gray'}`}>{APPROVAL_STATUS[s]?.label ?? s}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/approvals/${r.id}`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }}
      title={tx('অনুমোদন')}
      subtitle=""
      actions={
        can('approval.admin') && (
          <Button icon={<SettingOutlined />} onClick={() => navigate('/admin/approval-rules')}>
            {tx('অনুমোদনের নিয়ম')}
          </Button>
        )
      }
      cards={cards}
      above={
        <div className="lk-tabs ap-tabs">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? 'on' : ''} onClick={() => open(t.key)}>
              {t.icon} {t.label}
              {t.key === 'mine' && !!c?.mine && <span className="ap-count">{digits(c.mine)}</span>}
            </button>
          ))}
        </div>
      }
      filters={
        <>
          <Field label={tx('মডিউল')} grow={300}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.module ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.modules ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, module: v || undefined }))}
            />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.status ?? ''}
              disabled={tab === 'mine'}
              options={[{ value: '', label: tx('সকল') }, ...Object.entries(APPROVAL_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => {
        setFilters(draft)
        setPage(1)
      }}
      onReset={() => open(tab)}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tabs.find((t) => t.key === tab)?.label ?? '', p1: n0(total) })}
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
      <Table<ApprovalRequest>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tab === 'mine' ? tx('আপনার অনুমোদনের অপেক্ষায় কিছু নেই।') : tx('কিছু পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
