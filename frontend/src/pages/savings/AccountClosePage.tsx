import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, Table, Tag } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, ClockCircleOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FundMemberPicker from '../../components/FundMemberPicker'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { KIND_LABEL, useFundMeta } from '../../lib/funds'
import { nameOf, t as tx } from '../../lib/i18n'
import { ACCOUNT_TONE, KindSwitch, useKindParam, type AccountRow } from './AccountListPage'
import DecideButtons from './DecideButtons'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-history.css'
import './savings.css'

type Detail = AccountRow & { kind: string; held: number; available: number; pending: { id: number; txn_no: string; type: string; amount: string; status: string }[]; close_request_id: number | null }
type Closing = AccountRow & { close_request_id: number | null }

/**
 * Close an account: its balance must be zero first (withdraw the savings,
 * transfer the shares) with nothing pending; the request then waits for the
 * manager, and the account takes no transactions meanwhile.
 */
export default function AccountClosePage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can, user } = useAuth()
  const queryClient = useQueryClient()
  const [sp] = useSearchParams()
  const [kind, setKind] = useKindParam()
  const { data: meta } = useFundMeta(kind)
  const [form] = Form.useForm()
  const [accountId, setAccountId] = useState<number | null>(Number(sp.get('account')) || null)
  const [saving, setSaving] = useState(false)

  const detail = useQuery({
    queryKey: ['fund-account', kind, accountId, 'close'],
    queryFn: async () => (await api.get<Detail>(`/funds/${kind}/accounts/${accountId}`)).data,
    enabled: !!accountId,
  })
  const closing = useQuery({
    queryKey: ['fund-accounts', kind, 'closing'],
    queryFn: async () => (await api.get<Paginated<Closing>>(`/funds/${kind}/accounts`, { params: { status: 'closing', per_page: 50 } })).data.data,
  })
  const a = detail.data
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fund-account', kind] })
    queryClient.invalidateQueries({ queryKey: ['fund-accounts'] })
  }

  const submit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v || !a) return
    setSaving(true)
    try {
      const r = await api.post<{ message: string }>(`/funds/${kind}/accounts/${a.id}/close`, { date: (v.date as Dayjs).format('YYYY-MM-DD'), reason: v.reason })
      message.success(r.data.message)
      form.resetFields()
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const balance = a ? Number(a.balance) : 0
  const blocked = !!a && (Math.abs(balance) >= 0.005 || a.pending.length > 0)
  const closeTexts = { confirm: tx('হিসাব বন্ধ অনুমোদন করবেন?'), reject: tx('হিসাব বন্ধের আবেদন প্রত্যাখ্যান'), approved: tx('অনুমোদিত — হিসাব বন্ধ হয়েছে।') }

  return (
    <PageFrame
      crumbs={[{ label: tx('সঞ্চয়'), to: '/savings/accounts' }, { label: tx('হিসাব'), to: '/savings/accounts' }, { label: tx('হিসাব বন্ধ') }]}
      title={tx('হিসাব বন্ধ')}
      actions={
        <>
          <KindSwitch
            kind={kind}
            onChange={(k) => {
              setKind(k)
              setAccountId(null)
            }}
          />
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate(`/savings/accounts${kind === 'share' ? '?kind=share' : ''}`)}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </>
      }
    >
      <section className="lf-card iv-section">
        <header className="lf-card-head">
          <span className="iv-section-icon">
            <UserOutlined />
          </span>
          <h3>{tx('১. হিসাব বাছাই')}</h3>
        </header>
        <div className="lf-card-body">
          <div className="iv-form">
            <label className="sv-label">{tx('সদস্য ({{p0}} হিসাব আছে এমন)', { p0: KIND_LABEL[kind] })}</label>
            <FundMemberPicker key={kind} kind={kind} filter="with" value={a?.member_id ?? null} onChange={(_, r) => setAccountId(r?.account?.id ?? null)} />
          </div>
          {a && (
            <div className="id-top sv-close-facts">
              <div className="sv-fact">
                <small>{tx('হিসাব নং')}</small>
                <Link to={`/funds/${kind}/accounts/${a.id}`}>
                  <strong>{digits(a.account_no)}</strong>
                </Link>
              </div>
              <div className="sv-fact">
                <small>{tx('সদস্য')}</small>
                <strong>{nameOf(a.member?.farmer)}</strong>
                <span>{tx('সদস্য নং {{p0}}', { p0: digits(a.member?.member_no ?? '') })}</span>
              </div>
              <div className="sv-fact">
                <small>{tx('খোলার তারিখ')}</small>
                <strong>{fmtDate(a.opened_on)}</strong>
              </div>
              <div className={`sv-fact ${Math.abs(balance) >= 0.005 ? 'sv-fact-bad' : 'sv-fact-ok'}`}>
                <small>{tx('জের')}</small>
                <strong>৳ {money(balance)}</strong>
              </div>
              <div className="sv-fact">
                <small>{tx('অবস্থা')}</small>
                <Tag className={`fl-tag ${ACCOUNT_TONE[a.status] ?? 'll-gray'}`}>{meta?.account_statuses[a.status] ?? a.status}</Tag>
              </div>
            </div>
          )}
        </div>
      </section>

      {a && (
        <section className="lf-card iv-section">
          <header className="lf-card-head">
            <span className="iv-section-icon">
              <LockOutlined />
            </span>
            <h3>{tx('২. বন্ধের আবেদন')}</h3>
          </header>
          <div className="lf-card-body">
            {a.status === 'closed' ? (
              <Alert type="info" showIcon title={tx('এই হিসাব {{p0}} তারিখে বন্ধ হয়েছে — কারণ: {{p1}}', { p0: fmtDate(a.closed_on), p1: a.close_reason ?? '—' })} description={tx('বন্ধ হিসাবে লেনদেন হয় না, তবে বিবরণী ও ইতিহাস দেখা যায়।')} />
            ) : a.status === 'closing' ? (
              <Alert
                type="warning"
                showIcon
                icon={<ClockCircleOutlined />}
                title={tx('বন্ধের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: a.close_reason ?? '—' })}
                action={
                  a.close_request_id && can(`${kind}.approve`) ? (
                    <span className="sv-decide">
                      <DecideButtons approvalId={a.close_request_id} who={`${nameOf(a.member?.farmer)} (${digits(a.account_no)})`} texts={closeTexts} onDone={refresh} />
                    </span>
                  ) : undefined
                }
              />
            ) : blocked ? (
              <Alert
                type="error"
                showIcon
                title={a.pending.length > 0 ? tx('এই হিসাবে অনুমোদনের অপেক্ষায় লেনদেন আছে — আগে সেগুলোর নিষ্পত্তি করুন।') : tx('হিসাবের জের ৳{{p0}} — বন্ধের আগে জের শূন্য করুন।', { p0: money(balance) })}
                description={a.pending.length > 0 ? tx('সেগুলো অনুমোদন বা প্রত্যাখ্যান হলে আবার চেষ্টা করুন।') : kind === 'savings' ? tx('সদস্যের পুরো সঞ্চয় উত্তোলন করে দিন; উত্তোলন অনুমোদনের পর এখানে আসুন।') : tx('শেয়ার অন্য সদস্যের নামে হস্তান্তর করুন (হিসাবের পাতা থেকে); হস্তান্তর অনুমোদনের পর এখানে আসুন।')}
                action={
                  kind === 'savings' && a.pending.length === 0 ? (
                    <Button size="small" type="primary" onClick={() => navigate('/savings/withdrawals/new')}>
                      {tx('উত্তোলন করুন')}
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => navigate(`/funds/${kind}/accounts/${a.id}`)}>
                      {tx('হিসাব দেখুন')}
                    </Button>
                  )
                }
              />
            ) : (
              <Form form={form} layout="vertical" className="iv-form sv-form" initialValues={{ date: dayjs() }}>
                <div className="iv-grid iv-grid-3">
                  <Form.Item name="date" label={tx('বন্ধের তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
                    <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(dayjs(a.opened_on), 'day')} />
                  </Form.Item>
                </div>
                <Form.Item name="reason" label={tx('কারণ')} rules={[{ required: true, message: tx('কারণ লিখুন') }]}>
                  <Input.TextArea rows={2} maxLength={300} showCount placeholder={tx('যেমন: সদস্যের লিখিত অনুরোধ')} />
                </Form.Item>
                <Alert type="info" showIcon className="sv-note" title={tx('আবেদন পাঠানোর পর থেকে এই হিসাবে লেনদেন বন্ধ থাকবে; ম্যানেজার অনুমোদন দিলে হিসাব বন্ধ হবে, না দিলে আবার চালু হবে।')} />
                <div className="iv-actions">
                  <span className="iv-spacer" />
                  <Button type="primary" danger icon={<LockOutlined />} loading={saving} disabled={!can(`${kind}.edit`)} onClick={submit}>
                    {tx('বন্ধের আবেদন পাঠান')}
                  </Button>
                </div>
              </Form>
            )}
          </div>
        </section>
      )}

      <section className="id-box">
        <header>
          <ClockCircleOutlined />
          <h3>{tx('বন্ধের অপেক্ষায় থাকা হিসাব ({{p0}})', { p0: digits(closing.data?.length ?? 0) })}</h3>
        </header>
        <Table<Closing>
          rowKey="id"
          size="small"
          className="id-payments"
          loading={closing.isFetching}
          pagination={false}
          dataSource={closing.data ?? []}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: tx('কোনো হিসাব বন্ধের অপেক্ষায় নেই') }}
          columns={[
            { title: tx('হিসাব নং'), dataIndex: 'account_no', render: (v: string, r) => <Link to={`/funds/${kind}/accounts/${r.id}`}>{digits(v)}</Link> },
            { title: tx('সদস্যের নাম'), render: (_, r) => nameOf(r.member?.farmer) || '—' },
            { title: tx('সদস্য নং'), render: (_, r) => digits(r.member?.member_no ?? '—') },
            { title: tx('বন্ধের তারিখ'), dataIndex: 'closed_on', render: fmtDate },
            { title: tx('কারণ'), dataIndex: 'close_reason', render: (v: string | null) => v || '—' },
            {
              title: tx('অ্যাকশন'),
              align: 'center',
              render: (_, r) => (
                <div className="fl-actions pl-actions">
                  <Button size="small" onClick={() => setAccountId(r.id)}>
                    {tx('দেখুন')}
                  </Button>
                  {r.close_request_id && can(`${kind}.approve`) && (
                    <DecideButtons compact approvalId={r.close_request_id} who={`${nameOf(r.member?.farmer)} (${digits(r.account_no)})`} texts={closeTexts} onDone={refresh} />
                  )}
                </div>
              ),
            },
          ]}
        />
        {user && <p className="sv-foot-note">{tx('যিনি আবেদন পাঠিয়েছেন তিনি নিজে অনুমোদন দিতে পারেন না।')}</p>}
      </section>
    </PageFrame>
  )
}
