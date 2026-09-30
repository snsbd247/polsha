import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Result, Spin, Table, Tag } from 'antd'
import { ArrowLeftOutlined, CalendarFilled, DollarCircleFilled, EditOutlined, FileTextFilled, InfoCircleFilled, PrinterOutlined, RollbackOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { JOURNAL_STATUS, JOURNAL_TONE, VOUCHER_TYPE_LABEL, accountLabel, money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../loans/loans.css'
import './accounting.css'

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
  irrigation: tx('সেচ'),
  loan: tx('ঋণ'),
  savings: tx('সঞ্চয়'),
  share: tx('শেয়ার'),
  asset: tx('সম্পদ'),
}

/** One voucher: its lines (debit = credit), who made and posted it, and a reversal request when it must be undone. */
export default function JournalDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [reverseOpen, setReverseOpen] = useState(false)
  const [form] = Form.useForm()

  const { data: j, isLoading, isError } = useQuery({ queryKey: ['journal', id], queryFn: async () => (await api.get<Journal>(`/journals/${id}`)).data, retry: false })

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

  if (isError) return <Result status="404" title={tx('ভাউচারটি পাওয়া যায়নি')} extra={<Button onClick={() => navigate('/accounting/journals')}>{tx('তালিকায় ফিরুন')}</Button>} />
  if (isLoading || !j) return <Spin />
  const dr = j.lines.reduce((s, l) => s + Number(l.debit), 0)
  const cr = j.lines.reduce((s, l) => s + Number(l.credit), 0)

  return (
    <PageFrame
      className="id-page ln-page"
      crumbs={[{ label: tx('হিসাব'), to: '/accounting/summary' }, { label: tx('ভাউচার'), to: '/accounting/journals' }, { label: tx('ভাউচারের বিস্তারিত') }]}
      title={tx('ভাউচারের বিস্তারিত')}
      actions={
        <span className="id-actions no-print">
          <Button icon={<PrinterOutlined />} className="fm-history-btn" onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {j.status === 'returned' && can('accounting.create') && (
            <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/accounting/journals/${j.id}/edit`)}>
              {tx('সংশোধন করে আবার পাঠান')}
            </Button>
          )}
          {j.can_reverse && can('accounting.create') && (
            <Button
              danger
              icon={<RollbackOutlined />}
              onClick={() => {
                form.resetFields()
                setReverseOpen(true)
              }}
            >
              {tx('ভাউচার বাতিল (রিভার্সাল)')}
            </Button>
          )}
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/accounting/journals')}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </span>
      }
    >
      {j.status === 'returned' && <Alert className="id-alert" type="warning" showIcon title={tx('ভাউচারটি সংশোধনের জন্য ফেরত এসেছে। অনুমোদনের পাতায় মন্তব্য দেখুন।')} />}
      {j.reversed_by && (
        <Alert
          className="id-alert"
          type="info"
          showIcon
          title={
            <>
              {tx('এই ভাউচার বাতিল হয়েছে; বিপরীত ভাউচার:')} <Link to={`/accounting/journals/${j.reversed_by.id}`}>{digits(j.reversed_by.voucher_no)}</Link>
            </>
          }
        />
      )}

      <div className="id-top">
        <div className="id-hero">
          <span className="id-hero-icon">
            <FileTextFilled />
          </span>
          <div>
            <small>{tx('ভাউচার নং')}</small>
            <strong>{digits(j.voucher_no)}</strong>
            <Tag className={`fl-tag ${JOURNAL_TONE[j.status] ?? 'll-gray'}`}>● {JOURNAL_STATUS[j.status]?.label ?? j.status}</Tag>
          </div>
        </div>
        <Fact icon={<CalendarFilled />} label={tx('তারিখ')} color="#1769e0" tint="#e4edfd">
          <strong>{fmtDate(j.date)}</strong>
        </Fact>
        <Fact icon={<DollarCircleFilled />} label={tx('টাকার পরিমাণ')} color="#1f9d55" tint="#dcf3e5">
          <strong>৳ {money(j.amount)}</strong>
        </Fact>
        <Fact icon={<FileTextFilled />} label={tx('ধরন')} color="#8b3fe0" tint="#efe4fc">
          <strong>{VOUCHER_TYPE_LABEL[j.voucher_type] ?? j.voucher_type}</strong>
        </Fact>
        <Fact icon={<InfoCircleFilled />} label={tx('উৎস')} color="#f08c00" tint="#fdefd6">
          <strong>{(j.module && MODULE_LABEL[j.module]) ?? j.module ?? '—'}</strong>
        </Fact>
      </div>

      <div className="id-two">
        <Box icon={<FileTextFilled />} title={tx('ভাউচারের তথ্য')}>
          <KV
            rows={[
              [tx('বিবরণ'), j.narration || '—'],
              [tx('হিসাবের মাস'), j.period ? `${digits(j.period.period_key)}${j.period.status === 'closed' ? ` (${tx('বন্ধ')})` : ''}` : '—'],
              [tx('মূল ভাউচার'), j.reversal_of ? <Link to={`/accounting/journals/${j.reversal_of.id}`}>{digits(j.reversal_of.voucher_no)}</Link> : '—'],
              [tx('বিপরীত ভাউচার'), j.reversed_by ? <Link to={`/accounting/journals/${j.reversed_by.id}`}>{digits(j.reversed_by.voucher_no)}</Link> : '—'],
            ]}
          />
        </Box>
        <Box icon={<UserOutlined />} title={tx('প্রস্তুত ও অনুমোদন')}>
          <KV
            rows={[
              [tx('প্রস্তুতকারী'), `${nameOf(j.creator) || '—'} · ${fmtDateTime(j.created_at)}`],
              [tx('পোস্ট'), j.posted_at ? `${nameOf(j.poster) || tx('সিস্টেম')} · ${fmtDateTime(j.posted_at)}` : '—'],
              [tx('অনুমোদন'), j.approval_request_id ? <Link to={`/approvals/${j.approval_request_id}`}>{tx('অনুমোদনের বিবরণ দেখুন')}</Link> : '—'],
            ]}
          />
        </Box>
      </div>

      <Box icon={<UnorderedListOutlined />} title={tx('ডেবিট ও ক্রেডিট')}>
        <Table
          rowKey="id"
          size="small"
          className="id-payments"
          pagination={false}
          dataSource={j.lines}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: '#', width: 40, align: 'center', render: (_, __, i) => digits(i + 1) },
            { title: tx('হিসাব'), render: (_, l) => <Link to={`/accounting/ledger?account_id=${l.account.id}&from=${j.date}&to=${j.date}`}>{accountLabel(l.account)}</Link> },
            { title: tx('মন্তব্য'), dataIndex: 'remarks', render: (v: string | null) => v || '—' },
            { title: tx('ডেবিট (৳)'), dataIndex: 'debit', align: 'right', render: moneyOrBlank },
            { title: tx('ক্রেডিট (৳)'), dataIndex: 'credit', align: 'right', render: moneyOrBlank },
          ]}
          summary={() => (
            <Table.Summary.Row className="ln-sum-row">
              <Table.Summary.Cell index={0} colSpan={3} align="right">
                {tx('মোট')}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                {money(dr)}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                {money(cr)}
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Box>

      <Modal open={reverseOpen} forceRender title={tx('ভাউচার বাতিল (রিভার্সাল)')} onCancel={() => setReverseOpen(false)} onOk={reverse} okText={tx('অনুমোদনের জন্য পাঠান')} cancelText={tx('বাতিল')} okButtonProps={{ danger: true }}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর আজকের তারিখে একটি বিপরীত ভাউচার পোস্ট হবে; মূল ভাউচার মুছে যাবে না।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  )
}
