import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tag } from 'antd'
import {
  ArrowLeftOutlined,
  BankFilled,
  BookFilled,
  CalculatorOutlined,
  CheckOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  FileTextFilled,
  LinkOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  WarningFilled,
} from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountFilter, accountLabel, money, useAccountOptions } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime, toEnDigits } from '../../lib/format'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import { bankLabel, periodLabel, type BankLite } from './BankReconciliationListPage'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../loans/loans.css'
import '../cash/cash.css'
import './accounting.css'

type Person = { id: number; name_bn: string; name_en: string | null } | null
type StmtLine = {
  id: number
  date: string
  description: string | null
  reference: string | null
  amount: string
  journal_line_id: number | null
  journal_line: { id: number; journal: { id: number; voucher_no: string; date: string; narration: string | null } } | null
}
type BookLine = { id: number; date: string; voucher_no: string; narration: string | null; remarks: string | null; amount: number; reconciled: boolean; matched_here: boolean; earlier: boolean }
type View = {
  reconciliation: {
    id: number
    period: string
    statement_opening: string
    statement_closing: string
    status: string
    note: string | null
    finalized_at: string | null
    bank_account: BankLite & { account: { id: number; code: string; name_bn: string; name_en: string | null } }
    creator: Person
    finalizer: Person
  }
  lines: StmtLine[]
  book: BookLine[]
  totals: {
    statement_opening: number
    statement_lines: number
    statement_closing: number
    statement_gap: number
    book_closing: number
    unmatched_book: number
    unmatched_bank: number
    adjusted_book: number
    difference: number
  }
  statuses: Record<string, string>
}

const signed = (v: number | string) => {
  const n = Number(v)
  return <span className={n < 0 ? 'cs-out' : 'cs-in'}>{money(n)}</span>
}

/** "date, description, reference, amount" per line — dates as DD/MM/YYYY or YYYY-MM-DD. */
function parsePasted(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.split(/\t|,/).map((c) => c.trim()))
    .filter((c) => c.length >= 2 && c[0])
    .map((c) => {
      const raw = toEnDigits(c[0])
      const d = /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(raw) ? dayjs(raw.replace(/-/g, '/'), 'D/M/YYYY') : dayjs(raw)
      const amount = Number(toEnDigits(c[c.length - 1]).replace(/[^\d.-]/g, ''))
      return { date: d.isValid() ? d : null, description: c.length > 2 ? c[1] : null, reference: c.length > 3 ? c[2] : null, amount: Number.isFinite(amount) ? amount : null }
    })
}

export default function BankReconciliationDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [matching, setMatching] = useState<StmtLine | null>(null)
  const [booking, setBooking] = useState<StmtLine | null>(null)
  const [busy, setBusy] = useState(false)
  const key = ['bank-reconciliations', id]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: async () => (await api.get<View>(`/bank-reconciliations/${id}`)).data })
  if (isLoading || !data) return <Spin />
  const rec = data.reconciliation
  const t = data.totals
  const draft = rec.status === 'draft' && can('bank.edit')

  const act = async (fn: () => Promise<{ data: View & { matched?: number } }>, ok?: (d: View & { matched?: number }) => string) => {
    setBusy(true)
    try {
      const res = await fn()
      queryClient.setQueryData(key, res.data)
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliations'], exact: false, refetchType: 'none' })
      if (ok) message.success(ok(res.data))
      return true
    } catch (e) {
      message.error(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const finalize = () =>
    modal.confirm({
      title: tx('রিকনসিলিয়েশন চূড়ান্ত করবেন?'),
      content: tx('চূড়ান্ত করার পর মেলানো লেনদেনগুলো লক হয়ে যাবে, আর পরিবর্তন করা যাবে না।'),
      okText: tx('চূড়ান্ত করুন'),
      cancelText: tx('বাতিল'),
      onOk: () =>
        act(
          () => api.post(`/bank-reconciliations/${rec.id}/finalize`),
          () => tx('রিকনসিলিয়েশন চূড়ান্ত হয়েছে।'),
        ),
    })

  const remove = async () => {
    try {
      await api.delete(`/bank-reconciliations/${rec.id}`)
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliations'] })
      navigate('/accounting/bank-reconciliations')
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const matched = data.lines.filter((l) => l.journal_line_id).length
  const balanced = t.difference === 0 && t.statement_gap === 0

  return (
    <PageFrame
      className="id-page ln-page"
      crumbs={[{ label: tx('হিসাব'), to: '/accounting/summary' }, { label: tx('মাসিক ব্যাংক মিলকরণ'), to: '/accounting/bank-reconciliations' }, { label: tx('মিলকরণের বিস্তারিত') }]}
      title={tx('মিলকরণের বিস্তারিত')}
      actions={
        <span className="id-actions">
          {draft && (
            <>
              <Button icon={<PlusOutlined />} className="fm-history-btn" onClick={() => setAdding(true)}>
                {tx('স্টেটমেন্ট লাইন যোগ')}
              </Button>
              <Button
                icon={<ThunderboltOutlined />}
                className="fm-history-btn"
                loading={busy}
                onClick={() =>
                  act(
                    () => api.post(`/bank-reconciliations/${rec.id}/auto-match`),
                    (d) => tx('{{p0}}টি লাইন স্বয়ংক্রিয়ভাবে মিলেছে।', { p0: digits(d.matched ?? 0) }),
                  )
                }
              >
                {tx('স্বয়ংক্রিয় মিল')}
              </Button>
              <Button icon={<EditOutlined />} className="fm-history-btn" onClick={() => setEditing(true)}>
                {tx('জের সংশোধন')}
              </Button>
              <Button type="primary" icon={<CheckOutlined />} disabled={!balanced} onClick={finalize}>
                {tx('চূড়ান্ত করুন')}
              </Button>
              <Popconfirm title={tx('এই মিলকরণ মুছে ফেলবেন?')} okText={tx('মুছুন')} cancelText={tx('না')} onConfirm={remove}>
                <Button danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} />
              </Popconfirm>
            </>
          )}
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/accounting/bank-reconciliations')}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </span>
      }
    >
      {rec.status === 'finalized' && <Alert className="id-alert" type="success" showIcon title={tx('চূড়ান্ত করেছেন {{p0}}, {{p1}}', { p0: nameOf(rec.finalizer), p1: fmtDateTime(rec.finalized_at) })} />}
      {draft && t.statement_gap !== 0 && <Alert className="id-alert" type="warning" showIcon title={tx('প্রারম্ভিক জের + লাইনের নিট ≠ সমাপনী জের — কোনো স্টেটমেন্ট লাইন বাদ পড়েছে বা জের ভুল।')} />}

      <div className="id-top">
        <div className="id-hero">
          <span className="id-hero-icon">
            <BankFilled />
          </span>
          <div>
            <small>{rec.bank_account.bank_name}</small>
            <strong>{periodLabel(rec.period)}</strong>
            <Tag className={`fl-tag ${rec.status === 'finalized' ? 'fl-tag-green' : 'fl-tag-gold'}`}>● {data.statuses[rec.status] ?? rec.status}</Tag>
          </div>
        </div>
        <Fact icon={<FileTextFilled />} label={tx('স্টেটমেন্টের সমাপনী জের')} color="#1769e0" tint="#e4edfd">
          <strong>৳ {money(t.statement_closing)}</strong>
        </Fact>
        <Fact icon={<BookFilled />} label={tx('সমন্বিত খাতার জের')} color="#8b3fe0" tint="#efe4fc">
          <strong>৳ {money(t.adjusted_book)}</strong>
        </Fact>
        <Fact icon={balanced ? <CheckOutlined /> : <WarningFilled />} label={tx('পার্থক্য')} color={t.difference === 0 ? '#1f9d55' : '#e5383b'} tint={t.difference === 0 ? '#dcf3e5' : '#fde4e5'}>
          <strong className={t.difference === 0 ? 'cs-in' : 'cs-out'}>৳ {money(t.difference)}</strong>
        </Fact>
        <Fact icon={<LinkOutlined />} label={tx('মেলানো স্টেটমেন্ট লাইন')} color="#f08c00" tint="#fdefd6">
          <strong>
            {digits(matched)} / {digits(data.lines.length)}
          </strong>
        </Fact>
      </div>

      <div className="id-two">
        <Box icon={<BankFilled />} title={tx('ব্যাংক স্টেটমেন্ট')}>
          <KV
            rows={[
              [tx('ব্যাংক হিসাব'), bankLabel(rec.bank_account)],
              [tx('লেজার হিসাব'), <Link to={`/accounting/ledger?account_id=${rec.bank_account.account.id}`}>{accountLabel(rec.bank_account.account)}</Link>],
              [tx('প্রারম্ভিক জের'), `৳ ${money(t.statement_opening)}`],
              [tx('স্টেটমেন্ট লাইনের নিট'), `৳ ${money(t.statement_lines)}`],
              [tx('সমাপনী জের'), `৳ ${money(t.statement_closing)}`],
              [tx('স্টেটমেন্টে অসঙ্গতি'), t.statement_gap ? <span className="cs-out">৳ {money(t.statement_gap)}</span> : '—'],
            ]}
          />
        </Box>
        <Box icon={<CalculatorOutlined />} title={tx('মিলকরণ')}>
          <KV
            rows={[
              [tx('খাতার জের (মাস শেষে)'), `৳ ${money(t.book_closing)}`],
              [tx('(−) খাতায় আছে, ব্যাংকে ওঠেনি'), `৳ ${money(t.unmatched_book)}`],
              [tx('(+) ব্যাংকে আছে, খাতায় নেই'), `৳ ${money(t.unmatched_bank)}`],
              [tx('সমন্বিত খাতার জের'), `৳ ${money(t.adjusted_book)}`],
              [tx('পার্থক্য'), <strong className={t.difference === 0 ? 'cs-in' : 'cs-out'}>৳ {money(t.difference)}</strong>],
              [tx('প্রস্তুতকারী'), nameOf(rec.creator) || '—'],
            ]}
          />
        </Box>
      </div>

      <Box icon={<UnorderedListOutlined />} title={tx('স্টেটমেন্ট লাইন ({{p0}}টি)', { p0: digits(data.lines.length) })}>
        <Table<StmtLine>
          rowKey="id"
          size="small"
          className="id-payments"
          dataSource={data.lines}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: tx('এখনও কোনো স্টেটমেন্ট লাইন নেই — "স্টেটমেন্ট লাইন যোগ" চাপুন।') }}
          columns={[
            { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
            { title: tx('বিবরণ'), dataIndex: 'description', render: (v: string | null) => v || '—' },
            { title: tx('রেফারেন্স'), dataIndex: 'reference', render: (v) => (v ? digits(v) : '—') },
            { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: signed },
            {
              title: tx('মেলানো ভাউচার'),
              render: (_, l) => (l.journal_line ? <Link to={`/accounting/journals/${l.journal_line.journal.id}`}>{digits(l.journal_line.journal.voucher_no)}</Link> : <Tag className="fl-tag ll-orange">{tx('মেলেনি')}</Tag>),
            },
            ...(draft
              ? [
                  {
                    title: tx('অ্যাকশন'),
                    render: (_: unknown, l: StmtLine) =>
                      l.journal_line_id ? (
                        <Button size="small" icon={<DisconnectOutlined />} onClick={() => act(() => api.post(`/bank-reconciliations/${rec.id}/lines/${l.id}/unmatch`))}>
                          {tx('মিল বাতিল')}
                        </Button>
                      ) : (
                        <Space size={4}>
                          <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => setMatching(l)}>
                            {tx('মেলান')}
                          </Button>
                          <Button size="small" onClick={() => setBooking(l)}>
                            {tx('খাতায় তুলুন')}
                          </Button>
                          <Popconfirm title={tx('লাইনটি মুছবেন?')} okText={tx('মুছুন')} cancelText={tx('না')} onConfirm={() => act(() => api.delete(`/bank-reconciliations/${rec.id}/lines/${l.id}`))}>
                            <Button size="small" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} />
                          </Popconfirm>
                        </Space>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </Box>

      <Box icon={<BookFilled />} title={tx('খাতার লেনদেন (ব্যাংক লেজার)')} className="rc-book">
        <Table<BookLine>
          rowKey="id"
          size="small"
          className="id-payments"
          dataSource={data.book}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: tx('এই মাসে ব্যাংক লেজারে কোনো লেনদেন নেই') }}
          columns={[
            { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
            { title: tx('ভাউচার নং'), dataIndex: 'voucher_no', render: (v: string) => digits(v) },
            { title: tx('বিবরণ'), render: (_, b) => b.narration ?? b.remarks ?? '—' },
            { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: signed },
            {
              title: tx('অবস্থা'),
              render: (_, b) =>
                b.matched_here ? (
                  <Tag className="fl-tag fl-tag-green">{tx('এই মাসে মিলেছে')}</Tag>
                ) : b.reconciled ? (
                  <Tag className="fl-tag ll-gray">{tx('আগে মিলেছে')}</Tag>
                ) : (
                  <Tag className="fl-tag ll-orange">{b.earlier ? tx('আগের মাসের বকেয়া') : tx('ব্যাংকে ওঠেনি')}</Tag>
                ),
            },
          ]}
        />
      </Box>

      <AddLinesModal open={adding} recId={rec.id} period={rec.period} onClose={() => setAdding(false)} onSaved={(v) => queryClient.setQueryData(key, v)} />
      <EditModal open={editing} rec={rec} onClose={() => setEditing(false)} onSaved={(v) => queryClient.setQueryData(key, v)} />
      <MatchModal
        line={matching}
        book={data.book.filter((b) => !b.reconciled)}
        onClose={() => setMatching(null)}
        onPick={async (jl) => (await act(() => api.post(`/bank-reconciliations/${rec.id}/lines/${matching!.id}/match`, { journal_line_id: jl }))) && setMatching(null)}
      />
      <BookModal
        line={booking}
        bankAccountId={rec.bank_account.account_id}
        onClose={() => setBooking(null)}
        onPick={async (acc) =>
          (await act(
            () => api.post(`/bank-reconciliations/${rec.id}/lines/${booking!.id}/book`, { account_id: acc }),
            () => tx('খাতায় ভাউচার তৈরি হয়ে লাইনটি মিলেছে।'),
          )) && setBooking(null)
        }
      />
    </PageFrame>
  )
}

function AddLinesModal({ open, recId, period, onClose, onSaved }: { open: boolean; recId: number; period: string; onClose: () => void; onSaved: (v: View) => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [paste, setPaste] = useState('')
  const month = dayjs(`${period}-01`)
  const importPaste = () => {
    const rows = parsePasted(paste)
    if (!rows.length) return message.warning(tx('কোনো লাইন পড়া যায়নি।'))
    const current = (form.getFieldValue('lines') ?? []).filter((l: { amount?: number }) => l?.amount)
    form.setFieldValue('lines', [...current, ...rows])
    setPaste('')
  }
  const submit = async () => {
    const v = await form.validateFields()
    try {
      const { data } = await api.post<View>(`/bank-reconciliations/${recId}/lines`, {
        lines: v.lines.map((l: { date: dayjs.Dayjs; amount: number; description?: string; reference?: string }) => ({ ...l, date: l.date.format('YYYY-MM-DD') })),
      })
      onSaved(data)
      form.resetFields()
      onClose()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={open} forceRender width={860} title={tx('স্টেটমেন্ট লাইন যোগ')} onCancel={onClose} onOk={submit} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('জমা ধনাত্মক (+), উত্তোলন/চার্জ ঋণাত্মক (−) সংখ্যায় লিখুন।')} />
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input.TextArea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={tx('Excel থেকে পেস্ট করুন: তারিখ, বিবরণ, রেফারেন্স, টাকা')} />
        <Button onClick={importPaste}>{tx('পড়ুন')}</Button>
      </Space.Compact>
      <Form form={form} initialValues={{ lines: [{}] }}>
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space key={f.key} align="start" wrap style={{ display: 'flex' }}>
                  <Form.Item name={[f.name, 'date']} rules={[required(tx('তারিখ'))]}>
                    <DatePicker format="DD/MM/YYYY" defaultPickerValue={month} placeholder={tx('তারিখ')} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'description']}>
                    <Input placeholder={tx('বিবরণ')} style={{ width: 240 }} maxLength={255} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'reference']}>
                    <Input placeholder={tx('রেফারেন্স')} style={{ width: 140 }} maxLength={100} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'amount']} rules={[required(tx('টাকা'))]}>
                    <InputNumber precision={2} placeholder={tx('টাকা')} style={{ width: 140 }} />
                  </Form.Item>
                  <Button icon={<DeleteOutlined />} onClick={() => remove(f.name)} disabled={fields.length === 1} />
                </Space>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()}>
                {tx('আরও লাইন')}
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  )
}

function EditModal({ open, rec, onClose, onSaved }: { open: boolean; rec: View['reconciliation']; onClose: () => void; onSaved: (v: View) => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const submit = async () => {
    const v = await form.validateFields()
    try {
      const { data } = await api.put<View>(`/bank-reconciliations/${rec.id}`, v)
      onSaved(data)
      onClose()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal
      open={open}
      forceRender
      title={tx('স্টেটমেন্টের জের সংশোধন')}
      onCancel={onClose}
      onOk={submit}
      okText={tx('সংরক্ষণ')}
      cancelText={tx('বাতিল')}
      afterOpenChange={(o) => o && form.setFieldsValue({ statement_opening: Number(rec.statement_opening), statement_closing: Number(rec.statement_closing), note: rec.note })}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="statement_opening" label={tx('স্টেটমেন্টের প্রারম্ভিক জের')} rules={[required(tx('প্রারম্ভিক জের লিখুন'))]}>
          <InputNumber precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="statement_closing" label={tx('স্টেটমেন্টের সমাপনী জের')} rules={[required(tx('সমাপনী জের লিখুন'))]}>
          <InputNumber precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label={tx('মন্তব্য')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function MatchModal({ line, book, onClose, onPick }: { line: StmtLine | null; book: BookLine[]; onClose: () => void; onPick: (id: number) => void }) {
  const [all, setAll] = useState(false)
  const amount = Number(line?.amount ?? 0)
  const rows = all ? book : book.filter((b) => b.amount === amount)
  return (
    <Modal open={!!line} width={760} footer={null} title={tx('খাতার লেনদেনের সাথে মেলান')} onCancel={onClose}>
      {line && (
        <>
          <p>
            {fmtDate(line.date)} · {line.description} · <strong>৳{money(amount)}</strong>
          </p>
          <Button size="small" style={{ marginBottom: 8 }} onClick={() => setAll((a) => !a)}>
            {all ? tx('শুধু সমান টাকার লেনদেন') : tx('সব অমিল লেনদেন দেখুন')}
          </Button>
          <Table<BookLine>
            rowKey="id"
            size="small"
            dataSource={rows}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            columns={[
              { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
              { title: tx('ভাউচার নং'), dataIndex: 'voucher_no', render: (v: string) => digits(v) },
              { title: tx('বিবরণ'), render: (_, b) => b.narration ?? b.remarks },
              { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: signed },
              {
                title: '',
                render: (_, b) => (
                  <Button size="small" type="primary" disabled={b.amount !== amount} onClick={() => onPick(b.id)}>
                    {tx('মেলান')}
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
    </Modal>
  )
}

function BookModal({ line, bankAccountId, onClose, onPick }: { line: StmtLine | null; bankAccountId: number; onClose: () => void; onPick: (id: number) => void }) {
  const [account, setAccount] = useState<number>()
  const { data: accounts } = useAccountOptions()
  const amount = Number(line?.amount ?? 0)
  const options = (accounts ?? []).filter((a) => a.id !== bankAccountId && !a.is_cash).map((a) => ({ value: a.id, label: accountLabel(a) }))
  return (
    <Modal
      open={!!line}
      title={tx('ব্যাংকের লেনদেন খাতায় তুলুন')}
      onCancel={onClose}
      okText={tx('ভাউচার তৈরি করুন')}
      cancelText={tx('বাতিল')}
      okButtonProps={{ disabled: !account }}
      onOk={() => account && onPick(account)}
      afterOpenChange={(o) => !o && setAccount(undefined)}
    >
      {line && (
        <>
          <p>
            {fmtDate(line.date)} · {line.description} · <strong>৳{money(amount)}</strong>
          </p>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={amount < 0 ? tx('ব্যাংক চার্জ/উত্তোলন — বাছাই করা হিসাব ডেবিট, ব্যাংক ক্রেডিট হবে।') : tx('ব্যাংক জমা/সুদ — ব্যাংক ডেবিট, বাছাই করা হিসাব ক্রেডিট হবে।')} />
          <Select style={{ width: '100%' }} placeholder={tx('বিপরীত হিসাব (যেমন: ব্যাংক চার্জ, ব্যাংক সুদ)')} options={options} value={account} onChange={setAccount} showSearch={{ filterOption: accountFilter }} />
        </>
      )}
    </Modal>
  )
}
