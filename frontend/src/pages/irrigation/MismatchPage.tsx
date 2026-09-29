import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, Input, Modal, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowDownOutlined, ArrowUpOutlined, ClockCircleOutlined, DatabaseFilled, EyeFilled, FileTextFilled, MessageFilled, SafetyCertificateOutlined, SearchOutlined, CheckOutlined } from '@ant-design/icons'
import { api, type Paginated } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { RECEIPT_STATUS_LABEL, useInvoiceMeta } from '../../lib/irrigation'
import { useLandMeta } from '../../lib/land'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './invoice-detail.css'
import './rates.css'

type Row = {
  id: number
  invoice_no: string
  invoice_date: string
  farmer_id: number
  name_bn: string
  name_en: string | null
  mobile: string | null
  season: string | null
  dag_no: string | null
  land_code: string | null
  land_type: string | null
  irrigation_type: string | null
  expected: number
  collected: number
  difference: number
  state: 'under' | 'over' | 'matched'
}
type Summary = { over: number; under: number; matched: number; mismatch: number; over_amount: number; under_amount: number; difference: number }
type Receipt = { id: number; receipt_no: string; legacy_no: string | null; date: string; status: string; amount: number; remarks: string | null }
type Issue = { kind: string; invoice_id?: number; receipt_id?: number; ref: string; name: string; expected: number; actual: number | null }
type Ledger = { ledger_due: number; book_due: number; difference: number; account: { id: number; code: string; name_bn: string; name_en: string | null }; issues: Issue[]; kinds: Record<string, string> }
type Filters = { search?: string; season_id?: number; land_type_id?: number; irrigation_type_id?: number; state?: string }

const STATE: Record<Row['state'], [string, string]> = { under: ['কম আদায়', 'fl-tag-red'], over: ['বেশি আদায়', 'fl-tag-green'], matched: ['মিল আছে', 'll-gray'] }
const signed = (v: number) => (v > 0 ? `+${money(v)}` : money(v))

/** Each bill against what was collected for it, and a check that invoices, receipts and the ledger agree. */
export default function MismatchPage() {
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [current, setCurrent] = useState<Row | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['irrigation', 'collection-check', params],
    queryFn: async () => (await api.get<Paginated<Row> & { summary: Summary }>('/irrigation/collection-check', { params })).data,
    placeholderData: keepPreviousData,
  })
  const ledger = useQuery({ queryKey: ['irrigation-mismatch'], queryFn: async () => (await api.get<Ledger>('/irrigation/mismatch')).data })
  const rows = data?.data ?? []
  const shown = current ?? rows.find((r) => r.state !== 'matched') ?? rows[0] ?? null
  const receipts = useQuery({ queryKey: ['invoice-receipts', shown?.id], queryFn: async () => (await api.get<Receipt[]>(`/irrigation/invoices/${shown!.id}/receipts`)).data, enabled: !!shown })

  const s = data?.summary
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const ledgerOk = ledger.data && ledger.data.difference === 0 && ledger.data.issues.length === 0
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
    setCurrent(null)
  }

  const cards = [
    { key: 'mis', label: tx('মোট অমিল'), value: s?.mismatch, icon: '', solid: <span className="mm-bang">!</span>, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ ...filters, state: undefined }) },
    { key: 'over', label: tx('বেশি আদায়'), value: s?.over, unit: s ? `(৳ ${money(s.over_amount)})` : undefined, icon: '', glyph: <ArrowUpOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ ...filters, state: 'over' }) },
    { key: 'under', label: tx('কম আদায়'), value: s?.under, unit: s ? `(৳ ${money(s.under_amount)})` : undefined, icon: '', glyph: <ArrowDownOutlined />, color: '#f5a524', tint: '#fdefd6', onClick: () => show({ ...filters, state: 'under' }) },
    { key: 'diff', label: tx('মোট পার্থক্য'), value: s ? Math.round(Math.abs(s.difference)) : undefined, unit: s ? (s.difference < 0 ? tx('টাকা কম আদায়') : tx('টাকা')) : undefined, icon: '', glyph: <DatabaseFilled />, color: '#6b7280', tint: '#eef0f4' },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('কৃষকের নাম'), render: (_, r) => <Link to={`/farmers/${r.farmer_id}`} className="mg-name">{nameOf(r)}</Link> },
    { title: tx('দাগ নং'), dataIndex: 'dag_no', render: (v) => digits(v ?? '—') },
    { title: tx('জমির ধরন'), dataIndex: 'land_type', render: (v) => v ?? '—' },
    { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type', render: (v) => v ?? '—' },
    { title: tx('মৌসুম'), dataIndex: 'season' },
    { title: <span className="mm-blue">{tx('প্রত্যাশিত (৳)')}</span>, dataIndex: 'expected', align: 'right', render: money },
    { title: tx('আদায় (৳)'), dataIndex: 'collected', align: 'right', render: money },
    { title: tx('পার্থক্য (৳)'), dataIndex: 'difference', align: 'right', render: (v: number) => <span className={v < 0 ? 'rt-down' : v > 0 ? 'rt-up' : undefined}>{signed(v)}</span> },
    { title: tx('অবস্থা'), dataIndex: 'state', align: 'center', render: (v: Row['state']) => <Tag className={`fl-tag rt-state ${STATE[v][1]}`}>{tx(STATE[v][0])}</Tag> },
    { title: tx('অ্যাকশন'), width: 60, align: 'center', render: (_, r) => <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setCurrent(r)} /> },
  ]

  const aside = (
    <aside className="mm-panel">
      <section className="id-box">
        <header>
          <EyeFilled />
          <h3>{tx('অমিলের বিস্তারিত')}</h3>
        </header>
        {shown ? (
          <dl className="id-kv">
            {(
              [
                [tx('কৃষকের নাম'), nameOf(shown)],
                [tx('মোবাইল নং'), shown.mobile ? digits(shown.mobile) : '—'],
                [tx('দাগ নং'), digits(shown.dag_no ?? '—')],
                [tx('জমির ধরন'), shown.land_type ?? '—'],
                [tx('সেচের ধরন'), shown.irrigation_type ?? '—'],
                [tx('মৌসুম'), shown.season ?? '—'],
                [tx('ইনভয়েস'), <Link key="i" to={`/irrigation/invoices/${shown.id}`}>{digits(shown.invoice_no)}</Link>],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <span>:</span>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mm-empty">{tx('তালিকা থেকে একটি রেকর্ড বাছাই করুন')}</p>
        )}
      </section>
      {shown && (
        <>
          <section className="id-box">
            <header>
              <FileTextFilled />
              <h3>{tx('টাকার বিস্তারিত')}</h3>
            </header>
            <dl className="id-kv">
              <div>
                <dt>{tx('প্রত্যাশিত বকেয়া')}</dt>
                <span>:</span>
                <dd>৳ {money(shown.expected)}</dd>
              </div>
              <div>
                <dt>{tx('মোট আদায়')}</dt>
                <span>:</span>
                <dd>৳ {money(shown.collected)}</dd>
              </div>
              <div>
                <dt>{tx('পার্থক্য')}</dt>
                <span>:</span>
                <dd className={shown.difference < 0 ? 'rt-down' : shown.difference > 0 ? 'rt-up' : undefined}>৳ {signed(shown.difference)}</dd>
              </div>
              <div>
                <dt>{tx('অবস্থা')}</dt>
                <span>:</span>
                <dd>
                  <Tag className={`fl-tag ${STATE[shown.state][1]}`}>{tx(STATE[shown.state][0])}</Tag>
                </dd>
              </div>
            </dl>
          </section>
          <section className="id-box">
            <header>
              <ClockCircleOutlined />
              <h3>{tx('আদায়ের ইতিহাস')}</h3>
            </header>
            <Table<Receipt>
              size="small"
              rowKey="id"
              pagination={false}
              loading={receipts.isFetching}
              dataSource={receipts.data ?? []}
              locale={{ emptyText: tx('এখনো কোনো আদায় হয়নি') }}
              columns={[
                { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
                { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v: string, r) => <Link to={`/payments/receipts/${r.id}`}>{digits(r.legacy_no ?? v)}</Link> },
                { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: (v: number, r) => (r.status === 'cancelled' ? <s title={RECEIPT_STATUS_LABEL[r.status]}>{money(v)}</s> : money(v)) },
              ]}
            />
          </section>
          <section className="id-box">
            <header>
              <MessageFilled />
              <h3>{tx('মন্তব্য')}</h3>
            </header>
            <p className="mm-note">
              {shown.state === 'under'
                ? tx('কৃষক আংশিক বা কোনো টাকা দেননি; বাকি টাকা বকেয়া আছে।')
                : shown.state === 'over'
                  ? tx('বিলের চেয়ে বেশি আদায় হয়েছে; রশিদ যাচাই করুন।')
                  : tx('বিল ও আদায় মিলেছে।')}
            </p>
          </section>
        </>
      )}
    </aside>
  )

  return (
    <>
      <ListFrame
        section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
        title={tx('বকেয়া অমিল')}
        subtitle={tx('প্রত্যাশিত বকেয়া ও আদায়ের টাকার পার্থক্য খুঁজে বের করুন ও সমাধান করুন।')}
        actions={
          <Button icon={ledgerOk ? <CheckOutlined /> : <SafetyCertificateOutlined />} danger={ledger.data ? !ledgerOk : false} onClick={() => setLedgerOpen(true)}>
            {ledgerOk ? tx('লেজার যাচাই: মিলেছে') : tx('লেজার যাচাই: {{p0}}টি অমিল', { p0: digits(ledger.data?.issues.length ?? 0) })}
          </Button>
        }
        cards={cards}
        aside={aside}
        filterClass="ll-filters rt-filters"
        filters={
          <>
            <Field label={tx('মৌসুম')}>
              <Select value={draft.season_id ?? ''} options={[{ value: '', label: tx('সব মৌসুম') }, ...(meta?.seasons ?? []).map((x) => ({ value: x.id, label: x.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, season_id: v === '' ? undefined : Number(v) }))} />
            </Field>
            <Field label={tx('জমির ধরন')}>
              <Select value={draft.land_type_id ?? ''} options={[{ value: '', label: tx('সব ধরনের জমি') }, ...(landMeta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, land_type_id: v === '' ? undefined : Number(v) }))} />
            </Field>
            <Field label={tx('সেচের ধরন')}>
              <Select value={draft.irrigation_type_id ?? ''} options={[{ value: '', label: tx('সব উৎস') }, ...(meta?.irrigation_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, irrigation_type_id: v === '' ? undefined : Number(v) }))} />
            </Field>
            <Field label={tx('অবস্থা')}>
              <Select value={draft.state ?? ''} options={[{ value: '', label: tx('সকল') }, ...Object.entries(STATE).map(([value, [label]]) => ({ value, label: tx(label) }))]} onChange={(v) => setDraft((d) => ({ ...d, state: v || undefined }))} />
            </Field>
            <span className="ll-break" />
            <Field grow={600}>
              <Input prefix={<SearchOutlined />} allowClear placeholder={tx('কৃষকের নাম, দাগ নং, মোবাইল বা ইনভয়েস নং দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={() => show(draft)} />
            </Field>
          </>
        }
        onSearch={() => show(draft)}
        onReset={() => show({})}
        tableTitle={tx('বকেয়া অমিলের তালিকা')}
        paging={{
          page,
          perPage,
          total,
          showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
          onPage: (p) => {
            setPage(p)
            setCurrent(null)
          },
          onPerPage: (n) => {
            setPerPage(n)
            setPage(1)
          },
        }}
      >
        <Table<Row>
          className="fl-table ml-table pl-table rt-table mm-table"
          rowKey="id"
          loading={isFetching}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={columns}
          onRow={(r) => ({ onClick: () => setCurrent(r) })}
          rowClassName={(r) => (shown?.id === r.id ? 'lt-current' : '')}
          locale={{ emptyText: tx('কোনো অমিল নেই') }}
        />
      </ListFrame>

      <Modal open={ledgerOpen} width={900} footer={null} title={tx('লেজার যাচাই')} onCancel={() => setLedgerOpen(false)}>
        {ledger.data && (
          <>
            <Alert
              type={ledgerOk ? 'success' : 'error'}
              showIcon
              style={{ marginBottom: 12 }}
              title={ledgerOk ? tx('ইনভয়েস, রশিদ ও লেজার সম্পূর্ণ মিলে গেছে।') : tx('অমিল পাওয়া গেছে — নিচের তালিকা দেখে ঠিক করুন।')}
              description={`${tx('লেজারে বকেয়া ({{p0}})', { p0: accountLabel(ledger.data.account) })}: ৳ ${money(ledger.data.ledger_due)} · ${tx('ইনভয়েস অনুযায়ী বকেয়া')}: ৳ ${money(ledger.data.book_due)} · ${tx('পার্থক্য')}: ৳ ${money(ledger.data.difference)}`}
            />
            {!!ledger.data.issues.length && (
              <Table<Issue>
                rowKey={(r) => `${r.kind}-${r.invoice_id ?? r.receipt_id}`}
                size="small"
                dataSource={ledger.data.issues}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                columns={[
                  { title: tx('সমস্যা'), dataIndex: 'kind', render: (k: string) => <Tag color="red">{ledger.data?.kinds[k] ?? k}</Tag> },
                  {
                    title: tx('রেফারেন্স'),
                    dataIndex: 'ref',
                    render: (v: string, r) => (r.invoice_id ? <Link to={`/irrigation/invoices/${r.invoice_id}`}>{digits(v)}</Link> : <Link to={`/payments/receipts/${r.receipt_id}`}>{digits(v)}</Link>),
                  },
                  { title: tx('নাম'), dataIndex: 'name' },
                  { title: tx('প্রত্যাশিত'), dataIndex: 'expected', align: 'right', render: money },
                  { title: tx('বর্তমান'), dataIndex: 'actual', align: 'right', render: (v: number | null) => (v === null ? '—' : money(v)) },
                ]}
              />
            )}
          </>
        )}
      </Modal>
    </>
  )
}
