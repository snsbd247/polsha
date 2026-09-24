import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Modal, Row, Space, Spin, Table, Tag } from 'antd'
import { DollarOutlined, PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { INVOICE_STATUS_COLOR, METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL, useInvoiceMeta, type InvoiceRow } from '../../lib/irrigation'
import { CULTIVATION_COLOR, fmtArea, useLandMeta } from '../../lib/land'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type Payment = { id: number; receipt_no: string; date: string; status: string; method: string; is_legacy: boolean; legacy_no: string | null; amount: number }
type Detail = InvoiceRow & {
  remarks: string | null
  journal: { id: number; voucher_no: string; status: string } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
  rate_row: { id: number; rate: string; effective_from: string; approved_at: string | null } | null
  batch_id: number | null
  cancel_reason: string | null
  cancelled_at: string | null
  payments: Payment[]
  cancel_pending: boolean
  snapshot: { jl_no?: string | null; crop?: string | null; land_area?: number }
}

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()

  const { data: inv, isLoading } = useQuery({ queryKey: ['invoices', id], queryFn: async () => (await api.get<Detail>(`/invoices/${id}`)).data })
  if (isLoading || !inv) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/invoices/${inv.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const livePayments = inv.payments.filter((p) => p.status !== 'cancelled')
  const canCancel = inv.status !== 'cancelled' && !inv.cancel_pending && inv.paid_amount <= 0

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('ইনভয়েস {{p0}}', { p0: digits(inv.invoice_no) })} <Tag color={INVOICE_STATUS_COLOR[inv.status]}>{meta?.statuses[inv.status] ?? inv.status}</Tag>
          {inv.cancel_pending && <Tag color="gold">{tx('বাতিলের অপেক্ষায়')}</Tag>}
        </h2>
        <Space wrap>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {inv.due > 0 && inv.status !== 'cancelled' && (
            <Can perm="payment.create">
              <Button type="primary" icon={<DollarOutlined />} onClick={() => navigate(`/payments/collect?farmer_id=${inv.farmer_id}`)}>
                {tx('টাকা আদায়')}
              </Button>
            </Can>
          )}
          {canCancel && (
            <Can perm="irrigation.edit">
              <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
                {tx('বাতিল')}
              </Button>
            </Can>
          )}
        </Space>
      </div>
      <h2 className="print-only">{tx('সেচ ইনভয়েস {{p0}}', { p0: digits(inv.invoice_no) })}</h2>

      {inv.status === 'cancelled' && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', { p0: fmtDateTime(inv.cancelled_at), p1: inv.cancel_reason ?? '' })} />
      )}
      {inv.status !== 'cancelled' && livePayments.length > 0 && (
        <Alert type="info" showIcon className="no-print" style={{ marginBottom: 16 }} title={tx('এই ইনভয়েসে আদায় আছে। বাতিল করতে আগে সংশ্লিষ্ট রশিদগুলো বাতিল করুন।')} />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title={tx('ইনভয়েসের বিবরণ')}>
            <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
              <Descriptions.Item label={tx('মৌসুম')}>{inv.season}</Descriptions.Item>
              <Descriptions.Item label={tx('তারিখ')}>{fmtDate(inv.invoice_date)}</Descriptions.Item>
              <Descriptions.Item label={tx('পরিশোধের শেষ তারিখ')}>{fmtDate(inv.due_date)}</Descriptions.Item>
              <Descriptions.Item label={tx('চাষের ধরন')}>
                <Tag color={CULTIVATION_COLOR[inv.cultivation_type]}>{meta?.cultivation_types[inv.cultivation_type] ?? inv.cultivation_type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={tx('চাষি (বিল যার নামে)')} span={2}>
                {inv.cultivator && (
                  <Link to={`/farmers/${inv.cultivator.id}`}>
                    {nameOf(inv.cultivator)} ({digits(inv.cultivator.farmer_code)}) — {tx('পিতা: {{p0}}', { p0: inv.cultivator.father_name })}
                  </Link>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={tx('মালিক')} span={2}>
                {inv.owners.map((o) => tx('{{p0}} ({{p1}}%)', { p0: nameOf(o), p1: digits(o.share_percent) })).join(', ')}
              </Descriptions.Item>
              <Descriptions.Item label={tx('জমি')}>
                <Link to={`/lands/${inv.land_id}`}>{inv.land_code}</Link>
              </Descriptions.Item>
              <Descriptions.Item label={tx('মৌজা')}>
                {nameOf({ name_bn: inv.mouza, name_en: inv.mouza_en })} {inv.snapshot.jl_no && `(JL ${digits(inv.snapshot.jl_no)})`}
              </Descriptions.Item>
              <Descriptions.Item label={tx('খতিয়ান / দাগ')}>
                {inv.survey} {digits(inv.khatian_no)} / {digits(inv.dag_no)}
              </Descriptions.Item>
              <Descriptions.Item label={tx('জমির ধরন')}>{inv.land_type ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('সেচের ধরন')}>{inv.irrigation_type ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('সেচের জমি')}>
                {fmtArea(inv.area_decimal, landMeta)}
                {inv.snapshot.land_area !== undefined && inv.snapshot.land_area !== inv.area_decimal && (
                  <small style={{ color: '#888' }}> {tx('(মোট জমি {{p0}})', { p0: fmtArea(inv.snapshot.land_area) })}</small>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={tx('রেট')}>
                {tx('৳{{p0}} / শতক', { p0: money(inv.rate) })}
                {inv.rate_row && <small style={{ color: '#888' }}> {tx('({{p0}} থেকে কার্যকর)', { p0: fmtDate(inv.rate_row.effective_from) })}</small>}
              </Descriptions.Item>
              {inv.remarks && (
                <Descriptions.Item label={tx('মন্তব্য')} span={2}>
                  {inv.remarks}
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title={tx('টাকার হিসাব')}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={tx('বিল')}>৳{money(inv.amount)}</Descriptions.Item>
              <Descriptions.Item label={tx('আদায়')}>৳{money(inv.paid_amount)}</Descriptions.Item>
              <Descriptions.Item label={tx('বকেয়া')}>
                <strong style={{ color: inv.due > 0 ? '#cf1322' : undefined }}>৳{money(inv.due)}</strong>
              </Descriptions.Item>
              <Descriptions.Item label={tx('ভাউচার')}>
                {inv.journal ? (
                  can('accounting.view') ? <Link to={`/accounting/journals/${inv.journal.id}`}>{digits(inv.journal.voucher_no)}</Link> : digits(inv.journal.voucher_no)
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label={tx('প্রস্তুতকারী')}>{nameOf(inv.creator)}</Descriptions.Item>
              {inv.batch_id && (
                <Descriptions.Item label={tx('ব্যাচ')}>
                  <Link to={`/irrigation/invoices?batch_id=${inv.batch_id}`}>#{digits(inv.batch_id)}</Link>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>
        <Col span={24}>
          <Card title={tx('আদায়ের ইতিহাস')}>
            <Table<Payment>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={inv.payments}
              locale={{ emptyText: tx('এখনো কোনো আদায় হয়নি') }}
              columns={[
                { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v: string, p) => <Link to={`/payments/receipts/${p.id}`}>{digits(v)}</Link> },
                { title: tx('পুরনো রশিদ নং'), dataIndex: 'legacy_no', render: (v) => (v ? digits(v) : '—') },
                { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
                { title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string) => METHOD_LABEL[v] ?? v },
                { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
                { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag color={RECEIPT_STATUS_COLOR[v]}>{RECEIPT_STATUS_LABEL[v] ?? v}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal open={cancelling} forceRender title={tx('ইনভয়েস বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর ইনভয়েস বাতিল হবে এবং এর হিসাব (পাওনা/আয়) রিভার্স হবে।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
