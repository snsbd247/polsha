import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CalendarFilled, CloseCircleOutlined, DownOutlined, EyeFilled, FileTextFilled, LockOutlined, PlusOutlined, SearchOutlined, UndoOutlined, UnlockOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import { KindSwitch, useKindParam } from './AccountListPage'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import './savings.css'

type Row = {
  id: number
  event: string | null
  event_label: string
  at: string
  by: { id: number; name_bn: string; name_en: string | null } | null
  reason: string | null
  account: { id: number; account_no: string; status: string; balance: number; member_no: number | string | null; farmer: { id: number; name_bn: string; name_en: string | null } | null } | null
}
type Summary = { total: number; today: number; counts: Record<string, number>; events: Record<string, string>; users: { id: number; name_bn: string; name_en: string | null }[] }
type Filters = { search?: string; event?: string; user_id?: number; from?: string; to?: string; member_account_id?: number }

const EVENT: Record<string, [string, ReactNode, string, string]> = {
  opened: ['ll-green', <PlusOutlined />, '#1f9d55', '#dcf3e5'],
  close_requested: ['ll-orange', <LockOutlined />, '#f08c00', '#fdefd6'],
  closed: ['hs-red', <CloseCircleOutlined />, '#e5383b', '#fde4e5'],
  close_rejected: ['ll-purple', <UndoOutlined />, '#8b3fe0', '#efe4fc'],
  reopened: ['ll-blue', <UnlockOutlined />, '#1769e0', '#e4edfd'],
}

/** Account openings, close requests, closings and reopenings, from the audit log. */
export default function AccountHistoryPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const wide = Grid.useBreakpoint().lg
  const [sp] = useSearchParams()
  const [kind, setKind] = useKindParam()
  const initial: Filters = { member_account_id: Number(sp.get('account')) || undefined }
  const [draft, setDraft] = useState<Filters>(initial)
  const [filters, setFilters] = useState<Filters>(initial)
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['fund-account-history', kind, params],
    queryFn: async () => (await api.get<{ data: Row[]; total: number }>(`/funds/${kind}/account-history`, { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['fund-account-history', kind, 'summary'], queryFn: async () => (await api.get<Summary>(`/funds/${kind}/account-history/summary`)).data })
  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
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
  const exportCsv = () => downloadExport(`/funds/${kind}/account-history`, { ...filters, export: 'csv' }, `${kind}-account-history.csv`).catch((e) => message.error(errorMessage(e)))
  const all = [{ value: '', label: tx('সকল') }]
  const today = dayjs().format('YYYY-MM-DD')

  const cards = [
    { key: 'total', label: tx('মোট ইতিহাস রেকর্ড'), value: s?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    ...['opened', 'close_requested', 'closed', 'close_rejected'].map((e) => ({ key: e, label: s?.events[e] ?? e, value: s?.counts[e], icon: '', glyph: EVENT[e][1], color: EVENT[e][2], tint: EVENT[e][3], onClick: () => show({ event: e }) })),
    { key: 'today', label: tx('আজকের কার্যক্রম'), value: s?.today, icon: '', glyph: <CalendarFilled />, color: '#0e9f9a', tint: '#d9f4f2', onClick: () => show({ from: today, to: today }) },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('সময়'), dataIndex: 'at', render: (v: string) => fmtDateTime(v) },
    {
      title: tx('কার্যক্রম'),
      dataIndex: 'event',
      render: (e: string | null, r) => (
        <Tag className={`fl-tag hs-kind ${EVENT[e ?? '']?.[0] ?? 'll-gray'}`}>
          {EVENT[e ?? '']?.[1]}
          <span>{r.event_label}</span>
        </Tag>
      ),
    },
    { title: tx('হিসাব নং'), render: (_, r) => (r.account ? <Link to={`/funds/${kind}/accounts/${r.account.id}`} className="fl-link hs-code">{digits(r.account.account_no)}</Link> : '—') },
    {
      title: tx('সদস্যের নাম'),
      render: (_, r) => {
        const f = r.account?.farmer
        return f ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>
            <span className="hs-two">
              <Link to={`/farmers/${f.id}`} className="hs-person">
                {nameOf(f)}
              </Link>
              <span>{tx('সদস্য নং {{p0}}', { p0: digits(r.account?.member_no ?? '') })}</span>
            </span>
          </span>
        ) : (
          '—'
        )
      },
    },
    { title: tx('বর্তমান জের (৳)'), align: 'right', render: (_, r) => (r.account ? money(r.account.balance) : '—') },
    { title: tx('সম্পাদনকারী'), dataIndex: 'by', render: (b) => nameOf(b) || tx('সিস্টেম') },
    { title: tx('কারণ'), dataIndex: 'reason', className: 'hs-detail', render: (v: string | null) => v || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 64,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => r.account && <Button className="mg-act hs-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/funds/${kind}/accounts/${r.account!.id}`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সঞ্চয়'), to: '/savings/accounts' }}
      title={tx('হিসাবের ইতিহাস')}
      subtitle=""
      actions={
        <KindSwitch
          kind={kind}
          onChange={(k) => {
            setKind(k)
            show({})
          }}
        />
      }
      cards={cards}
      statsClass="hs-six"
      filterClass="ll-filters hs-filters"
      above={
        filters.member_account_id ? (
          <div className="iv-scope">
            {tx('একটি হিসাবের ইতিহাস')}
            <Button size="small" type="link" onClick={() => show({})}>
              {tx('সব দেখুন')}
            </Button>
          </div>
        ) : null
      }
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={340}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('হিসাব নং, সদস্যের নাম, সদস্য নং বা মোবাইল দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('কার্যক্রম')}>
            <Select value={draft.event ?? ''} options={[...all, ...Object.entries(s?.events ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ event: v || undefined })} />
          </Field>
          <Field label={tx('সম্পাদনকারী')}>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.user_id ?? ''} options={[...all, ...(s?.users ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]} onChange={(v) => set({ user_id: v === '' ? undefined : Number(v) })} />
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
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('হিসাবের ইতিহাস'), p1: n0(total) })}
      tableTools={
        <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [{ key: 'csv', label: 'Excel (CSV)', onClick: exportCsv }] }}>
          <Button icon={<AppstoreFilled />} className="ml-columns pl-columns">
            {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
          </Button>
        </Dropdown>
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
      <Table<Row>
        className="fl-table ml-table pl-table mg-table hs-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো কার্যক্রম পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
