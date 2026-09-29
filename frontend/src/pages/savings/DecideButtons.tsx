import { useState } from 'react'
import { App, Button, Form, Input, Modal, Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { t as tx } from '../../lib/i18n'

/**
 * Approve / reject one pending request through the approval engine (the
 * same rules and levels as the approval inbox; the requester cannot approve
 * their own). A rejection needs a reason.
 */
export default function DecideButtons({
  approvalId,
  amount,
  who,
  compact,
  onDone,
  texts,
}: {
  approvalId: number
  amount?: number | string
  who: string
  compact?: boolean
  onDone: () => void
  /** wording for something other than a withdrawal */
  texts?: { confirm: string; reject: string; approved: string }
}) {
  const { message, modal } = App.useApp()
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()

  const decide = async (decision: 'approve' | 'reject', remarks?: string) => {
    setBusy(true)
    try {
      const r = await api.post<{ status: string }>(`/approvals/${approvalId}/decide`, { decision, remarks })
      message.success(decision === 'reject' ? tx('প্রত্যাখ্যান করা হয়েছে।') : r.data.status === 'approved' ? (texts?.approved ?? tx('অনুমোদিত — হিসাব থেকে টাকা কাটা হয়েছে।')) : tx('আপনার অনুমোদন দেওয়া হয়েছে — পরের ধাপের অনুমোদনের অপেক্ষায়।'))
      setRejecting(false)
      onDone()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const approve = () =>
    modal.confirm({
      title: texts?.confirm ?? tx('৳{{p0}} উত্তোলন অনুমোদন করবেন?', { p0: money(amount ?? 0) }),
      content: who,
      okText: tx('অনুমোদন'),
      cancelText: tx('ফিরে যান'),
      onOk: () => decide('approve'),
    })
  const reject = async () => {
    const v = await form.validateFields().catch(() => null)
    if (v) await decide('reject', v.remarks)
  }

  return (
    <>
      {compact ? (
        <>
          <Tooltip title={tx('অনুমোদন')}>
            <Button className="fl-act pl-act sv-approve" icon={<CheckOutlined />} loading={busy} aria-label={tx('অনুমোদন')} onClick={approve} />
          </Tooltip>
          <Tooltip title={tx('প্রত্যাখ্যান')}>
            <Button className="fl-act pl-act sv-reject" icon={<CloseOutlined />} aria-label={tx('প্রত্যাখ্যান')} onClick={() => (form.resetFields(), setRejecting(true))} />
          </Tooltip>
        </>
      ) : (
        <>
          <Button type="primary" icon={<CheckOutlined />} loading={busy} onClick={approve}>
            {tx('অনুমোদন')}
          </Button>
          <Button danger icon={<CloseOutlined />} onClick={() => (form.resetFields(), setRejecting(true))}>
            {tx('প্রত্যাখ্যান')}
          </Button>
        </>
      )}
      <Modal open={rejecting} forceRender title={texts?.reject ?? tx('উত্তোলন প্রত্যাখ্যান')} onCancel={() => setRejecting(false)} onOk={reject} okText={tx('প্রত্যাখ্যান')} okButtonProps={{ danger: true, loading: busy }} cancelText={tx('ফিরে যান')}>
        <p>
          {who}
          {amount !== undefined && ` — ৳${money(amount)}`}
        </p>
        <Form form={form} layout="vertical">
          <Form.Item name="remarks" label={tx('কারণ')} rules={[{ required: true, message: tx('কারণ লিখুন') }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
