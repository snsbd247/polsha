import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Row, Space, Spin, Steps, Table, Tag, Typography } from 'antd'
import { api, errorMessage } from '../../lib/api'
import { APPROVAL_STATUS, digits, fmtDateTime } from '../../lib/format'
import { useRoleLabels } from '../../lib/queries'
import type { ApprovalRequest } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

type Decision = 'approve' | 'reject' | 'return'

const DECISION_LABEL: Record<Decision, string> = { approve: tx('অনুমোদন'), reject: tx('প্রত্যাখ্যান'), return: tx('সংশোধনের জন্য ফেরত') }

// Payload keys are either English field names (status changes, merges) or
// Bangla labels saved with the request (membership) — show both as labels.
const FIELD_LABEL: Record<string, string> = {
  status: tx('অবস্থা'),
  effective_date: tx('কার্যকর তারিখ'),
  reason_type: tx('কারণের ধরন'),
  reason: tx('কারণ'),
  resolution_no: tx('সভার সিদ্ধান্ত নম্বর'),
  fee: tx('ফি'),
  keep_id: tx('যে রেকর্ড থাকবে'),
  remove_id: tx('যে রেকর্ড মার্জ হবে'),
  keep: tx('যে রেকর্ড থাকবে'),
  remove: tx('যে রেকর্ড মার্জ হবে'),
  values: tx('চূড়ান্ত তথ্য'),
}
const fieldLabel = (k: string) => FIELD_LABEL[k] ?? tx(k)
const VALUE_LABEL: Record<string, string> = { active: tx('সক্রিয়'), inactive: tx('নিষ্ক্রিয়'), cancelled: tx('বাতিলকৃত') }

const show = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'object'
      ? digits(JSON.stringify(v))
      : (VALUE_LABEL[String(v)] ?? digits(tx(String(v))))

export default function ApprovalDetailPage() {
  const { id } = useParams()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: roles } = useRoleLabels()
  const [decision, setDecision] = useState<Decision | null>(null)
  const [remarks, setRemarks] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: req, isLoading } = useQuery({
    queryKey: ['approvals', 'detail', id],
    queryFn: async () => (await api.get<ApprovalRequest>(`/approvals/${id}`)).data,
  })

  const roleLabel = (name: string) => roles?.find((r) => r.name === name)?.label ?? name
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['approvals'] })

  const decide = async () => {
    if (!decision) return
    if (decision !== 'approve' && !remarks.trim()) {
      message.error(tx('কারণ লেখা আবশ্যক।'))
      return
    }
    setBusy(true)
    try {
      await api.post(`/approvals/${id}/decide`, { decision, remarks: remarks || null })
      message.success(tx('{{p0}} সম্পন্ন হয়েছে।', { p0: DECISION_LABEL[decision] }))
      setDecision(null)
      setRemarks('')
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const addComment = async () => {
    if (!comment.trim()) return
    try {
      await api.post(`/approvals/${id}/comments`, { body: comment })
      setComment('')
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  if (isLoading || !req) return <Spin />

  const keys = Array.from(new Set([...Object.keys(req.before ?? {}), ...Object.keys(req.payload ?? {})]))
  const status = APPROVAL_STATUS[req.status]

  return (
    <>
      <div className="page-header">
        <h2>{req.title}</h2>
        {req.can_act && (
          <Space wrap>
            <Button type="primary" onClick={() => setDecision('approve')}>
              {tx('অনুমোদন')}
            </Button>
            <Button onClick={() => setDecision('return')}>{tx('ফেরত পাঠান')}</Button>
            <Button danger onClick={() => setDecision('reject')}>
              {tx('প্রত্যাখ্যান')}
            </Button>
          </Space>
        )}
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title={tx('বিস্তারিত')}>
            <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
              <Descriptions.Item label={tx('অবস্থা')}>
                <Tag color={status?.color}>{status?.label ?? req.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={tx('পাঠিয়েছেন')}>{req.requester?.name_bn}</Descriptions.Item>
              <Descriptions.Item label={tx('পাঠানোর সময়')}>{fmtDateTime(req.created_at)}</Descriptions.Item>
              <Descriptions.Item label={tx('সিদ্ধান্তের সময়')}>{fmtDateTime(req.decided_at)}</Descriptions.Item>
              {req.amount && <Descriptions.Item label={tx('টাকার পরিমাণ')} span="filled">{tx('৳')}{' '}{digits(req.amount)}</Descriptions.Item>}
              {req.approvable_type?.endsWith('\\Journal') && can('accounting.view') && (
                <Descriptions.Item label={tx('সংশ্লিষ্ট ভাউচার')} span="filled">
                  <Link to={`/accounting/journals/${req.approvable_id}`}>{tx('ভাউচার দেখুন')}</Link>
                </Descriptions.Item>
              )}
            </Descriptions>

            <h4 style={{ marginTop: 20 }}>{tx('প্রস্তাবিত পরিবর্তন')}</h4>
            {keys.length ? (
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ x: 500 }}
                dataSource={keys.map((k) => ({ key: k, before: req.before?.[k], after: req.payload?.[k] }))}
                columns={[
                  { title: tx('ফিল্ড'), dataIndex: 'key', width: 160, render: (k: string) => fieldLabel(k) },
                  ...(req.before ? [{ title: tx('বর্তমান'), dataIndex: 'before', render: (v: unknown) => <span className="diff-old">{show(v)}</span> }] : []),
                  { title: tx('প্রস্তাবিত'), dataIndex: 'after', render: (v: unknown) => <span className="diff-new">{show(v)}</span> },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('কোনো বিস্তারিত নেই')} />
            )}
          </Card>

          <Card title={tx('মন্তব্য')} style={{ marginTop: 16 }}>
            {req.comments?.length ? (
              req.comments.map((c) => (
                <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <Typography.Text strong>{c.user.name_bn}</Typography.Text>
                  <Typography.Text type="secondary"> · {fmtDateTime(c.created_at)}</Typography.Text>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              ))
            ) : (
              <Typography.Text type="secondary">{tx('কোনো মন্তব্য নেই')}</Typography.Text>
            )}
            <Space.Compact style={{ width: '100%', marginTop: 12 }}>
              <Input placeholder={tx('মন্তব্য লিখুন')} value={comment} onChange={(e) => setComment(e.target.value)} onPressEnter={addComment} />
              <Button onClick={addComment}>{tx('পাঠান')}</Button>
            </Space.Compact>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title={tx('অনুমোদনের ধাপ')}>
            {req.steps.length ? (
              <Steps
                orientation="vertical"
                size="small"
                current={req.current_step - 1}
                status={req.status === 'rejected' ? 'error' : req.status === 'approved' ? 'finish' : 'process'}
                items={req.steps.map((s) => ({
                  title: tx('ধাপ {{p0}}: {{p1}}', { p0: digits(s.step_no), p1: s.roles.map(roleLabel).join(' / ') }),
                  content: s.actor ? (
                    <>
                      <div>
                        {s.actor.name_bn} — {DECISION_LABEL[({ approved: 'approve', rejected: 'reject', returned: 'return' } as const)[s.status as 'approved'] ?? 'approve']}
                      </div>
                      <div>{fmtDateTime(s.acted_at)}</div>
                      {s.remarks && <div>{tx('কারণ:')}{' '}{s.remarks}</div>}
                    </>
                  ) : (
                    tx('অপেক্ষমাণ')
                  ),
                }))}
              />
            ) : (
              <p>{tx('অনুমোদনের নিয়ম চালু না থাকায় স্বয়ংক্রিয়ভাবে অনুমোদিত।')}</p>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={!!decision}
        title={decision ? DECISION_LABEL[decision] : ''}
        onCancel={() => setDecision(null)}
        onOk={decide}
        confirmLoading={busy}
        okText={tx('নিশ্চিত করুন')}
        cancelText={tx('বাতিল')}
        okButtonProps={{ danger: decision === 'reject' }}
      >
        <Form layout="vertical">
          <Form.Item label={decision === 'approve' ? tx('মন্তব্য (ঐচ্ছিক)') : tx('কারণ (আবশ্যক)')} required={decision !== 'approve'}>
            <Input.TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
