import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, DatePicker, Drawer, Form, Grid, Input, InputNumber, Modal, Progress, Select, Space, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BookFilled, CheckOutlined, EditFilled, EyeFilled, InboxOutlined, NumberOutlined, PlusOutlined, WarningFilled } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import '../accounting/accounting.css'

type Named = { id: number; name_bn: string; name_en: string | null }
type Book = {
  id: number
  book_no: string
  start_no: number
  end_no: number
  issued_to: number | null
  issued_on: string | null
  status: string
  note: string | null
  holder: Named | null
  total: number
  used: number
  remaining: number
  last_used: number | null
  gap_count: number
}
type BookDetail = Book & {
  gaps: number[]
  receipts: { id: number; receipt_no: string; legacy_no: string; date: string; amount: string; status: string }[]
  duplicates: string[]
}
type ListResp = Paginated<Book> & {
  statuses: Record<string, string>
  users: Named[]
  sequences: { key: string; label: string; prefix: string; next_value: number; current_year: number | null }[]
  status_counts: Record<string, number>
}

function BookDetailDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['receipt-book', id],
    queryFn: async () => (await api.get<BookDetail>(`/receipt-books/${id}`)).data,
    enabled: id !== null,
  })
  return (
    <Drawer open={id !== null} onClose={onClose} size="large" title={data ? tx('রশিদ বই {{no}}', { no: digits(data.book_no) }) : ''} destroyOnHidden>
      {!data ? (
        <Spin />
      ) : (
        <>
          {data.duplicates.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 12 }} title={tx('একই রশিদ নম্বর একাধিকবার এন্ট্রি হয়েছে: {{n}}', { n: digits(data.duplicates.join(', ')) })} />}
          <Card size="small" title={tx('ফাঁক (এন্ট্রি হয়নি এমন নম্বর)')} style={{ marginBottom: 16 }}>
            {data.gaps.length ? (
              <Space wrap size={[4, 4]}>
                {data.gaps.map((g) => (
                  <Tag key={g} color="orange">
                    {digits(g)}
                  </Tag>
                ))}
              </Space>
            ) : (
              <span style={{ color: '#888' }}>{tx('কোনো ফাঁক নেই')}</span>
            )}
          </Card>
          <Table
            rowKey="id"
            size="small"
            dataSource={data.receipts}
            pagination={{ pageSize: 50, hideOnSinglePage: true }}
            columns={[
              { title: tx('বইয়ের নম্বর'), dataIndex: 'legacy_no', render: digits },
              { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v: string, r) => <Link to={`/payments/receipts/${r.id}`}>{digits(v)}</Link> },
              { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
              { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
              { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => (v === 'cancelled' ? <Tag color="red">{tx('বাতিল')}</Tag> : '') },
            ]}
          />
        </>
      )}
    </Drawer>
  )
}

const BOOK_TONE: Record<string, string> = { stock: 'll-gray', issued: 'll-blue', closed: 'fl-tag-green', lost: 'fl-tag-red' }

/** Printed receipt books: which serial range is with whom, and numbers inside a book never entered in the system. */
export default function ReceiptSerialPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const [form] = Form.useForm()
  const [draft, setDraft] = useState<string>()
  const [status, setStatus] = useState<string>()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [editing, setEditing] = useState<Book | 'new' | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const params = { status, page, per_page: perPage }
  const { data, isFetching } = useQuery({
    queryKey: ['receipt-books', params],
    queryFn: async () => (await api.get<ListResp>('/receipt-books', { params })).data,
    placeholderData: keepPreviousData,
  })
  const sc = data?.status_counts ?? {}
  const cnt = (k: string) => (data ? Number(sc[k] ?? 0) : undefined)
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (s?: string) => {
    setDraft(s)
    setStatus(s)
    setPage(1)
  }

  const edit = (b: Book | 'new') => {
    setEditing(b)
    form.resetFields()
    form.setFieldsValue(b === 'new' ? { status: 'stock' } : { ...b, issued_on: b.issued_on ? dayjs(b.issued_on) : undefined })
  }
  const save = async () => {
    try {
      const v = await form.validateFields()
      const body = { ...v, issued_on: v.issued_on ? v.issued_on.format('YYYY-MM-DD') : null }
      if (editing === 'new') await api.post('/receipt-books', body)
      else await api.put(`/receipt-books/${(editing as Book).id}`, body)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['receipt-books'] })
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const cards = [
    { key: 'stock', label: data?.statuses.stock ?? tx('মজুত'), value: cnt('stock'), icon: '', glyph: <InboxOutlined />, color: '#6b7280', tint: '#eef0f3', onClick: () => show('stock') },
    { key: 'issued', label: data?.statuses.issued ?? tx('দেওয়া হয়েছে'), value: cnt('issued'), icon: '', glyph: <BookFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show('issued') },
    { key: 'closed', label: data?.statuses.closed ?? tx('শেষ'), value: cnt('closed'), icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show('closed') },
    { key: 'lost', label: data?.statuses.lost ?? tx('হারানো'), value: cnt('lost'), icon: '', glyph: <WarningFilled />, color: '#e5383b', tint: '#fde4e5', onClick: () => show('lost') },
  ]

  const columns: ColumnsType<Book> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('বই নং'),
      dataIndex: 'book_no',
      render: (v: string, b) => (
        <a className="fl-link iv-no" onClick={() => setOpen(b.id)}>
          {digits(v)}
        </a>
      ),
    },
    { title: tx('সিরিয়াল'), render: (_, b) => <span className="iv-no">{`${digits(b.start_no)} – ${digits(b.end_no)}`}</span> },
    { title: tx('কার কাছে'), render: (_, b) => nameOf(b.holder) || '—' },
    { title: tx('দেওয়ার তারিখ'), dataIndex: 'issued_on', render: (v: string | null) => (v ? fmtDate(v) : '—') },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${BOOK_TONE[v] ?? 'll-gray'}`}>{data?.statuses[v] ?? v}</Tag> },
    {
      title: tx('ব্যবহার'),
      width: 180,
      render: (_, b) => <Progress percent={Math.round((b.used / Math.max(1, b.total)) * 100)} size="small" format={() => `${digits(b.used)}/${digits(b.total)}`} />,
    },
    { title: tx('শেষ ব্যবহৃত'), dataIndex: 'last_used', render: (v: number | null) => (v ? digits(v) : '—') },
    { title: tx('ফাঁক'), dataIndex: 'gap_count', align: 'center', render: (v: number) => (v ? <Tag className="fl-tag ll-orange">{digits(v)}</Tag> : '—') },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, b) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('বিস্তারিত')} onClick={() => setOpen(b.id)} />
          <Button className="fl-act pl-act" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => edit(b)} />
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('প্রশাসন'), to: '/admin/users' }}
      title={tx('রশিদ সিরিয়াল প্রশাসন')}
      subtitle=""
      actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit('new')}>
          {tx('নতুন রশিদ বই')}
        </Button>
      }
      cards={cards}
      above={
        data && (
          <div className="rs-seq">
            <span className="rs-seq-title">
              <NumberOutlined /> {tx('সিস্টেমের স্বয়ংক্রিয় সিরিয়াল')}
            </span>
            {data.sequences.map((s) => (
              <span key={s.key} className="rs-seq-item">
                {s.label}: <strong>{digits(`${s.prefix}${s.current_year ? `-${s.current_year}` : ''}`)}</strong> · {tx('পরের নম্বর')} <strong>{digits(s.next_value)}</strong>
              </span>
            ))}
            <Link to="/settings/sequences">{tx('সিরিয়াল নম্বর')}</Link>
          </div>
        )
      }
      filters={
        <Field label={tx('অবস্থা')} grow={300}>
          <Select value={draft ?? ''} options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.statuses ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft(v || undefined)} />
        </Field>
      }
      onSearch={() => show(draft)}
      onReset={() => show(undefined)}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('রশিদ বইয়ের তালিকা'), p1: n0(total) })}
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
      <Table<Book>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো রশিদ বই নেই') }}
      />
      <p className="rs-note">{tx('পুরোনো/হাতে লেখা রশিদ এন্ট্রির সময় "পুরোনো রশিদ নং" ঘরে দেওয়া নম্বর দিয়েই বইয়ের ব্যবহার ও ফাঁক হিসাব হয়।')}</p>

      <Modal open={editing !== null} title={editing === 'new' ? tx('নতুন রশিদ বই') : tx('রশিদ বই সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="book_no" label={tx('বই নং')} rules={[{ required: true, message: tx('বই নং দিন') }]}>
            <Input />
          </Form.Item>
          <Space>
            <Form.Item name="start_no" label={tx('শুরুর নম্বর')} rules={[{ required: true, message: tx('দিন') }]}>
              <InputNumber min={1} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="end_no" label={tx('শেষ নম্বর')} rules={[{ required: true, message: tx('দিন') }]}>
              <InputNumber min={1} style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item name="status" label={tx('অবস্থা')} rules={[{ required: true }]}>
            <Select options={Object.entries(data?.statuses ?? {}).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="issued_to" label={tx('কাকে দেওয়া হয়েছে')}>
            <Select allowClear showSearch={{ optionFilterProp: 'label' }} options={data?.users.map((u) => ({ value: u.id, label: nameOf(u) }))} />
          </Form.Item>
          <Form.Item name="issued_on" label={tx('দেওয়ার তারিখ')}>
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="note" label={tx('মন্তব্য')}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
      <BookDetailDrawer id={open} onClose={() => setOpen(null)} />
    </ListFrame>
  )
}
