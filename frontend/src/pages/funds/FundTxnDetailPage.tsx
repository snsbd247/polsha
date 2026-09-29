import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Space, Spin, Tag } from 'antd'
import { PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { TXN_STATUS_COLOR, useFundMeta, type FundKind } from '../../lib/funds'
import FundReceipt, { type FundTxnDetail } from '../../components/FundReceipt'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

export default function FundTxnDetailPage({ kind }: { kind: FundKind }) {
  const { id } = useParams()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useFundMeta(kind)
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()

  const { data: t, isLoading } = useQuery({ queryKey: ['fund-txn', kind, id], queryFn: async () => (await api.get<FundTxnDetail>(`/funds/${kind}/transactions/${id}`)).data })
  if (isLoading || !t) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/funds/${kind}/transactions/${t.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['fund-txn', kind] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('লেনদেন {{p0}}', { p0: digits(t.txn_no) })} <Tag color={TXN_STATUS_COLOR[t.status]}>{meta.data?.statuses[t.status] ?? t.status}</Tag>
        </h2>
        <Space wrap>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {t.can_cancel && can(`${kind}.create`) && (
            <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
              {tx('লেনদেন বাতিল')}
            </Button>
          )}
        </Space>
      </div>

      {t.status === 'pending' && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('এই লেনদেন অনুমোদনের অপেক্ষায় — অনুমোদনের পর হিসাবে যোগ হবে।')} />}
      {t.status === 'cancel_pending' && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: t.cancel_reason ?? '' })} />}
      {t.status === 'cancelled' && (
        <Alert className="no-print" type="error" showIcon style={{ marginBottom: 16 }} title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', { p0: fmtDateTime(t.cancelled_at), p1: t.cancel_reason ?? '' })} />
      )}

      <FundReceipt t={t} kind={kind} />

      <Card title={tx('হিসাবের তথ্য')} className="no-print" style={{ marginTop: 16, maxWidth: 800 }}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small">
          <Descriptions.Item label={tx('হিসাব')}>
            <Link to={`/funds/${kind}/accounts/${t.account.id}`}>{digits(t.account.account_no)}</Link>
          </Descriptions.Item>
          <Descriptions.Item label={tx('ভাউচার')}>
            {t.journal &&
              (can('accounting.view') ? <Link to={`/accounting/journals/${t.journal.id}`}>{digits(t.journal.voucher_no)}</Link> : digits(t.journal.voucher_no))}
            {t.journal?.reversed_by && <> ({tx('রিভার্সাল')}: {digits(t.journal.reversed_by.voucher_no)})</>}
          </Descriptions.Item>
          {t.counter_account && <Descriptions.Item label={tx('বিপরীত হিসাব')}>{accountLabel(t.counter_account)}</Descriptions.Item>}
          {t.pair && (
            <Descriptions.Item label={tx('জোড়া লেনদেন')}>
              <Link to={`/funds/${kind}/transactions/${t.pair.id}`}>{digits(t.pair.txn_no)}</Link>
            </Descriptions.Item>
          )}
          {t.run && (
            <Descriptions.Item label={tx('বণ্টন')}>
              <Link to={`/funds/distributions/${t.run.id}`}>{digits(t.run.run_no)}</Link>
            </Descriptions.Item>
          )}
          <Descriptions.Item label={tx('এন্ট্রি করেছেন')}>{nameOf(t.creator)}</Descriptions.Item>
          <Descriptions.Item label={tx('এন্ট্রির সময়')}>{fmtDateTime(t.created_at)}</Descriptions.Item>
          {t.posted_at && <Descriptions.Item label={tx('পোস্টিংয়ের সময়')}>{fmtDateTime(t.posted_at)}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <Modal open={cancelling} forceRender title={tx('লেনদেন বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর লেনদেন বাতিল হবে এবং এর ভাউচার রিভার্স হবে।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
