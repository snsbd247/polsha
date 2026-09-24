import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Spin, Table, Tag } from 'antd'
import { CheckOutlined, DeleteOutlined, DisconnectOutlined, EditOutlined, LinkOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountFilter, accountLabel, money, useAccountOptions } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime, toEnDigits } from '../../lib/format'
import { REC_STATUS_COLOR } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { bankLabel, periodLabel, type BankLite } from './BankReconciliationListPage'

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
  return <span style={{ color: n < 0 ? '#cf1322' : '#389e0d' }}>{money(n)}</span>
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
      onOk: () => act(() => api.post(`/bank-reconciliations/${rec.id}/finalize`), () => tx('রিকনসিলিয়েশন চূড়ান্ত হয়েছে।')),
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

  return (
    <>
      <div className="page-header">
        <h2>
          {tx('ব্যাংক রিকনসিলিয়েশন — {{p0}}', { p0: periodLabel(rec.period) })} <Tag color={REC_STATUS_COLOR[rec.status]}>{data.statuses[rec.status] ?? rec.status}</Tag>
        </h2>
        {draft && (
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              {tx('স্টেটমেন্ট লাইন যোগ')}
            </Button>
            <Button icon={<ThunderboltOutlined />} loading={busy} onClick={() => act(() => api.post(`/bank-reconciliations/${rec.id}/auto-match`), (d) => tx('{{p0}}টি লাইন স্বয়ংক্রিয়ভাবে মিলেছে।', { p0: digits(d.matched ?? 0) }))}>
              {tx('স্বয়ংক্রিয় মিল')}
            </Button>
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              {tx('জের সংশোধন')}
            </Button>
            <Button type="primary" icon={<CheckOutlined />} disabled={t.difference !== 0 || t.statement_gap !== 0} onClick={finalize}>
              {tx('চূড়ান্ত করুন')}
            </Button>
            <Popconfirm title={tx('এই রিকনসিলিয়েশন মুছে ফেলবেন?')} okText={tx('মুছুন')} cancelText={tx('না')} onConfirm={remove}>
              <Button danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        )}
      </div>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card size="small" title={tx('ব্যাংক স্টেটমেন্ট')} style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={tx('ব্যাংক হিসাব')}>{bankLabel(rec.bank_account)}</Descriptions.Item>
              <Descriptions.Item label={tx('লেজার হিসাব')}>{accountLabel(rec.bank_account.account)}</Descriptions.Item>
              <Descriptions.Item label={tx('প্রারম্ভিক জের')}>৳{money(t.statement_opening)}</Descriptions.Item>
              <Descriptions.Item label={tx('স্টেটমেন্ট লাইনের নিট')}>৳{money(t.statement_lines)}</Descriptions.Item>
              <Descriptions.Item label={tx('সমাপনী জের')}>৳{money(t.statement_closing)}</Descriptions.Item>
              {t.statement_gap !== 0 && (
                <Descriptions.Item label={tx('স্টেটমেন্টে অসঙ্গতি')}>
                  <span style={{ color: '#cf1322' }}>৳{money(t.statement_gap)}</span>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title={tx('মিলকরণ')} style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={tx('খাতার জের (মাস শেষে)')}>৳{money(t.book_closing)}</Descriptions.Item>
              <Descriptions.Item label={tx('(−) খাতায় আছে, ব্যাংকে ওঠেনি')}>৳{money(t.unmatched_book)}</Descriptions.Item>
              <Descriptions.Item label={tx('(+) ব্যাংকে আছে, খাতায় নেই')}>৳{money(t.unmatched_bank)}</Descriptions.Item>
              <Descriptions.Item label={tx('সমন্বিত খাতার জের')}>৳{money(t.adjusted_book)}</Descriptions.Item>
              <Descriptions.Item label={tx('পার্থক্য')}>
                <strong style={{ color: t.difference === 0 ? '#389e0d' : '#cf1322' }}>৳{money(t.difference)}</strong>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
      {rec.status === 'finalized' && (
        <Alert type="success" showIcon style={{ marginBottom: 16 }} title={tx('চূড়ান্ত করেছেন {{p0}}, {{p1}}', { p0: nameOf(rec.finalizer), p1: fmtDateTime(rec.finalized_at) })} />
      )}
      {draft && t.statement_gap !== 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={tx('প্রারম্ভিক জের + লাইনের নিট ≠ সমাপনী জের — কোনো স্টেটমেন্ট লাইন বাদ পড়েছে বা জের ভুল।')} />
      )}

      <Card size="small" title={tx('স্টেটমেন্ট লাইন ({{p0}}টি)', { p0: digits(data.lines.length) })} style={{ marginBottom: 16 }}>
        <Table<StmtLine>
          rowKey="id"
          size="small"
          dataSource={data.lines}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 900 }}
          columns={[
            { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
            { title: tx('বিবরণ'), dataIndex: 'description' },
            { title: tx('রেফারেন্স'), dataIndex: 'reference', render: (v) => digits(v ?? '') },
            { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: signed },
            {
              title: tx('মেলানো ভাউচার'),
              render: (_, l) =>
                l.journal_line ? (
                  <Link to={`/accounting/journals/${l.journal_line.journal.id}`}>{digits(l.journal_line.journal.voucher_no)}</Link>
                ) : (
                  <Tag color="orange">{tx('মেলেনি')}</Tag>
                ),
            },
            ...(draft
              ? [
                  {
                    title: '',
                    width: 230,
                    render: (_: unknown, l: StmtLine) =>
                      l.journal_line_id ? (
                        <Button size="small" icon={<DisconnectOutlined />} onClick={() => act(() => api.post(`/bank-reconciliations/${rec.id}/lines/${l.id}/unmatch`))}>
                          {tx('মিল বাতিল')}
                        </Button>
                      ) : (
                        <Space size={4}>
                          <Button size="small" icon={<LinkOutlined />} onClick={() => setMatching(l)}>
                            {tx('মেলান')}
                          </Button>
                          <Button size="small" onClick={() => setBooking(l)}>
                            {tx('খাতায় তুলুন')}
                          </Button>
                          <Popconfirm title={tx('লাইনটি মুছবেন?')} okText={tx('মুছুন')} cancelText={tx('না')} onConfirm={() => act(() => api.delete(`/bank-reconciliations/${rec.id}/lines/${l.id}`))}>
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Card size="small" title={tx('খাতার লেনদেন (ব্যাংক লেজার)')}>
        <Table<BookLine>
          rowKey="id"
          size="small"
          dataSource={data.book}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 800 }}
          columns={[
            { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
            { title: tx('ভাউচার নং'), dataIndex: 'voucher_no', render: (v: string) => digits(v) },
            { title: tx('বিবরণ'), render: (_, b) => b.narration ?? b.remarks },
            { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: signed },
            {
              title: tx('অবস্থা'),
              render: (_, b) =>
                b.matched_here ? (
                  <Tag color="green">{tx('এই মাসে মিলেছে')}</Tag>
                ) : b.reconciled ? (
                  <Tag>{tx('আগে মিলেছে')}</Tag>
                ) : (
                  <Tag color="orange">{b.earlier ? tx('আগের মাসের বকেয়া') : tx('ব্যাংকে ওঠেনি')}</Tag>
                ),
            },
          ]}
        />
      </Card>

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
        onPick={async (acc) => (await act(() => api.post(`/bank-reconciliations/${rec.id}/lines/${booking!.id}/book`, { account_id: acc }), () => tx('খাতায় ভাউচার তৈরি হয়ে লাইনটি মিলেছে।'))) && setBooking(null)}
      />
    </>
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
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={amount < 0 ? tx('ব্যাংক চার্জ/উত্তোলন — বাছাই করা হিসাব ডেবিট, ব্যাংক ক্রেডিট হবে।') : tx('ব্যাংক জমা/সুদ — ব্যাংক ডেবিট, বাছাই করা হিসাব ক্রেডিট হবে।')}
          />
          <Select style={{ width: '100%' }} placeholder={tx('বিপরীত হিসাব (যেমন: ব্যাংক চার্জ, ব্যাংক সুদ)')} options={options} value={account} onChange={setAccount} showSearch={{ filterOption: accountFilter }} />
        </>
      )}
    </Modal>
  )
}
