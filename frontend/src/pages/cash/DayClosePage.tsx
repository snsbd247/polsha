import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Row, Space, Spin, Statistic, Table, Tag, Tabs } from 'antd'
import { LockOutlined, UnlockOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can, useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money, VOUCHER_TYPE_LABEL } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { DAY_STATUS_COLOR, DENOMINATIONS, JOURNAL_MODULE_LABEL } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

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
type Register = Paginated<DayClose> & { statuses: Record<string, string>; unclosed: string[] }

const r2 = (n: number) => Math.round(n * 100) / 100

export default function DayClosePage() {
  const [search] = useSearchParams()
  const [tab, setTab] = useState(search.get('tab') === 'register' ? 'register' : 'close')
  return (
    <>
      <div className="page-header">
        <h2>{tx('দিন শেষের নগদ মিলান')}</h2>
      </div>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'close', label: tx('দিন বন্ধ'), children: <CloseTab /> },
          { key: 'register', label: tx('বন্ধ দিনের রেজিস্টার'), children: <RegisterTab /> },
        ]}
      />
    </>
  )
}

function CloseTab() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [actual, setActual] = useState<Record<number, number | null>>({})
  const [notes, setNotes] = useState<Record<number, number | null>>({})
  const [note, setNote] = useState('')
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
    <>
      {data.unclosed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
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
      <div className="toolbar">
        <DatePicker value={date} format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} onChange={(d) => d && setDate(d)} />
        {data.last_closed && <span style={{ color: '#888' }}>{tx('সর্বশেষ বন্ধ দিন: {{p0}}', { p0: fmtDate(data.last_closed) })}</span>}
        {isFetching && <Spin size="small" />}
      </div>

      {data.close && (
        <Alert
          type={data.close.status === 'closed' ? 'success' : data.close.status === 'reopen_pending' ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
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
      {data.pending_vouchers > 0 && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} title={tx('এই দিনের {{p0}}টি নগদ ভাউচার অনুমোদনের অপেক্ষায় — আগে নিষ্পত্তি করুন, তারপর দিন বন্ধ করুন।', { p0: digits(data.pending_vouchers) })} />
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        {[
          [tx('প্রারম্ভিক জের'), data.opening],
          [tx('আদায়'), data.collections],
          [tx('প্রদান'), data.payments],
          [tx('প্রত্যাশিত জের'), data.expected],
          [tx('প্রকৃত নগদ'), actualTotal],
        ].map(([label, v]) => (
          <Col xs={12} md={8} lg={4} key={label as string}>
            <Card size="small">
              <Statistic title={label} value={money(v as number)} prefix="৳" />
            </Card>
          </Col>
        ))}
        <Col xs={12} md={8} lg={4}>
          <Card size="small">
            <Statistic title={tx('গরমিল')} value={money(difference)} prefix="৳" styles={{ content: { color: difference === 0 ? '#389e0d' : '#cf1322' } }} />
          </Card>
        </Col>
      </Row>

      <Card title={tx('নগদ খাতভিত্তিক হিসাব')} size="small" style={{ marginBottom: 16 }}>
        <Table<Stream>
          rowKey="account_id"
          size="small"
          pagination={false}
          dataSource={data.streams}
          scroll={{ x: 900 }}
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
                  { title: tx('আদায়'), dataIndex: 'collections', align: 'right', render: money },
                  { title: tx('প্রদান'), dataIndex: 'payments', align: 'right', render: money },
                ]}
              />
            ),
          }}
          columns={[
            { title: tx('নগদ খাত'), render: (_, s) => `${digits(s.code)} — ${nameOf(s)}` },
            { title: tx('প্রারম্ভিক'), dataIndex: 'opening', align: 'right', render: money },
            { title: tx('আদায়'), dataIndex: 'collections', align: 'right', render: money },
            { title: tx('প্রদান'), dataIndex: 'payments', align: 'right', render: money },
            { title: tx('প্রত্যাশিত'), dataIndex: 'expected', align: 'right', render: (v) => <strong>{money(v)}</strong> },
            {
              title: tx('গুনে পাওয়া নগদ'),
              width: 170,
              render: (_, s) => (
                <InputNumber
                  min={0}
                  precision={2}
                  style={{ width: '100%' }}
                  disabled={!!closed}
                  value={actual[s.account_id]}
                  onChange={(v) => setActual((a) => ({ ...a, [s.account_id]: v }))}
                />
              ),
            },
            {
              title: tx('গরমিল'),
              align: 'right',
              render: (_, s) => {
                const d = diffOf(s)
                return <span style={{ color: d === 0 ? '#389e0d' : '#cf1322' }}>{d > 0 ? '+' : ''}{money(d)}</span>
              },
            },
          ]}
        />
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card title={tx('নোট গণনা (ঐচ্ছিক)')} size="small" style={{ marginBottom: 16 }}>
            <Table
              rowKey={(d) => d}
              size="small"
              pagination={false}
              dataSource={DENOMINATIONS}
              columns={[
                { title: tx('নোট/কয়েন'), render: (_, d) => `৳${digits(d)}` },
                {
                  title: tx('সংখ্যা'),
                  width: 140,
                  render: (_, d) => <InputNumber min={0} precision={0} disabled={!!closed} value={notes[d]} onChange={(v) => setNotes((n) => ({ ...n, [d]: v }))} />,
                },
                { title: tx('টাকা'), align: 'right', render: (_, d) => money(d * Number(notes[d] ?? 0)) },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2}>
                    <strong>{tx('মোট গণনা')}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>{money(counted)}</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
            {counted > 0 && r2(counted) !== actualTotal && (
              <Alert type="warning" showIcon style={{ marginTop: 8 }} title={tx('নোট গণনার মোট (৳{{p0}}) ও খাতভিত্তিক প্রকৃত নগদের মোট (৳{{p1}}) মিলছে না।', { p0: money(counted), p1: money(actualTotal) })} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={tx('দিন বন্ধ')} size="small" style={{ marginBottom: 16 }}>
            <Form layout="vertical">
              <Form.Item label={tx('মন্তব্য / গরমিলের কারণ')} required={hasDiff} validateStatus={hasDiff && !note.trim() ? 'error' : undefined} help={hasDiff && !note.trim() ? tx('গরমিল আছে — কারণ লিখুন।') : undefined}>
                <Input.TextArea rows={3} maxLength={500} showCount disabled={!!closed} value={note} onChange={(e) => setNote(e.target.value)} />
              </Form.Item>
              <Can perm={['cash.create', 'cash.edit']}>
                <Button
                  type="primary"
                  icon={<LockOutlined />}
                  loading={saving}
                  disabled={!!closed || alreadyClosed || data.pending_vouchers > 0 || (hasDiff && !note.trim())}
                  onClick={close}
                >
                  {tx('হিসাব মিলিয়ে দিন বন্ধ করুন')}
                </Button>
              </Can>
              {!closed && alreadyClosed && <div style={{ marginTop: 8, color: '#cf1322' }}>{tx('এই তারিখ বা পরের কোনো দিন আগেই বন্ধ করা হয়েছে।')}</div>}
            </Form>
          </Card>
        </Col>
      </Row>

      <Card title={tx('এই দিনের নগদ ভাউচার')} size="small">
        <Table
          rowKey={(v) => `${v.id}-${v.account_id}-${v.debit}-${v.credit}`}
          size="small"
          dataSource={data.vouchers}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          columns={[
            { title: tx('ভাউচার নং'), dataIndex: 'voucher_no', render: (v: string, r) => <Link to={`/accounting/journals/${r.id}`}>{digits(v)}</Link> },
            { title: tx('ধরন'), dataIndex: 'voucher_type', render: (v: string) => VOUCHER_TYPE_LABEL[v] ?? v },
            { title: tx('মডিউল'), dataIndex: 'module', render: (m: string | null) => JOURNAL_MODULE_LABEL[m ?? 'accounting'] ?? m },
            { title: tx('নগদ খাত'), dataIndex: 'account_id', render: (id: number) => nameOf(data.streams.find((s) => s.account_id === id)) },
            { title: tx('বিবরণ'), dataIndex: 'narration' },
            { title: tx('আদায়'), dataIndex: 'debit', align: 'right', render: (v: number) => (v ? money(v) : '') },
            { title: tx('প্রদান'), dataIndex: 'credit', align: 'right', render: (v: number) => (v ? money(v) : '') },
          ]}
        />
      </Card>

      <ReopenModal day={reopening} onClose={() => setReopening(null)} />
    </>
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

function RegisterTab() {
  const [params, setParams] = useState<{ page: number; per_page: number; from?: string; to?: string; with_difference?: number }>({ page: 1, per_page: 25 })
  const [view, setView] = useState<DayClose | null>(null)
  const { data, isFetching } = useQuery({
    queryKey: ['day-closes', params],
    queryFn: async () => (await api.get<Register>('/day-closes', { params })).data,
    placeholderData: keepPreviousData,
  })
  return (
    <>
      <div className="toolbar">
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r) => setParams((p) => ({ ...p, page: 1, from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') }))}
        />
        <Button type={params.with_difference ? 'primary' : 'default'} onClick={() => setParams((p) => ({ ...p, page: 1, with_difference: p.with_difference ? undefined : 1 }))}>
          {tx('শুধু গরমিলের দিন')}
        </Button>
      </div>
      <Table<DayClose>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1000 }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data?.total, onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })) }}
        columns={[
          { title: tx('তারিখ'), dataIndex: 'date', render: (v: string, r) => <a onClick={() => setView(r)}>{fmtDate(v)}</a> },
          { title: tx('প্রারম্ভিক'), dataIndex: 'opening', align: 'right', render: money },
          { title: tx('আদায়'), dataIndex: 'collections', align: 'right', render: money },
          { title: tx('প্রদান'), dataIndex: 'payments', align: 'right', render: money },
          { title: tx('প্রত্যাশিত'), dataIndex: 'expected', align: 'right', render: money },
          { title: tx('প্রকৃত'), dataIndex: 'actual', align: 'right', render: money },
          { title: tx('গরমিল'), dataIndex: 'difference', align: 'right', render: (v: string) => <span style={{ color: Number(v) ? '#cf1322' : undefined }}>{money(v)}</span> },
          { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag color={DAY_STATUS_COLOR[s]}>{data?.statuses[s] ?? s}</Tag> },
          { title: tx('বন্ধকারী'), render: (_, r) => nameOf(r.closer) },
        ]}
      />
      <Modal open={!!view} title={tx('দিন বন্ধের বিবরণ — {{p0}}', { p0: fmtDate(view?.date) })} footer={null} onCancel={() => setView(null)} width={720}>
        {view && (
          <>
            <Table
              rowKey="account_id"
              size="small"
              pagination={false}
              dataSource={view.breakdown}
              columns={[
                { title: tx('নগদ খাত'), render: (_, s) => nameOf(s) },
                { title: tx('প্রত্যাশিত'), dataIndex: 'expected', align: 'right', render: money },
                { title: tx('প্রকৃত'), dataIndex: 'actual', align: 'right', render: money },
                { title: tx('গরমিল'), dataIndex: 'difference', align: 'right', render: money },
              ]}
            />
            <Descriptions column={1} size="small" bordered style={{ marginTop: 12 }}>
              <Descriptions.Item label={tx('মন্তব্য')}>{view.note}</Descriptions.Item>
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
          </>
        )}
      </Modal>
    </>
  )
}
