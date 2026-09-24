import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Modal, Row, Space, Spin, Statistic, Table, Tabs, Tag } from 'antd'
import { DollarOutlined, DownloadOutlined, PrinterOutlined, SendOutlined, StopOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import type { Person } from '../../lib/funds'
import { METHOD_LABEL } from '../../lib/irrigation'
import { BUCKET_COLOR, INSTALLMENT_COLOR, LOAN_STATUS_COLOR, PAYMENT_STATUS_COLOR, useLoanMeta, type Installment, type LoanPayment, type LoanRow, type Position, type ScheduleRow } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { DisburseModal, PayModal } from './LoanMoneyModals'
import SchedulePreview from './SchedulePreview'

type Guarantor = { id: number; member_id: number; relation: string | null; member: LoanRow['member'] }
type Detail = LoanRow & {
  remarks: string | null
  method: string | null
  reference: string | null
  guarantors: Guarantor[]
  fund: { code: string; name_bn: string; name_en: string | null } | null
  journal: { id: number; voucher_no: string; status: string } | null
  creator: Person
  disburser: Person
  created_at: string
  position: Position | null
  preview: ScheduleRow[] | null
  payments: LoanPayment[]
  approval: { id: number; status: string; current_step: number; total_steps: number } | null
}
type StRow = { id: number | null; date: string; ref: string; label: string; disbursed: number; paid: number; penalty: number; interest: number; principal: number; balance: number }
type Statement = { rows: StRow[]; totals: { paid: number; penalty: number; interest: number; principal: number }; closing: number }

export default function LoanDetailPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useLoanMeta()
  const [modal, setModal] = useState<'disburse' | 'pay' | 'cancel' | null>(null)
  const [form] = Form.useForm()

  const { data: l, isLoading } = useQuery({ queryKey: ['loan', id], queryFn: async () => (await api.get<Detail>(`/loans/${id}`)).data })
  const disbursed = !!l?.disbursed_on
  const st = useQuery({ queryKey: ['loan-statement', id], queryFn: async () => (await api.get<Statement>(`/loans/${id}/statement`)).data, enabled: disbursed })
  if (isLoading || !l) return <Spin />

  const refresh = () => {
    setModal(null)
    queryClient.invalidateQueries({ queryKey: ['loan', id] })
    queryClient.invalidateQueries({ queryKey: ['loan-statement', id] })
    queryClient.invalidateQueries({ queryKey: ['loans'] })
  }
  const cancel = async () => {
    const v = await form.validateFields()
    try {
      const res = await api.post<{ message: string }>(`/loans/${l.id}/cancel`, v)
      message.success(res.data.message)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const p = l.position
  const canCollect = can(['loan.create', 'payment.create'])
  const pendingCancel = l.payments.some((x) => x.status === 'cancel_pending')
  const farmer = l.member?.farmer
  const terms =
    l.frequency === 'one_time'
      ? `${meta.data?.frequencies[l.frequency] ?? ''} — ${tx('{{p0}} মাস', { p0: digits(l.term_months ?? '') })}`
      : `${digits(l.installments)} × ${meta.data?.frequencies[l.frequency] ?? l.frequency}`

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('ঋণ {{p0}}', { p0: digits(l.loan_no) })} <Tag color={LOAN_STATUS_COLOR[l.status]}>{meta.data?.statuses[l.status] ?? l.status}</Tag>
          {p?.bucket && <Tag color={BUCKET_COLOR[p.bucket]}>{tx('মেয়াদোত্তীর্ণ')}: {meta.data?.buckets[p.bucket]}</Tag>}
        </h2>
        <Space wrap>
          {disbursed && (
            <>
              <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
                {tx('প্রিন্ট')}
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => downloadExport(`/loans/${l.id}/statement`, { export: 'csv' }, `loan-statement-${l.loan_no}.csv`).catch((e) => message.error(errorMessage(e)))}>
                Excel
              </Button>
            </>
          )}
          {l.status === 'approved' && can('loan.create') && (
            <>
              <Button type="primary" icon={<SendOutlined />} onClick={() => setModal('disburse')}>
                {tx('বিতরণ করুন')}
              </Button>
              <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setModal('cancel'))}>
                {tx('আবেদন বাতিল')}
              </Button>
            </>
          )}
          {l.status === 'active' && canCollect && (
            <Button type="primary" icon={<DollarOutlined />} disabled={pendingCancel} onClick={() => setModal('pay')}>
              {tx('কিস্তি জমা')}
            </Button>
          )}
        </Space>
      </div>

      {l.status === 'pending' && (
        <Alert
          className="no-print"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            <>
              {tx('আবেদনটি অনুমোদনের অপেক্ষায়।')} {l.approval && <Link to={`/approvals/${l.approval.id}`}>{tx('অনুমোদনের অনুরোধ দেখুন')}</Link>}
            </>
          }
        />
      )}
      {l.status === 'approved' && <Alert className="no-print" type="info" showIcon style={{ marginBottom: 16 }} title={tx('অনুমোদিত — টাকা বিতরণ করলে কিস্তির তালিকা চালু হবে।')} />}
      {pendingCancel && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('একটি পরিশোধ বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় — নিষ্পত্তির আগে নতুন কিস্তি নেওয়া যাবে না।')} />}

      <div className="print-only" style={{ textAlign: 'center', marginBottom: 12 }}>
        <span className="receipt-title">{tx('ঋণ বিবরণী — {{p0}}', { p0: digits(l.loan_no) })}</span>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card size="small">
            <Descriptions column={{ xs: 1, md: 2 }} size="small">
              <Descriptions.Item label={tx('সদস্য')}>
                {farmer && (
                  <Link to={`/farmers/${farmer.id}`}>
                    {nameOf(farmer)} ({tx('সদস্য নং')} {digits(l.member?.member_no)})
                  </Link>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={tx('পিতার নাম')}>{farmer?.father_name}</Descriptions.Item>
              <Descriptions.Item label={tx('মোবাইল')}>{digits(farmer?.mobile)}</Descriptions.Item>
              <Descriptions.Item label={tx('ঋণের ধরন')}>{nameOf(l.product)}</Descriptions.Item>
              <Descriptions.Item label={tx('ঋণের পরিমাণ')}>৳{money(l.amount)}</Descriptions.Item>
              <Descriptions.Item label={tx('ঋণসীমা')}>৳{money(l.limit_amount)}</Descriptions.Item>
              <Descriptions.Item label={tx('সুদ')}>
                {digits(Number(l.interest_rate))}% {tx('বার্ষিক')} · {meta.data?.methods[l.interest_method] ?? l.interest_method}
              </Descriptions.Item>
              <Descriptions.Item label={tx('কিস্তি')}>{terms}</Descriptions.Item>
              <Descriptions.Item label={tx('জরিমানা')}>{tx('{{p0}}%/মাস, ছাড় {{p1}} দিন', { p0: digits(Number(l.penalty_rate)), p1: digits(l.grace_days) })}</Descriptions.Item>
              <Descriptions.Item label={tx('আবেদনের তারিখ')}>{fmtDate(l.applied_on)}</Descriptions.Item>
              {disbursed && (
                <>
                  <Descriptions.Item label={tx('বিতরণের তারিখ')}>{fmtDate(l.disbursed_on)}</Descriptions.Item>
                  <Descriptions.Item label={tx('মোট সুদ')}>৳{money(l.total_interest)}</Descriptions.Item>
                  <Descriptions.Item label={tx('মাধ্যম')} className="no-print">
                    {METHOD_LABEL[l.method ?? ''] ?? l.method}
                    {l.fund && ` — ${accountLabel(l.fund)}`}
                    {l.reference && `, ${digits(l.reference)}`}
                  </Descriptions.Item>
                  <Descriptions.Item label={tx('ভাউচার')} className="no-print">
                    {l.journal && (can('accounting.view') ? <Link to={`/accounting/journals/${l.journal.id}`}>{digits(l.journal.voucher_no)}</Link> : digits(l.journal.voucher_no))}
                  </Descriptions.Item>
                </>
              )}
              {l.closed_on && <Descriptions.Item label={tx('সমাপ্তির তারিখ')}>{fmtDate(l.closed_on)}</Descriptions.Item>}
              {l.purpose && <Descriptions.Item label={tx('উদ্দেশ্য')}>{l.purpose}</Descriptions.Item>}
              {l.remarks && <Descriptions.Item label={tx('মন্তব্য')}>{l.remarks}</Descriptions.Item>}
              <Descriptions.Item label={tx('জামিনদার')} span="filled">
                {l.guarantors.length
                  ? l.guarantors.map((g, i) => (
                      <span key={g.id}>
                        {i > 0 && '; '}
                        {nameOf(g.member?.farmer)} ({tx('সদস্য নং')} {digits(g.member?.member_no)}){g.relation && ` — ${g.relation}`}
                      </span>
                    ))
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={tx('আবেদন করেছেন')} className="no-print">
                {nameOf(l.creator)}, {fmtDateTime(l.created_at)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        {p && (
          <Col xs={24} lg={10}>
            <Row gutter={[12, 12]}>
              <Col span={12}>
                <Card size="small">
                  <Statistic title={tx('আসল বাকি')} value={money(p.principal_outstanding)} prefix="৳" />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Statistic title={tx('সুদ বাকি')} value={money(p.interest_outstanding)} prefix="৳" />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Statistic title={tx('এখন দেয় (জরিমানাসহ)')} value={money(p.due_now)} prefix="৳" styles={{ content: { color: p.overdue_amount ? '#cf1322' : undefined } }} />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Statistic title={tx('জরিমানা বাকি')} value={money(p.penalty_due)} prefix="৳" />
                </Card>
              </Col>
              <Col span={24}>
                <Card size="small">
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label={tx('আদায় হয়েছে')}>
                      {tx('আসল ৳{{p0}}, সুদ ৳{{p1}}, জরিমানা ৳{{p2}}', { p0: money(p.principal_paid), p1: money(p.interest_paid), p2: money(p.penalty_paid) })}
                    </Descriptions.Item>
                    <Descriptions.Item label={tx('পুরো ঋণ শোধে')}>৳{money(p.payoff)}</Descriptions.Item>
                    {p.oldest_overdue && (
                      <Descriptions.Item label={tx('সবচেয়ে পুরনো বকেয়া')}>
                        {fmtDate(p.oldest_overdue)} — {tx('{{p0}} দিন', { p0: digits(p.days_overdue) })}
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                </Card>
              </Col>
            </Row>
          </Col>
        )}
      </Row>

      {!disbursed ? (
        l.preview && (
          <Card title={tx('কিস্তির তালিকা (সম্ভাব্য)')} size="small">
            <SchedulePreview rows={l.preview} />
          </Card>
        )
      ) : (
        <Tabs
          defaultActiveKey={search.get('tab') ?? undefined}
          items={[
            {
              key: 'schedule',
              label: tx('কিস্তির তালিকা'),
              children: (
                <Table<Installment>
                  rowKey="id"
                  size="small"
                  dataSource={p?.installments}
                  pagination={false}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: tx('কিস্তি'), dataIndex: 'seq', width: 60, render: (v: number) => digits(v) },
                    { title: tx('তারিখ'), dataIndex: 'due_date', width: 110, render: fmtDate },
                    { title: tx('আসল'), dataIndex: 'principal', align: 'right', render: money },
                    { title: tx('সুদ'), dataIndex: 'interest', align: 'right', render: money },
                    { title: tx('মোট'), dataIndex: 'total', align: 'right', render: money },
                    { title: tx('আসল জমা'), dataIndex: 'principal_paid', align: 'right', render: (v) => moneyOrBlank(Number(v)) },
                    { title: tx('সুদ জমা'), dataIndex: 'interest_paid', align: 'right', render: (v) => moneyOrBlank(Number(v)) },
                    { title: tx('বাকি'), dataIndex: 'outstanding', align: 'right', render: (v: number) => moneyOrBlank(v) },
                    { title: tx('জরিমানা'), align: 'right', render: (_, r) => moneyOrBlank(Number(r.penalty_paid) + r.penalty_due) },
                    { title: tx('অবস্থা'), dataIndex: 'state', width: 110, render: (s: string, r) => <Tag color={INSTALLMENT_COLOR[s]}>{STATE_LABEL[s]}{r.paid_on && s === 'paid' ? ` ${fmtDate(r.paid_on)}` : ''}</Tag> },
                  ]}
                />
              ),
            },
            {
              key: 'statement',
              label: tx('ঋণ বিবরণী'),
              children: (
                <Table<StRow>
                  rowKey={(r) => r.ref}
                  size="small"
                  loading={st.isFetching}
                  dataSource={st.data?.rows}
                  pagination={false}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
                    { title: tx('রেফারেন্স'), dataIndex: 'ref', width: 150, render: (v: string, r) => (r.id ? <Link to={`/loans/payments/${r.id}`}>{digits(v)}</Link> : digits(v)) },
                    { title: tx('বিবরণ'), dataIndex: 'label' },
                    { title: tx('বিতরণ'), dataIndex: 'disbursed', align: 'right', render: moneyOrBlank },
                    { title: tx('পরিশোধ'), dataIndex: 'paid', align: 'right', render: moneyOrBlank },
                    { title: tx('জরিমানা'), dataIndex: 'penalty', align: 'right', render: moneyOrBlank },
                    { title: tx('সুদ'), dataIndex: 'interest', align: 'right', render: moneyOrBlank },
                    { title: tx('আসল'), dataIndex: 'principal', align: 'right', render: moneyOrBlank },
                    { title: tx('আসল বাকি'), dataIndex: 'balance', align: 'right', render: money },
                  ]}
                  summary={() =>
                    st.data && (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={4}>
                          <strong>{tx('মোট')}</strong>
                        </Table.Summary.Cell>
                        {(['paid', 'penalty', 'interest', 'principal'] as const).map((k, i) => (
                          <Table.Summary.Cell key={k} index={i + 1} align="right">
                            <strong>{money(st.data.totals[k])}</strong>
                          </Table.Summary.Cell>
                        ))}
                        <Table.Summary.Cell index={5} align="right">
                          <strong>{money(st.data.closing)}</strong>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    )
                  }
                />
              ),
            },
            {
              key: 'payments',
              label: tx('পরিশোধের রশিদ ({{p0}})', { p0: digits(l.payments.length) }),
              children: (
                <Table<LoanPayment>
                  rowKey="id"
                  size="small"
                  dataSource={l.payments}
                  pagination={false}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: tx('রশিদ নং'), dataIndex: 'payment_no', render: (v: string, r) => <Link to={`/loans/payments/${r.id}`}>{digits(v)}</Link> },
                    { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
                    { title: tx('মোট'), dataIndex: 'amount', align: 'right', render: money },
                    { title: tx('জরিমানা'), dataIndex: 'penalty', align: 'right', render: money },
                    { title: tx('সুদ'), dataIndex: 'interest', align: 'right', render: money },
                    { title: tx('আসল'), dataIndex: 'principal', align: 'right', render: money },
                    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag color={PAYMENT_STATUS_COLOR[s]}>{meta.data?.payment_statuses[s] ?? s}</Tag> },
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      <DisburseModal loan={l} open={modal === 'disburse'} onClose={() => setModal(null)} onDone={refresh} />
      <PayModal
        loan={l}
        open={modal === 'pay'}
        onClose={() => setModal(null)}
        onDone={(pid) => {
          refresh()
          navigate(`/loans/payments/${pid}`)
        }}
      />
      <Modal open={modal === 'cancel'} forceRender title={tx('ঋণ আবেদন বাতিল')} onCancel={() => setModal(null)} onOk={cancel} okText={tx('বাতিল করুন')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

const STATE_LABEL: Record<string, string> = { paid: tx('পরিশোধিত'), overdue: tx('মেয়াদোত্তীর্ণ'), partial: tx('আংশিক'), due: tx('বাকি') }
