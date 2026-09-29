import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Dropdown, Grid, Input, Segmented, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CheckOutlined, ClockCircleFilled, DownOutlined, EyeFilled, HistoryOutlined, LockFilled, MoreOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { IN_TYPE, isFundKind, useFundMeta, type FundKind } from '../../lib/funds'
import FundTxnModal from '../funds/FundTxnModal'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import './savings.css'

export type AccountRow = {
  id: number
  account_no: string
  member_id: number
  opened_on: string
  status: string
  balance: string
  held: string | null
  closed_on: string | null
  close_reason: string | null
  close_kind: string | null
  member: { id: number; member_no: number | string; status: string; farmer: { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile: string | null } | null } | null
}
type Page = Paginated<AccountRow> & { totals: { accounts: number; balance: number }; book_balance: number; status_counts: Record<string, number> }
type Filters = { search?: string; status?: string }

export const ACCOUNT_TONE: Record<string, string> = { active: 'fl-tag-green', closing: 'fl-tag-gold', closed: 'll-gray' }

/** The savings (or share) / সঞ্চয় / শেয়ার switch the account pages share; the choice lives in the URL. */
export function useKindParam(): [FundKind, (k: FundKind) => void] {
  const [sp, setSp] = useSearchParams()
  const k = sp.get('kind') ?? 'savings'
  return [isFundKind(k) ? k : 'savings', (next) => setSp(next === 'savings' ? {} : { kind: next }, { replace: true })]
}

export function KindSwitch({ kind, onChange }: { kind: FundKind; onChange: (k: FundKind) => void }) {
  const { can } = useAuth()
  const options = [
    { value: 'savings', label: tx('সঞ্চয় হিসাব'), disabled: !can('savings.view') },
    { value: 'share', label: tx('শেয়ার হিসাব'), disabled: !can('share.view') },
  ]
  return <Segmented className="sv-kind" value={kind} options={options} onChange={(v) => onChange(v as FundKind)} />
}

/** Every savings (or share) account: balance, what pending withdrawals hold, and whether it is open, closing or closed. */
export default function AccountListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const [kind, setKind] = useKindParam()
  const { data: meta } = useFundMeta(kind)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [taking, setTaking] = useState<AccountRow | null>(null)
  const queryClient = useQueryClient()

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['fund-accounts', kind, params],
    queryFn: async () => (await api.get<Page>(`/funds/${kind}/accounts`, { params })).data,
    placeholderData: keepPreviousData,
  })
  const counts = data?.status_counts ?? {}
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }
  const exportCsv = () => downloadExport(`/funds/${kind}/accounts`, { ...filters, export: 'csv' }, `${kind}-accounts.csv`).catch((e) => message.error(errorMessage(e)))
  const all = Object.values(counts).reduce((a, b) => a + b, 0)

  const cards = [
    { key: 'all', label: tx('মোট হিসাব'), value: all, icon: 'users', color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'balance', label: tx('মোট জের'), value: data ? `৳ ${money(data.book_balance ?? 0)}` : undefined, icon: 'piggy', color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'active' }) },
    { key: 'active', label: tx('সক্রিয় হিসাব'), value: counts.active ?? 0, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'active' }) },
    {
      key: 'closed',
      label: tx('বন্ধ / বন্ধের অপেক্ষায়'),
      value: `${n0(counts.closed ?? 0)} / ${n0(counts.closing ?? 0)}`,
      icon: '',
      glyph: <LockFilled />,
      color: '#6b7280',
      tint: '#eef0f3',
      onClick: () => show({ status: 'closed' }),
    },
  ]

  const statement = (r: AccountRow) => navigate(`/funds/${kind}/accounts/${r.id}`)
  // a deposit (savings) or a share payment is taken right from the list
  const inLabel = kind === 'share' ? tx('শেয়ার আদায়') : tx('জমা নিন')
  const columns: ColumnsType<AccountRow> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('হিসাব নং'), dataIndex: 'account_no', render: (v: string, r) => <Link to={`/funds/${kind}/accounts/${r.id}`} className="fl-link iv-no">{digits(v)}</Link> },
    {
      title: tx('সদস্যের নাম'),
      render: (_, r) => {
        const f = r.member?.farmer
        return f ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>
            <span className="hs-two">
              <Link to={`/farmers/${f.id}`} className="mg-name">
                {nameOf(f)}
              </Link>
              <span>{tx('পিতা: {{p0}}', { p0: f.father_name })}</span>
            </span>
          </span>
        ) : (
          '—'
        )
      },
    },
    { title: tx('সদস্য নং'), render: (_, r) => digits(r.member?.member_no ?? '—') },
    { title: tx('মোবাইল'), render: (_, r) => digits(r.member?.farmer?.mobile ?? '—') },
    { title: tx('খোলার তারিখ'), dataIndex: 'opened_on', render: fmtDate },
    { title: tx('জের (৳)'), dataIndex: 'balance', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    ...(kind === 'savings' ? [{ title: tx('আটকে আছে (৳)'), dataIndex: 'held', align: 'right' as const, render: (v: string | null) => (Number(v) > 0 ? money(v ?? 0) : '—') }] : []),
    {
      title: tx('অবস্থা'),
      dataIndex: 'status',
      render: (v: string, r) => (
        <span className="hs-two">
          <Tag className={`fl-tag iv-status ${ACCOUNT_TONE[v] ?? 'll-gray'}`}>{meta?.account_statuses[v] ?? v}</Tag>
          {r.closed_on && v !== 'active' && <span>{fmtDate(r.closed_on)}</span>}
        </span>
      ),
    },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => statement(r)} />
          {r.status === 'active' && r.member?.status === 'active' && can(`${kind}.create`) && (
            <Tooltip title={inLabel}>
              <Button className="fl-act pl-act sv-approve" icon={<PlusOutlined />} aria-label={inLabel} onClick={() => setTaking(r)} />
            </Tooltip>
          )}
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'history', label: tx('হিসাবের ইতিহাস'), onClick: () => navigate(`/savings/accounts/history?${new URLSearchParams({ ...(kind === 'share' ? { kind } : {}), account: String(r.id) })}`) },
                ...(r.status === 'active' && can(`${kind}.edit`) ? [{ key: 'close', label: tx('হিসাব বন্ধ'), onClick: () => navigate(`/savings/accounts/close?${new URLSearchParams({ ...(kind === 'share' ? { kind } : {}), account: String(r.id) })}`) }] : []),
                ...(r.member?.farmer ? [{ key: 'farmer', label: tx('কৃষকের প্রোফাইল'), onClick: () => navigate(`/farmers/${r.member!.farmer!.id}`) }] : []),
              ],
            }}
          >
            <Button className="fl-act pl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
          </Dropdown>
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সঞ্চয়'), to: '/savings/accounts' }}
      title={kind === 'share' ? tx('শেয়ার হিসাবের তালিকা') : tx('সঞ্চয় হিসাবের তালিকা')}
      subtitle=""
      actions={
        <>
          <KindSwitch
            kind={kind}
            onChange={(k) => {
              setKind(k)
              show({})
            }}
          />
          <Button icon={<HistoryOutlined />} onClick={() => navigate(`/savings/accounts/history${kind === 'share' ? '?kind=share' : ''}`)}>
            {tx('হিসাবের ইতিহাস')}
          </Button>
        </>
      }
      cards={cards}
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={420}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('হিসাব নং, সদস্যের নাম, সদস্য নং বা মোবাইল দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => show(draft)}
            />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.status ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...Object.entries(meta?.account_statuses ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => show(draft)}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: kind === 'share' ? tx('শেয়ার হিসাব') : tx('সঞ্চয় হিসাব'), p1: n0(total) })}
      tableTools={
        <>
          <span className="sv-total">
            {tx('মোট')}: <strong>৳ {money(data?.totals.balance ?? 0)}</strong>
          </span>
          <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [{ key: 'csv', label: 'Excel (CSV)', onClick: exportCsv }] }}>
            <Button icon={<AppstoreFilled />} className="ml-columns pl-columns">
              {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
            </Button>
          </Dropdown>
        </>
      }
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
      <Table<AccountRow>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        rowClassName={(r) => (r.status === 'closing' ? 'sv-row-closing' : '')}
        locale={{ emptyText: tx('কোনো হিসাব পাওয়া যায়নি') }}
      />
      {taking && (
        <FundTxnModal
          kind={kind}
          account={{ id: taking.id, account_no: taking.account_no, member_id: taking.member_id, available: Number(taking.balance) }}
          type={IN_TYPE[kind]}
          typeLabel={`${inLabel} — ${nameOf(taking.member?.farmer)}`}
          onClose={() => setTaking(null)}
          onDone={(res) => {
            setTaking(null)
            queryClient.invalidateQueries({ queryKey: ['fund-accounts'] })
            navigate(`/funds/${kind}/transactions/${res.id}`)
          }}
        />
      )}
      {counts.closing ? (
        <div className="sv-foot-note">
          <ClockCircleFilled /> {tx('{{p0}}টি হিসাব বন্ধের আবেদন অনুমোদনের অপেক্ষায় — "হিসাব বন্ধ" পাতায় দেখুন।', { p0: n0(counts.closing) })}
        </div>
      ) : null}
    </ListFrame>
  )
}
