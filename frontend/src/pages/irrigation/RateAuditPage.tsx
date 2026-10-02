import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, DatePicker, Input, Modal, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, CloseOutlined, EditOutlined, EyeFilled, FileTextFilled, PlusOutlined, SafetyCertificateOutlined, SearchOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { useInvoiceMeta, type RatePage, type RateRow } from '../../lib/irrigation'
import { useLandMeta } from '../../lib/land'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './rates.css'

type InvoiceIssue = { id: number; invoice_no: string; name: string; dag_no: string; area_decimal: number; rate: number; amount: number; current_rate: number | null; expected: number | null; problems: string[] }
type NoRate = { land_type: string | null; irrigation_type: string | null; lands: number; area: number }
type Checks = { invoice_issues: InvoiceIssue[]; no_rate: NoRate[]; lands_without_irrigation_type: number; problems: Record<string, string> }
type Filters = { search?: string; season_id?: number; land_type_id?: number; irrigation_type_id?: number; kind?: string; from?: string; to?: string }

// what a rate row did, as the design names it: created, updated, no change — or rejected / waiting
const KIND: Record<string, [string, string]> = {
  created: ['নতুন তৈরি', 'll-blue'],
  updated: ['পরিবর্তিত', 'fl-tag-green'],
  no_change: ['পরিবর্তন নেই', 'll-gray'],
  rejected: ['প্রত্যাখ্যাত', 'fl-tag-red'],
  pending: ['অনুমোদনের অপেক্ষায়', 'fl-tag-gold'],
}
const kindOf = (r: RateRow) => (r.status === 'rejected' ? 'rejected' : r.status === 'pending' ? 'pending' : r.change)

/** Every rate change — who proposed what, from which rate to which — plus a check of bills against their rates. */
export default function RateAuditPage({ tabs }: { tabs?: ReactNode } = {}) {
  const navigate = useNavigate()
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [checking, setChecking] = useState(false)
  const checkSeason = filters.season_id ?? meta?.seasons.find((x) => x.status === 'open')?.id ?? meta?.seasons[0]?.id

  // rejected and waiting rows are filtered by state, the rest by how they changed the rate
  const state = filters.kind === 'rejected' ? 'rejected' : filters.kind === 'pending' ? 'pending' : undefined
  const change = filters.kind && !state ? filters.kind : undefined
  const params = {
    page,
    per_page: perPage,
    sort: 'history',
    season_id: filters.season_id,
    land_type_id: filters.land_type_id,
    irrigation_type_id: filters.irrigation_type_id,
    search: filters.search,
    from: filters.from,
    to: filters.to,
    state,
    change,
  }
  const { data, isFetching } = useQuery({
    queryKey: ['irrigation-rates', 'all', 'history', params],
    queryFn: async () => (await api.get<RatePage>('/irrigation-rates/all', { params })).data,
    placeholderData: keepPreviousData,
  })
  const checks = useQuery({
    queryKey: ['rate-audit', checkSeason],
    queryFn: async () => (await api.get<Checks>('/irrigation/rate-audit', { params: { season_id: checkSeason } })).data,
    enabled: !!checkSeason,
  })
  const issueCount = checks.data ? checks.data.invoice_issues.length + checks.data.no_rate.length + (checks.data.lands_without_irrigation_type ? 1 : 0) : 0

  const s = data?.summary
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange(null)
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') })
    setPage(1)
  }

  const cards = [
    { key: 'total', label: tx('মোট পরিবর্তন'), value: s?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'created', label: tx('নতুন রেট'), value: s?.created, icon: '', glyph: <PlusOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ kind: 'created' }) },
    { key: 'updated', label: tx('পরিবর্তিত রেট'), value: s?.updated, icon: '', glyph: <EditOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({ kind: 'updated' }) },
    { key: 'rejected', label: tx('প্রত্যাখ্যাত'), value: s?.rejected, icon: '', glyph: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ kind: 'rejected' }) },
  ]

  const columns: ColumnsType<RateRow> = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('পরিবর্তনের সময়'), dataIndex: 'created_at', render: fmtDateTime },
    { title: tx('মৌসুম'), dataIndex: 'season' },
    { title: tx('জমির ধরন'), dataIndex: 'land_type' },
    { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type' },
    { title: tx('আগের রেট (৳/শতক)'), dataIndex: 'old_rate', align: 'right', render: (v: number | null) => (v === null ? '—' : money(v)) },
    {
      title: tx('নতুন রেট (৳/শতক)'),
      dataIndex: 'rate',
      align: 'right',
      render: (v: number, r) => <span className={r.old_rate !== null && v !== r.old_rate ? (v > r.old_rate ? 'rt-up' : 'rt-down') : undefined}>{money(v)}</span>,
    },
    {
      title: tx('পরিবর্তনের ধরন'),
      align: 'center',
      render: (_, r) => {
        const k = kindOf(r)
        return <Tag className={`fl-tag rt-state ${KIND[k]?.[1] ?? 'll-gray'}`}>{tx(KIND[k]?.[0] ?? k)}</Tag>
      },
    },
    { title: tx('পরিবর্তন করেছেন'), render: (_, r) => nameOf(r.creator) || '—' },
    { title: tx('মন্তব্য'), dataIndex: 'reason', className: 'lt-desc', render: (v) => v || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      render: (_, r) => (r.approval_request_id ? <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('অনুমোদন দেখুন')} onClick={() => navigate(`/approvals/${r.approval_request_id}`)} /> : null),
    },
  ]

  return (
    <ListFrame
      above={tabs}
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tx('সেচের রেট')}
      subtitle={tx('সেচের রেটে কে, কখন, কী পরিবর্তন করেছেন তার ইতিহাস দেখুন।')}
      actions={
        <Button icon={issueCount ? <SafetyCertificateOutlined /> : <CheckOutlined />} danger={issueCount > 0} onClick={() => setChecking(true)}>
          {issueCount ? tx('বিল যাচাই: {{p0}}টি সমস্যা', { p0: digits(issueCount) }) : tx('বিল যাচাই: কোনো সমস্যা নেই')}
        </Button>
      }
      cards={cards}
      filterClass="ll-filters rt-filters"
      filters={
        <>
          <Field label={tx('মৌসুম')}>
            <Select
              value={draft.season_id ?? ''}
              options={[{ value: '', label: tx('সব মৌসুম') }, ...(meta?.seasons ?? []).map((x) => ({ value: x.id, label: x.name_bn }))]}
              onChange={(v) => setDraft((d) => ({ ...d, season_id: v === '' ? undefined : Number(v) }))}
            />
          </Field>
          <Field label={tx('জমির ধরন')}>
            <Select
              value={draft.land_type_id ?? ''}
              options={[{ value: '', label: tx('সব ধরনের জমি') }, ...(landMeta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]}
              onChange={(v) => setDraft((d) => ({ ...d, land_type_id: v === '' ? undefined : Number(v) }))}
            />
          </Field>
          <Field label={tx('সেচের ধরন')}>
            <Select
              value={draft.irrigation_type_id ?? ''}
              options={[{ value: '', label: tx('সব উৎস') }, ...(meta?.irrigation_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]}
              onChange={(v) => setDraft((d) => ({ ...d, irrigation_type_id: v === '' ? undefined : Number(v) }))}
            />
          </Field>
          <Field label={tx('পরিবর্তনের ধরন')}>
            <Select
              value={draft.kind ?? ''}
              options={[{ value: '', label: tx('সব পরিবর্তন') }, ...Object.entries(KIND).map(([value, [label]]) => ({ value, label: tx(label) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v || undefined }))}
            />
          </Field>
          <Field label={tx('তারিখের পরিসর')} grow={250}>
            <DatePicker.RangePicker format="DD/MM/YYYY" value={range} onChange={(r) => setRange(r as [Dayjs | null, Dayjs | null] | null)} style={{ width: '100%' }} />
          </Field>
          <span className="ll-break" />
          <Field grow={600}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('রেট, পরিবর্তনকারী বা মন্তব্য দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('রেট পরিবর্তনের ইতিহাস ({{p0}})', { p0: n0(total) })}
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
      <Table<RateRow>
        className="fl-table ml-table pl-table rt-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        locale={{ emptyText: tx('কোনো পরিবর্তন পাওয়া যায়নি') }}
      />

      <Modal open={checking} width={1000} footer={null} title={tx('বিল যাচাই — {{p0}}', { p0: meta?.seasons.find((x) => x.id === checkSeason)?.name_bn ?? '' })} onCancel={() => setChecking(false)}>
        {checks.data && !issueCount && <Alert type="success" showIcon title={tx('এই মৌসুমের সব ইনভয়েস অনুমোদিত রেট অনুযায়ী, এবং সব চাষকৃত জমির রেট আছে।')} />}
        {!!checks.data?.lands_without_irrigation_type && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('{{p0}}টি চাষকৃত জমিতে সেচের ধরন দেওয়া নেই — এগুলোর ইনভয়েস হবে না।', { p0: digits(checks.data.lands_without_irrigation_type) })} />
        )}
        {!!checks.data?.invoice_issues.length && (
          <Table<InvoiceIssue>
            rowKey="id"
            size="small"
            style={{ marginBottom: 12 }}
            dataSource={checks.data.invoice_issues}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: tx('ইনভয়েস নং'), dataIndex: 'invoice_no', render: (v: string, r) => <Link to={`/irrigation/invoices/${r.id}`}>{digits(v)}</Link> },
              { title: tx('চাষি'), dataIndex: 'name' },
              { title: tx('বিলের রেট'), dataIndex: 'rate', align: 'right', render: money },
              { title: tx('অনুমোদিত রেট'), dataIndex: 'current_rate', align: 'right', render: (v: number | null) => (v === null ? '—' : money(v)) },
              { title: tx('বিল'), dataIndex: 'amount', align: 'right', render: money },
              {
                title: tx('সমস্যা'),
                dataIndex: 'problems',
                render: (ps: string[]) =>
                  ps.map((p) => (
                    <Tag key={p} color="red">
                      {checks.data?.problems[p] ?? p}
                    </Tag>
                  )),
              },
            ]}
          />
        )}
        {!!checks.data?.no_rate.length && (
          <Table<NoRate>
            rowKey={(r) => `${r.land_type}-${r.irrigation_type}`}
            size="small"
            dataSource={checks.data.no_rate}
            pagination={false}
            title={() => tx('রেট নেই এমন জমি')}
            columns={[
              { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type' },
              { title: tx('জমির ধরন'), dataIndex: 'land_type', render: (v) => v || tx('সব ধরনের জমি') },
              { title: tx('জমি'), dataIndex: 'lands', align: 'right', render: (v: number) => digits(v) },
            ]}
          />
        )}
      </Modal>
    </ListFrame>
  )
}
