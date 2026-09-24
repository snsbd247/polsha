import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { REC_STATUS_COLOR } from '../../lib/phase8'
import { toOptions } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

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
type Resp = Paginated<Row> & { statuses: Record<string, string> }

export const bankLabel = (b?: BankLite | null) => (b ? `${b.bank_name}${b.branch_name ? `, ${b.branch_name}` : ''} — ${digits(b.account_no)}` : '')
export const periodLabel = (p: string) => digits(dayjs(`${p}-01`).format('MM/YYYY'))

export default function BankReconciliationListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [open, setOpen] = useState(false)
  const [params, setParams] = useState<{ page: number; per_page: number; bank_account_id?: number; status?: string }>({ page: 1, per_page: 25 })
  const { data, isFetching } = useQuery({
    queryKey: ['bank-reconciliations', params],
    queryFn: async () => (await api.get<Resp>('/bank-reconciliations', { params })).data,
    placeholderData: keepPreviousData,
  })
  const { data: banks } = useQuery({ queryKey: ['bank-accounts'], queryFn: async () => (await api.get<{ data: BankLite[] }>('/bank-accounts')).data.data })
  const bankOptions = (banks ?? []).map((b) => ({ value: b.id, label: bankLabel(b) }))

  const start = async () => {
    const v = await form.validateFields()
    try {
      const { data: res } = await api.post<{ id: number }>('/bank-reconciliations', { ...v, period: v.period.format('YYYY-MM') })
      navigate(`/accounting/bank-reconciliations/${res.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('ব্যাংক রিকনসিলিয়েশন')}</h2>
        <Can perm="bank.edit">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => (form.resetFields(), setOpen(true))}>
            {tx('নতুন রিকনসিলিয়েশন')}
          </Button>
        </Can>
      </div>
      <div className="toolbar">
        <Select placeholder={tx('ব্যাংক হিসাব')} allowClear style={{ width: 320 }} options={bankOptions} onChange={(bank_account_id) => setParams((p) => ({ ...p, page: 1, bank_account_id }))} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 150 }} options={toOptions(data?.statuses)} onChange={(status) => setParams((p) => ({ ...p, page: 1, status }))} />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1000 }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data?.total, onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })) }}
        columns={[
          { title: tx('মাস'), dataIndex: 'period', render: (v: string, r) => <Link to={`/accounting/bank-reconciliations/${r.id}`}>{periodLabel(v)}</Link> },
          { title: tx('ব্যাংক হিসাব'), render: (_, r) => bankLabel(r.bank_account) },
          { title: tx('স্টেটমেন্ট প্রারম্ভিক'), dataIndex: 'statement_opening', align: 'right', render: money },
          { title: tx('স্টেটমেন্ট সমাপনী'), dataIndex: 'statement_closing', align: 'right', render: money },
          { title: tx('লাইন'), align: 'right', render: (_, r) => `${digits(r.lines_count - r.unmatched_count)}/${digits(r.lines_count)}` },
          { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag color={REC_STATUS_COLOR[s]}>{data?.statuses[s] ?? s}</Tag> },
          { title: tx('চূড়ান্ত'), dataIndex: 'finalized_at', render: fmtDateTime },
          { title: tx('প্রস্তুতকারী'), render: (_, r) => nameOf(r.creator) },
        ]}
      />
      <Modal open={open} forceRender title={tx('নতুন ব্যাংক রিকনসিলিয়েশন')} onCancel={() => setOpen(false)} onOk={start} okText={tx('শুরু করুন')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="bank_account_id" label={tx('ব্যাংক হিসাব')} rules={[required(tx('ব্যাংক হিসাব বাছুন'))]}>
            <Select options={bankOptions} showSearch={{ optionFilterProp: 'label' }} />
          </Form.Item>
          <Form.Item name="period" label={tx('মাস')} rules={[required(tx('মাস বাছুন'))]}>
            <DatePicker picker="month" format="MM/YYYY" disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
          </Form.Item>
          <Form.Item name="statement_opening" label={tx('স্টেটমেন্টের প্রারম্ভিক জের')} extra={tx('খালি রাখলে আগের মাসের সমাপনী জের নেওয়া হবে।')}>
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
    </>
  )
}
