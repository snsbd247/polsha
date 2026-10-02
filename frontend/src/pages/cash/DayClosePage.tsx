import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Descriptions, Form, Grid, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AuditOutlined,
  CalculatorOutlined,
  CalendarFilled,
  CheckOutlined,
  ClockCircleFilled,
  EyeFilled,
  FileTextOutlined,
  LockOutlined,
  UnlockOutlined,
  WalletFilled,
  WarningFilled,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { Can, useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money, VOUCHER_TYPE_LABEL } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { DENOMINATIONS, JOURNAL_MODULE_LABEL } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact } from '../irrigation/InvoiceDetailPage'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../irrigation/rates.css'
import '../approvals/approvals.css'
import '../loans/loans.css'
import './cash.css'

type Person = { id: number; name_bn: string; name_en: string | null } | null
type Stream = {
  account_id: number
  key: string
  code: string
  name_bn: string
  name_en: string | null
  opening: number
  collections: number
  payments: number
  expected: number
  modules: { module: string; collections: number; payments: number; count: number }[]
}
type DayClose = {
  id: number
  date: string
  opening: string
  collections: string
  payments: string
  expected: string
  actual: string
  difference: string
  breakdown: (Omit<Stream, 'modules'> & { actual: number; difference: number })[]
  denominations: Record<string, number> | null
  note: string | null
  status: string
  closed_at: string | null
  reopen_reason: string | null
  reopened_at: string | null
  closer: Person
  reopener: Person
}
type Summary = {
  date: string
  streams: Stream[]
  opening: number
  collections: number
  payments: number
  expected: number
  vouchers: { id: number; voucher_no: string; voucher_type: string; narration: string | null; module: string | null; account_id: number; debit: number; credit: number }[]
  pending_vouchers: number
  close: DayClose | null
  last_closed: string | null
  unclosed: string[]
}
type Register = Paginated<DayClose> & {
  statuses: Record<string, string>
  unclosed: string[]
  counts: { total: number; with_difference: number; difference: number; reopen_pending: number }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const DAY_TONE: Record<string, string> = { closed: 'fl-tag-green', reopen_pending: 'fl-tag-gold', reopened: 'll-orange' }
const signed = (d: number) => `${d > 0 ? '+' : ''}${money(d)}`

/** Close the cash day (count, tally, lock) or look back over the days already closed (?tab=register). */
export default function DayClosePage() {
  const [search] = useSearchParams()
  return search.get('tab') === 'register' ? <RegisterTab /> : <CloseTab />
}

function DayTabs({ tab }: { tab: 'close' | 'register' }) {
  const navigate = useNavigate()
  return (
    <div className="lk-tabs ap-tabs">
      <button type="button" className={tab === 'close' ? 'on' : ''} onClick={() => navigate('/cash/day-close')}>
        <LockOutlined /> {tx('দিন বন্ধ')}
      </button>
      <button type="button" className={tab === 'register' ? 'on' : ''} onClick={() => navigate('/cash/day-close?tab=register')}>
        <AuditOutlined /> {tx('বন্ধ দিনের রেজিস্টার')}
      </button>
    </div>
  )
}

function CloseTab() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  const [date, setDate] = useState<Dayjs>(search.get('date') ? dayjs(search.get('date')) : dayjs())
  const [actual, setActual] = useState<Record<number, number | null>>({})
  const [notes, setNotes] = useState<Record<number, number | null>>({})
  const [note, setNote] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reopening, setReopening] = useState<DayClose | null>(null)
  const ds = date.format('YYYY-MM-DD')
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['day-closes', 'summary', ds],
    queryFn: async () => (await api.get<Summary>('/day-closes/summary', { params: { date: ds } })).data,
    placeholderData: keepPreviousData,
  })

  // a fresh day starts with "counted = expected"; a closed day shows what was counted
  useEffect(() => {
    if (!data) return
    const fromClose = Object.fromEntries((data.close?.breakdown ?? []).map((b) => [b.account_id, b.actual]))
    setActual(Object.fromEntries(data.streams.map((s) => [s.account_id, fromClose[s.account_id] ?? s.expected])))
    setNotes(Object.fromEntries(Object.entries(data.close?.denominations ?? {}).map(([k, v]) => [Number(k), v])))
    setNote(data.close?.note ?? '')
  }, [data])

  if (isLoading || !data) return <Spin />
  const closed = data.close && data.close.status !== 'reopened'
  const diffOf = (s: Stream) => r2(Number(actual[s.account_id] ?? 0) - s.expected)
  const actualTotal = r2(data.streams.reduce((t, s) => t + Number(actual[s.account_id] ?? 0), 0))
  const difference = r2(actualTotal - data.expected)
  const hasDiff = data.streams.some((s) => diffOf(s) !== 0)
  const counted = DENOMINATIONS.reduce((t, d) => t + d * Number(notes[d] ?? 0), 0)
  const alreadyClosed = data.last_closed !== null && ds <= data.last_closed

  const close = async () => {
    setSaving(true)
    try {
      await api.post('/day-closes', {
        date: ds,
        actual: Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, Number(v ?? 0)])),
        note: note || null,
        denominations: counted ? Object.fromEntries(Object.entries(notes).filter(([, v]) => v)) : null,
      })
      message.success(tx('{{p0}} তারিখের দিন বন্ধ হয়েছে।', { p0: fmtDate(ds) }))
      queryClient.invalidateQueries({ queryKey: ['day-closes'] })
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageFrame
      className="id-page"
      crumbs={[{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }, { label: tx('দিন বন্ধ') }]}
      title={tx('দিন বন্ধ')}
      actions={
        <span className="id-actions cs-day-pick">
          {isFetching && <Spin size="small" />}
          {data.last_closed && <span className="cs-muted">{tx('সর্বশেষ বন্ধ দিন: {{p0}}', { p0: fmtDate(data.last_closed) })}</span>}
          <DatePicker prefix={<CalendarFilled />} value={date} format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} onChange={(d) => d && setDate(d)} />
        </span>
      }
    >
      <DayTabs tab="close" />

      {data.unclosed.length > 0 && (
        <Alert
          className="id-alert"
          type="warning"
          showIcon
          title={tx('নগদ লেনদেন আছে কিন্তু বন্ধ করা হয়নি এমন দিন: {{p0}}টি', { p0: digits(data.unclosed.length) })}
          description={
            <Space wrap>
              {data.unclosed.map((d) => (
                <Button key={d} size="small" onClick={() => setDate(dayjs(d))}>
                  {fmtDate(d)}
                </Button>
              ))}
            </Space>
          }
        />
      )}
      {data.close && (
        <Alert
          className="id-alert"
          type={data.close.status === 'closed' ? 'success' : data.close.status === 'reopen_pending' ? 'warning' : 'info'}
          showIcon
          title={
            data.close.status === 'reopened'
              ? tx('দিনটি অনুমোদনক্রমে পুনরায় খোলা হয়েছে ({{p0}}); আবার বন্ধ করা যাবে।', { p0: fmtDateTime(data.close.reopened_at) })
              : data.close.status === 'reopen_pending'
                ? tx('দিন খোলার অনুরোধ অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: data.close.reopen_reason ?? '' })
                : tx('দিনটি বন্ধ — {{p0}}, {{p1}}। এই দিনে আর কোনো নগদ লেনদেন করা যাবে না।', { p0: nameOf(data.close.closer), p1: fmtDateTime(data.close.closed_at) })
          }
          action={
            data.close.status === 'closed' &&
            can('cash.edit') && (
              <Button size="small" icon={<UnlockOutlined />} onClick={() => setReopening(data.close)}>
                {tx('খোলার অনুরোধ')}
              </Button>
            )
          }
        />
      )}
      {data.pending_vouchers > 0 && <Alert className="id-alert" type="error" showIcon title={tx('এই দিনের {{p0}}টি নগদ ভাউচার অনুমোদনের অপেক্ষায় — আগে নিষ্পত্তি করুন, তারপর দিন বন্ধ করুন।', { p0: digits(data.pending_vouchers) })} />}

      <div className="id-top cs-facts">
        <Fact icon={<CalculatorOutlined />} label={tx('খাতা অনুযায়ী থাকার কথা')} color="#8b3fe0" tint="#efe4fc">
          <strong>৳ {money(data.expected)}</strong>
          <small>{tx('আগের জের ৳{{p0}} + আদায় ৳{{p1}} − প্রদান ৳{{p2}}', { p0: money(data.opening), p1: money(data.collections), p2: money(data.payments) })}</small>
        </Fact>
        <Fact icon={<WalletFilled />} label={tx('গুনে পাওয়া নগদ')} color="#0e9f9a" tint="#d9f4f2">
          <strong>৳ {money(actualTotal)}</strong>
        </Fact>
        <Fact icon={difference === 0 ? <CheckOutlined /> : <WarningFilled />} label={tx('গরমিল')} color={difference === 0 ? '#1f9d55' : '#e5383b'} tint={difference === 0 ? '#dcf3e5' : '#fde4e5'}>
          <strong className={difference === 0 ? 'cs-in' : 'cs-out'}>৳ {signed(difference)}</strong>
        </Fact>
      </div>

      <Box icon={<WalletFilled />} title={tx('নগদ খাতভিত্তিক হিসাব')}>
        <Table<Stream>
          rowKey="account_id"
          size="small"
          className="id-payments"
          pagination={false}
          dataSource={data.streams}
          scroll={{ x: 'max-content' }}
          expandable={{
            rowExpandable: (s) => s.modules.length > 0,
            expandedRowRender: (s) => (
              <Table
                rowKey="module"
                size="small"
                pagination={false}
                dataSource={s.modules}
                columns={[
                  { title: tx('মডিউল'), dataIndex: 'module', render: (m: string) => JOURNAL_MODULE_LABEL[m] ?? m },
                  { title: tx('লেনদেন'), dataIndex: 'count', align: 'right', render: digits },
                  { title: tx('আদায় (৳)'), dataIndex: 'collections', align: 'right', render: money },
                  { title: tx('প্রদান (৳)'), dataIndex: 'payments', align: 'right', render: money },
                ]}
              />
            ),
          }}
          columns={[
            { title: tx('নগদ খাত'), render: (_, s) => `${digits(s.code)} — ${nameOf(s)}` },
            { title: tx('প্রারম্ভিক (৳)'), dataIndex: 'opening', align: 'right', render: money },
            { title: tx('আদায় (৳)'), dataIndex: 'collections', align: 'right', render: (v: number) => <span className={v ? 'cs-in' : undefined}>{money(v)}</span> },
            { title: tx('প্রদান (৳)'), dataIndex: 'payments', align: 'right', render: (v: number) => <span className={v ? 'cs-out' : undefined}>{money(v)}</span> },
            { title: tx('প্রত্যাশিত (৳)'), dataIndex: 'expected', align: 'right', render: (v) => <strong>{money(v)}</strong> },
            {
              title: tx('গুনে পাওয়া নগদ (৳)'),
              width: 170,
              render: (_, s) => <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!!closed} value={actual[s.account_id]} onChange={(v) => setActual((a) => ({ ...a, [s.account_id]: v }))} />,
            },
            {
              title: tx('গরমিল (৳)'),
              align: 'right',
              render: (_, s) => {
                const d = diffOf(s)
                return <span className={d === 0 ? 'cs-in' : 'cs-out'}>{signed(d)}</span>
              },
            },
          ]}
        />
      </Box>

      <div className={showNotes ? 'id-two' : undefined}>
        {showNotes && (
          <Box icon={<CalculatorOutlined />} title={tx('নোট গণনা (ঐচ্ছিক)')}>
            <Table
              rowKey={(d) => d}
              size="small"
              className="id-payments"
              pagination={false}
              dataSource={DENOMINATIONS}
              columns={[
                { title: tx('নোট/কয়েন'), render: (_, d) => `৳ ${digits(d)}` },
                {
                  title: tx('সংখ্যা'),
                  width: 140,
                  render: (_, d) => <InputNumber min={0} precision={0} disabled={!!closed} value={notes[d]} onChange={(v) => setNotes((n) => ({ ...n, [d]: v }))} />,
                },
                { title: tx('টাকা (৳)'), align: 'right', render: (_, d) => money(d * Number(notes[d] ?? 0)) },
              ]}
              summary={() => (
                <Table.Summary.Row className="ln-sum-row">
                  <Table.Summary.Cell index={0} colSpan={2}>
                    {tx('মোট গণনা')}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    {money(counted)}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
            {counted > 0 && r2(counted) !== actualTotal && (
              <div className="ln-limit">
                <Alert type="warning" showIcon title={tx('নোট গণনার মোট (৳{{p0}}) ও খাতভিত্তিক প্রকৃত নগদের মোট (৳{{p1}}) মিলছে না।', { p0: money(counted), p1: money(actualTotal) })} />
              </div>
            )}
          </Box>
        )}
        <Box icon={<LockOutlined />} title={tx('দিন বন্ধ')}>
          {!showNotes && !closed && (
            <div className="ln-limit" style={{ paddingBottom: 0 }}>
              <Button type="link" icon={<CalculatorOutlined />} onClick={() => setShowNotes(true)} style={{ paddingInline: 0 }}>
                {tx('নোট গুনে হিসাব করুন (ঐচ্ছিক)')}
              </Button>
            </div>
          )}
          <div className="ln-limit">
            <Form layout="vertical">
              <Form.Item label={tx('মন্তব্য / গরমিলের কারণ')} required={hasDiff} validateStatus={hasDiff && !note.trim() ? 'error' : undefined} help={hasDiff && !note.trim() ? tx('গরমিল আছে — কারণ লিখুন।') : undefined}>
                <Input.TextArea rows={4} maxLength={500} showCount disabled={!!closed} value={note} onChange={(e) => setNote(e.target.value)} />
              </Form.Item>
              <Can perm={['cash.create', 'cash.edit']}>
                <Button type="primary" block icon={<LockOutlined />} loading={saving} disabled={!!closed || alreadyClosed || data.pending_vouchers > 0 || (hasDiff && !note.trim())} onClick={close}>
                  {tx('হিসাব মিলিয়ে দিন বন্ধ করুন')}
                </Button>
              </Can>
              {!closed && alreadyClosed && <Alert type="error" showIcon style={{ marginTop: 10 }} title={tx('এই তারিখ বা পরের কোনো দিন আগেই বন্ধ করা হয়েছে।')} />}
            </Form>
          </div>
        </Box>
      </div>

      <Box icon={<FileTextOutlined />} title={tx('এই দিনের নগদ ভাউচার ({{p0}})', { p0: digits(data.vouchers.length) })}>
        <Table
          rowKey={(v) => `${v.id}-${v.account_id}-${v.debit}-${v.credit}`}
          size="small"
          className="id-payments"
          dataSource={data.vouchers}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: tx('এই দিনে কোনো নগদ ভাউচার নেই') }}
          columns={[
            { title: tx('ভাউচার নং'), dataIndex: 'voucher_no', render: (v: string, r) => <Link to={`/accounting/journals/${r.id}`}>{digits(v)}</Link> },
            { title: tx('ধরন'), dataIndex: 'voucher_type', render: (v: string) => VOUCHER_TYPE_LABEL[v] ?? v },
            { title: tx('মডিউল'), dataIndex: 'module', render: (m: string | null) => JOURNAL_MODULE_LABEL[m ?? 'accounting'] ?? m },
            { title: tx('নগদ খাত'), dataIndex: 'account_id', render: (id: number) => nameOf(data.streams.find((s) => s.account_id === id)) },
            { title: tx('বিবরণ'), dataIndex: 'narration', render: (v: string | null) => v || '—' },
            { title: tx('আদায় (৳)'), dataIndex: 'debit', align: 'right', render: (v: number) => (v ? <span className="cs-in">{money(v)}</span> : '') },
            { title: tx('প্রদান (৳)'), dataIndex: 'credit', align: 'right', render: (v: number) => (v ? <span className="cs-out">{money(v)}</span> : '') },
          ]}
        />
      </Box>

      <ReopenModal day={reopening} onClose={() => setReopening(null)} />
    </PageFrame>
  )
}

function ReopenModal({ day, onClose }: { day: DayClose | null; onClose: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const submit = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/day-closes/${day!.id}/reopen`, v)
      message.success(tx('দিন খোলার অনুরোধ অনুমোদনের জন্য পাঠানো হয়েছে।'))
      form.resetFields()
      onClose()
      queryClient.invalidateQueries({ queryKey: ['day-closes'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={!!day} forceRender title={tx('বন্ধ দিন খোলার অনুরোধ — {{p0}}', { p0: fmtDate(day?.date) })} onCancel={onClose} onOk={submit} okText={tx('অনুমোদনে পাঠান')} cancelText={tx('ফিরে যান')}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর দিনটি খুলবে; সংশোধন শেষে আবার বন্ধ করতে হবে।')} />
      <Form form={form} layout="vertical">
        <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
          <Input.TextArea rows={3} maxLength={300} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}

type RegFilters = { from?: string; to?: string; status?: string; with_difference?: number }

function RegisterTab() {
  const navigate = useNavigate()
  const wide = Grid.useBreakpoint().lg
  const [draft, setDraft] = useState<RegFilters>({})
  const [filters, setFilters] = useState<RegFilters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [view, setView] = useState<DayClose | null>(null)
  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['day-closes', params],
    queryFn: async () => (await api.get<Register>('/day-closes', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (f: RegFilters) => {
    setDraft(f)
    setFilters(f)
    setRange({})
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }

  const cards = [
    { key: 'total', label: tx('মোট বন্ধ দিন'), value: c?.total, icon: '', glyph: <CalendarFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'diff', label: tx('গরমিলের দিন · মোট ৳{{p0}}', { p0: money(c?.difference ?? 0) }), value: c?.with_difference, icon: '', glyph: <WarningFilled />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ with_difference: 1 }) },
    { key: 'pending', label: tx('খোলার অনুরোধ অপেক্ষমাণ'), value: c?.reopen_pending, icon: '', glyph: <ClockCircleFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ status: 'reopen_pending' }) },
    { key: 'unclosed', label: tx('বন্ধ হয়নি এমন দিন'), value: data?.unclosed.length, icon: '', glyph: <UnlockOutlined />, color: '#8b3fe0', tint: '#efe4fc', onClick: () => navigate('/cash/day-close') },
  ]

  const columns: ColumnsType<DayClose> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('তারিখ'),
      dataIndex: 'date',
      render: (v: string, r) => (
        <a className="fl-link iv-no" onClick={() => setView(r)}>
          {fmtDate(v)}
        </a>
      ),
    },
    { title: tx('প্রারম্ভিক (৳)'), dataIndex: 'opening', align: 'right', render: money },
    { title: tx('আদায় (৳)'), dataIndex: 'collections', align: 'right', render: money },
    { title: tx('প্রদান (৳)'), dataIndex: 'payments', align: 'right', render: money },
    { title: tx('প্রত্যাশিত (৳)'), dataIndex: 'expected', align: 'right', render: money },
    { title: tx('প্রকৃত (৳)'), dataIndex: 'actual', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    { title: tx('গরমিল (৳)'), dataIndex: 'difference', align: 'right', render: (v: string) => <span className={Number(v) ? 'cs-out' : undefined}>{signed(Number(v))}</span> },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag className={`fl-tag iv-status ${DAY_TONE[s] ?? 'll-gray'}`}>{data?.statuses[s] ?? s}</Tag> },
    { title: tx('বন্ধকারী'), render: (_, r) => nameOf(r.closer) || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setView(r)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }}
      title={tx('নগদ অডিট')}
      subtitle=""
      cards={cards}
      above={<DayTabs tab="register" />}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.status ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.statuses ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </Field>
          <Field label={tx('গরমিল')}>
            <Select
              value={draft.with_difference ?? 0}
              options={[
                { value: 0, label: tx('সকল') },
                { value: 1, label: tx('শুধু গরমিলের দিন') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, with_difference: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('বন্ধ দিনের রেজিস্টার'), p1: n0(total) })}
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
      <Table<DayClose>
        className="fl-table ml-table pl-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো বন্ধ দিন পাওয়া যায়নি') }}
      />
      <Modal open={!!view} title={tx('দিন বন্ধের বিবরণ — {{p0}}', { p0: fmtDate(view?.date) })} footer={null} onCancel={() => setView(null)} width={720}>
        {view && (
          <>
            <Table
              rowKey="account_id"
              size="small"
              pagination={false}
              dataSource={view.breakdown}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: tx('নগদ খাত'), render: (_, s) => nameOf(s) },
                { title: tx('প্রত্যাশিত (৳)'), dataIndex: 'expected', align: 'right', render: money },
                { title: tx('প্রকৃত (৳)'), dataIndex: 'actual', align: 'right', render: money },
                { title: tx('গরমিল (৳)'), dataIndex: 'difference', align: 'right', render: (v: number) => <span className={Number(v) ? 'cs-out' : undefined}>{signed(Number(v))}</span> },
              ]}
            />
            <Descriptions column={1} size="small" bordered style={{ marginTop: 12 }}>
              <Descriptions.Item label={tx('মন্তব্য')}>{view.note || '—'}</Descriptions.Item>
              {view.denominations && (
                <Descriptions.Item label={tx('নোট গণনা')}>
                  {Object.entries(view.denominations)
                    .filter(([, n]) => n)
                    .map(([d, n]) => `৳${digits(d)} × ${digits(n)}`)
                    .join(', ')}
                </Descriptions.Item>
              )}
              <Descriptions.Item label={tx('বন্ধকারী')}>
                {nameOf(view.closer)} · {fmtDateTime(view.closed_at)}
              </Descriptions.Item>
              {view.reopen_reason && <Descriptions.Item label={tx('খোলার কারণ')}>{view.reopen_reason}</Descriptions.Item>}
              {view.reopener && (
                <Descriptions.Item label={tx('পুনরায় খোলা')}>
                  {nameOf(view.reopener)} · {fmtDateTime(view.reopened_at)}
                </Descriptions.Item>
              )}
            </Descriptions>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button onClick={() => navigate(`/cash/day-close?date=${dayjs(view.date).format('YYYY-MM-DD')}`)}>{tx('এই দিনটি খুলে দেখুন')}</Button>
            </div>
          </>
        )}
      </Modal>
    </ListFrame>
  )
}
