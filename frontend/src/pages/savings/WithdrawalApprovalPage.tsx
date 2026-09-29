import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, ClockCircleFilled, CloseOutlined, EyeFilled, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { useFundMeta, type FundTxn } from '../../lib/funds'
import { ENTRY, TXN_TONE, type EntrySummary } from '../../lib/fundEntry'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import DecideButtons from './DecideButtons'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import '../lands/land-history.css'
import './savings.css'

type Row = FundTxn & {
  approval_request_id: number | null
  account: { id: number; account_no: string; member_id: number; balance: string; member: { id: number; member_no: number | string; farmer: { id: number; name_bn: string; name_en: string | null; mobile: string | null } | null } | null } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Filters = { search?: string; status: string }

const waited = (at: string) => {
  const days = dayjs().diff(dayjs(at), 'day')
  return days < 1 ? tx('আজকের আবেদন') : tx('{{p0}} দিন অপেক্ষায়', { p0: digits(days) })
}

/** Pending withdrawal requests, approved or rejected right here (maker-checker: not by the one who entered it). */
export default function WithdrawalApprovalPage() {
  const cfg = ENTRY.withdrawal
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can, user } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const { data: meta } = useFundMeta(cfg.kind)
  const [draft, setDraft] = useState<Filters>({ status: 'pending' })
  const [filters, setFilters] = useState<Filters>({ status: 'pending' })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const params = { page, per_page: perPage, type: cfg.type, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['fund-entries', 'approval', params],
    queryFn: async () => (await api.get<Paginated<Row>>(`/funds/${cfg.kind}/transactions`, { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['fund-entries', cfg.key, 'summary'], queryFn: async () => (await api.get<EntrySummary>(`/funds/${cfg.kind}/entry-summary`, { params: { type: cfg.type } })).data })
  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fund-entries'] })
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }
  const canDecide = can(`${cfg.kind}.approve`)

  const cards = [
    { key: 'pending', label: tx('অপেক্ষমাণ আবেদন'), value: s?.pending, unit: tx('টি'), icon: '', glyph: <ClockCircleFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ status: 'pending' }) },
    { key: 'amount', label: tx('অপেক্ষমাণ টাকা'), value: s ? `৳ ${money(s.pending_amount)}` : undefined, icon: 'piggy', color: '#1769e0', tint: '#e4edfd', onClick: () => show({ status: 'pending' }) },
    { key: 'approved', label: tx('আজ অনুমোদিত'), value: s?.approved_today, unit: tx('টি'), icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'posted' }) },
    { key: 'rejected', label: tx('মোট প্রত্যাখ্যাত'), value: s?.rejected, unit: tx('টি'), icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'rejected' }) },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: cfg.no, dataIndex: 'txn_no', render: (v: string, r) => <Link to={`${cfg.base}/details/${r.id}`} className="fl-link iv-no">{digits(v)}</Link> },
    {
      title: tx('সদস্যের নাম'),
      render: (_, r) => {
        const f = r.account?.member?.farmer
        return f ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>
            <span className="hs-two">
              <Link to={`/farmers/${f.id}`} className="mg-name">
                {nameOf(f)}
              </Link>
              <span>{tx('সদস্য নং {{p0}}', { p0: digits(r.account?.member?.member_no ?? '') })}</span>
            </span>
          </span>
        ) : (
          '—'
        )
      },
    },
    { title: tx('হিসাব নং'), render: (_, r) => (r.account ? <Link to={`/funds/${cfg.kind}/accounts/${r.account.id}`}>{digits(r.account.account_no)}</Link> : '—') },
    { title: tx('বর্তমান জের (৳)'), align: 'right', render: (_, r) => (r.account ? money(r.account.balance) : '—') },
    { title: tx('উত্তোলন (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    { title: tx('আবেদনকারী'), render: (_, r) => nameOf(r.creator) || '—' },
    {
      title: tx('আবেদনের সময়'),
      dataIndex: 'created_at',
      render: (v: string, r) => (
        <span className="hs-two">
          {fmtDateTime(v)}
          {r.status === 'pending' && <span>{waited(v)}</span>}
        </span>
      ),
    },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${TXN_TONE[v] ?? 'll-gray'}`}>{meta?.statuses[v] ?? v}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`${cfg.base}/details/${r.id}`)} />
          {/* the one who entered it cannot approve it; the server checks the same */}
          {r.status === 'pending' && r.approval_request_id && canDecide && r.creator?.id !== user?.id && (
            <DecideButtons compact approvalId={r.approval_request_id} amount={r.amount} who={nameOf(r.account?.member?.farmer)} onDone={refresh} />
          )}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সঞ্চয়'), to: cfg.base }}
      title={tx('উত্তোলন অনুমোদন')}
      subtitle=""
      cards={cards}
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={380}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('{{p0}}, সদস্যের নাম, সদস্য নং বা মোবাইল দিয়ে খুঁজুন...', { p0: cfg.no })}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => show(draft)}
            />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.status}
              options={[
                { value: 'pending', label: tx('অপেক্ষমাণ') },
                { value: 'posted', label: tx('অনুমোদিত') },
                { value: 'rejected', label: tx('প্রত্যাখ্যাত') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
            />
          </Field>
        </>
      }
      onSearch={() => show(draft)}
      onReset={() => show({ status: 'pending' })}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('উত্তোলনের আবেদন'), p1: n0(total) })}
      tableTools={!canDecide && <span className="sv-total sv-muted">{tx('অনুমোদনের অনুমতি আপনার নেই — শুধু দেখা যাবে।')}</span>}
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
        locale={{ emptyText: filters.status === 'pending' ? tx('অনুমোদনের অপেক্ষায় কোনো উত্তোলন নেই') : tx('কোনো উত্তোলন পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
