import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Space, Spin, Table, Tag } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { Can } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { JOURNAL_STATUS, VOUCHER_TYPE_LABEL, accountLabel, money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'

type Person = { id: number; name_bn: string; name_en: string | null } | null
type Journal = {
  id: number
  voucher_no: string
  voucher_type: string
  date: string
  narration: string | null
  module: string | null
  status: string
  amount: number
  approval_request_id: number | null
  posted_at: string | null
  created_at: string
  creator: Person
  poster: Person
  reversal_of: { id: number; voucher_no: string } | null
  reversed_by: { id: number; voucher_no: string } | null
  period: { period_key: string; status: string } | null
  can_reverse: boolean
  lines: { id: number; debit: number; credit: number; remarks: string | null; account: { id: number; code: string; name_bn: string; name_en: string | null } }[]
}

const MODULE_LABEL: Record<string, string> = {
  accounting: tx('হাতে লেখা এন্ট্রি'),
  cash: tx('নগদ'),
  bank: tx('ব্যাংক'),
  membership: tx('সদস্যপদ'),
}

export default function JournalDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [reverseOpen, setReverseOpen] = useState(false)
  const [form] = Form.useForm()

  const { data: j, isLoading } = useQuery({ queryKey: ['journal', id], queryFn: async () => (await api.get<Journal>(`/journals/${id}`)).data })

  const reverse = async () => {
    const v = await form.validateFields()
    try {
      const r = await api.post(`/journals/${id}/reverse`, v)
      message.success(tx('বাতিলের অনুরোধ অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setReverseOpen(false)
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      navigate(`/approvals/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  if (isLoading || !j) return <Spin />
  const dr = j.lines.reduce((s, l) => s + Number(l.debit), 0)
  const cr = j.lines.reduce((s, l) => s + Number(l.credit), 0)

  return (
    <>
      <div className="page-header">
        <h2>
          {tx('ভাউচার {{p0}}', { p0: digits(j.voucher_no) })}
        </h2>
        <Space wrap className="no-print">
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {j.status === 'returned' && (
            <Can perm="accounting.create">
              <Button type="primary" onClick={() => navigate(`/accounting/journals/${j.id}/edit`)}>
                {tx('সংশোধন করে আবার পাঠান')}
              </Button>
            </Can>
          )}
          {j.can_reverse && (
            <Can perm="accounting.create">
              <Button danger onClick={() => { form.resetFields(); setReverseOpen(true) }}>
                {tx('ভাউচার বাতিল (রিভার্সাল)')}
              </Button>
            </Can>
          )}
        </Space>
      </div>
      {j.status === 'returned' && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={tx('ভাউচারটি সংশোধনের জন্য ফেরত এসেছে। অনুমোদনের পাতায় মন্তব্য দেখুন।')} />}
      {j.reversed_by && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            <>
              {tx('এই ভাউচার বাতিল হয়েছে; বিপরীত ভাউচার:')} <Link to={`/accounting/journals/${j.reversed_by.id}`}>{digits(j.reversed_by.voucher_no)}</Link>
            </>
          }
        />
      )}
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label={tx('ধরন')}>{VOUCHER_TYPE_LABEL[j.voucher_type] ?? j.voucher_type}</Descriptions.Item>
          <Descriptions.Item label={tx('তারিখ')}>{fmtDate(j.date)}</Descriptions.Item>
          <Descriptions.Item label={tx('অবস্থা')}>
            <Tag color={JOURNAL_STATUS[j.status]?.color}>{JOURNAL_STATUS[j.status]?.label ?? j.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={tx('টাকার পরিমাণ')}>{money(j.amount)}</Descriptions.Item>
          <Descriptions.Item label={tx('উৎস')}>{(j.module && MODULE_LABEL[j.module]) ?? j.module ?? '—'}</Descriptions.Item>
          <Descriptions.Item label={tx('হিসাবের মাস')}>{j.period ? digits(j.period.period_key) : '—'}</Descriptions.Item>
          <Descriptions.Item label={tx('প্রস্তুতকারী')}>
            {nameOf(j.creator) || '—'} · {fmtDateTime(j.created_at)}
          </Descriptions.Item>
          <Descriptions.Item label={tx('পোস্ট')}>{j.posted_at ? `${nameOf(j.poster) || tx('সিস্টেম')} · ${fmtDateTime(j.posted_at)}` : '—'}</Descriptions.Item>
          {j.approval_request_id && (
            <Descriptions.Item label={tx('অনুমোদন')}>
              <Link to={`/approvals/${j.approval_request_id}`}>{tx('অনুমোদনের বিবরণ দেখুন')}</Link>
            </Descriptions.Item>
          )}
          {j.reversal_of && (
            <Descriptions.Item label={tx('মূল ভাউচার')}>
              <Link to={`/accounting/journals/${j.reversal_of.id}`}>{digits(j.reversal_of.voucher_no)}</Link>
            </Descriptions.Item>
          )}
          <Descriptions.Item label={tx('বিবরণ')} span={3}>
            {j.narration || '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={j.lines}
        scroll={{ x: 600 }}
        columns={[
          { title: tx('হিসাব'), render: (_, l) => <Link to={`/accounting/ledger?account_id=${l.account.id}&from=${j.date}&to=${j.date}`}>{accountLabel(l.account)}</Link> },
          { title: tx('মন্তব্য'), dataIndex: 'remarks' },
          { title: tx('ডেবিট'), dataIndex: 'debit', width: 150, align: 'right', render: moneyOrBlank },
          { title: tx('ক্রেডিট'), dataIndex: 'credit', width: 150, align: 'right', render: moneyOrBlank },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2} align="right">
              <b>{tx('মোট')}</b>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <b>{money(dr)}</b>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <b>{money(cr)}</b>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <Modal open={reverseOpen} forceRender title={tx('ভাউচার বাতিল (রিভার্সাল)')} onCancel={() => setReverseOpen(false)} onOk={reverse} okText={tx('অনুমোদনের জন্য পাঠান')} cancelText={tx('বাতিল')} okButtonProps={{ danger: true }}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর আজকের তারিখে একটি বিপরীত ভাউচার পোস্ট হবে; মূল ভাউচার মুছে যাবে না।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
