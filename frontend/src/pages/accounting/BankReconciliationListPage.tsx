import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Grid, Input, InputNumber, Modal, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarFilled, CheckOutlined, ClockCircleFilled, EyeFilled, FileTextFilled, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import './accounting.css'

export type BankLite = { id: number; bank_name: string; branch_name: string | null; account_no: string; account_id: number }
type Row = {
  id: number
  period: string
  statement_opening: string
  statement_closing: string
  book_closing: string | null
  status: string
  lines_count: number
  unmatched_count: number
  finalized_at: string | null
  bank_account: BankLite
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Resp = Paginated<Row> & {
  statuses: Record<string, string>
  counts: { total: number; finalized: number; draft: number; last_month: string; last_month_done: number; banks: number }
}
type Filters = { bank_account_id?: number; status?: string }

export const bankLabel = (b?: BankLite | null) => (b ? `${b.bank_name}${b.branch_name ? `, ${b.branch_name}` : ''} — ${digits(b.account_no)}` : '')
export const periodLabel = (p: string) => digits(dayjs(`${p}-01`).format('MM/YYYY'))
const REC_TONE: Record<string, string> = { draft: 'fl-tag-gold', finalized: 'fl-tag-green' }

/** Monthly bank reconciliation: one statement per bank account per month, matched line by line against the books. */
export default function BankReconciliationListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const [form] = Form.useForm()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['bank-reconciliations', params],
    queryFn: async () => (await api.get<Resp>('/bank-reconciliations', { params })).data,
    placeholderData: keepPreviousData,
  })
  const { data: banks } = useQuery({ queryKey: ['bank-accounts'], queryFn: async () => (await api.get<{ data: BankLite[] }>('/bank-accounts')).data.data })
  const bankOptions = (banks ?? []).map((b) => ({ value: b.id, label: bankLabel(b) }))
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }

  const start = async () => {
    const v = await form.validateFields()
    try {
      const { data: res } = await api.post<{ id: number }>('/bank-reconciliations', { ...v, period: v.period.format('YYYY-MM') })
      navigate(`/accounting/bank-reconciliations/${res.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const cards = [
    { key: 'total', label: tx('মোট মিলকরণ'), value: c?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'done', label: tx('চূড়ান্ত'), value: c?.finalized, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'finalized' }) },
    { key: 'draft', label: tx('চলমান (চূড়ান্ত হয়নি)'), value: c?.draft, icon: '', glyph: <ClockCircleFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ status: 'draft' }) },
    {
      key: 'last',
      label: c ? tx('গত মাস ({{p0}}) মেলানো হয়েছে', { p0: periodLabel(c.last_month) }) : tx('গত মাস'),
      value: c ? `${n0(c.last_month_done)} / ${n0(c.banks)}` : undefined,
      icon: '',
      glyph: <CalendarFilled />,
      color: c && c.last_month_done < c.banks ? '#e5383b' : '#8b3fe0',
      tint: c && c.last_month_done < c.banks ? '#fde4e5' : '#efe4fc',
    },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('মাস'),
      dataIndex: 'period',
      render: (v: string, r) => (
        <Link to={`/accounting/bank-reconciliations/${r.id}`} className="fl-link iv-no">
          {periodLabel(v)}
        </Link>
      ),
    },
    {
      title: tx('ব্যাংক হিসাব'),
      render: (_, r) => (
        <span className="hs-two">
          <span className="mg-name">{r.bank_account.bank_name}</span>
          <span>
            {r.bank_account.branch_name ? `${r.bank_account.branch_name} · ` : ''}
            {digits(r.bank_account.account_no)}
          </span>
        </span>
      ),
    },
    { title: tx('স্টেটমেন্ট প্রারম্ভিক (৳)'), dataIndex: 'statement_opening', align: 'right', render: money },
    { title: tx('স্টেটমেন্ট সমাপনী (৳)'), dataIndex: 'statement_closing', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    {
      title: tx('মিলেছে'),
      align: 'center',
      render: (_, r) => <Tag className={`fl-tag ${r.unmatched_count ? 'fl-tag-gold' : 'fl-tag-green'}`}>{`${digits(r.lines_count - r.unmatched_count)} / ${digits(r.lines_count)}`}</Tag>,
    },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag className={`fl-tag iv-status ${REC_TONE[s] ?? 'll-gray'}`}>{data?.statuses[s] ?? s}</Tag> },
    { title: tx('চূড়ান্ত'), dataIndex: 'finalized_at', render: (v: string | null) => (v ? fmtDateTime(v) : '—') },
    { title: tx('প্রস্তুতকারী'), render: (_, r) => nameOf(r.creator) || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/accounting/bank-reconciliations/${r.id}`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('হিসাব'), to: '/accounting/summary' }}
      title={tx('মাসিক ব্যাংক মিলকরণ')}
      subtitle=""
      actions={
        can('bank.edit') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => (form.resetFields(), setOpen(true))}>
            {tx('নতুন মিলকরণ')}
          </Button>
        )
      }
      cards={cards}
      filters={
        <>
          <Field label={tx('ব্যাংক হিসাব')} grow={360}>
            <Select value={draft.bank_account_id ?? 0} options={[{ value: 0, label: tx('সকল') }, ...bankOptions]} onChange={(v) => setDraft((d) => ({ ...d, bank_account_id: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.status ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.statuses ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => {
        setFilters(draft)
        setPage(1)
      }}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('মিলকরণের তালিকা'), p1: n0(total) })}
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
        locale={{ emptyText: tx('এখনও কোনো মিলকরণ হয়নি') }}
      />
      <Modal open={open} forceRender title={tx('নতুন ব্যাংক মিলকরণ')} onCancel={() => setOpen(false)} onOk={start} okText={tx('শুরু করুন')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="bank_account_id" label={tx('ব্যাংক হিসাব')} rules={[required(tx('ব্যাংক হিসাব বাছুন'))]}>
            <Select options={bankOptions} showSearch={{ optionFilterProp: 'label' }} />
          </Form.Item>
          <Form.Item name="period" label={tx('মাস')} rules={[required(tx('মাস বাছুন'))]}>
            <DatePicker picker="month" format="MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
          </Form.Item>
          <Form.Item name="statement_opening" label={tx('স্টেটমেন্টের প্রারম্ভিক জের')} extra={tx('খালি রাখলে আগের মাসের সমাপনী জের নেওয়া হবে।')}>
            <InputNumber precision={2} style={{ width: '100%' }} prefix="৳" />
          </Form.Item>
          <Form.Item name="statement_closing" label={tx('স্টেটমেন্টের সমাপনী জের')} rules={[required(tx('সমাপনী জের লিখুন'))]}>
            <InputNumber precision={2} style={{ width: '100%' }} prefix="৳" />
          </Form.Item>
          <Form.Item name="note" label={tx('মন্তব্য')}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </ListFrame>
  )
}
