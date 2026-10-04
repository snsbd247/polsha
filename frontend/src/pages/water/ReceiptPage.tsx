import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Spin, Table, Tag } from 'antd'
import { PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL, amountInWords } from '../../lib/irrigation'
import { appUrl } from '../../lib/phase8'
import { type Society } from '../../lib/settings'
import { nameOf, t as tx } from '../../lib/i18n'
import { billLabel, type BillSnapshot } from '../../lib/water'
import { ReceiptFacts, ReceiptFoot, ReceiptMeta, ReceiptPaper, ReceiptSign, ReceiptTop } from '../../components/PrintParts'
import PageFrame from '../../components/PageFrame'

type Item = { amount: number; description: string; due_after: number | null; bill: { id: number; bill_no: string; kind: string; period: string | null; amount: number } | null }
type Detail = {
  id: number
  receipt_no: string
  date: string
  amount: string
  method: string
  reference: string | null
  remarks: string | null
  status: string
  cancel_reason: string | null
  verify_token: string
  penalty: number
  payer_name: string
  connection: (BillSnapshot & { id: number }) | null
  items: Item[]
  fund: { code: string; name_bn: string; name_en: string | null } | null
  journal: { id: number; voucher_no: string; status: string } | null
  creator: { name_bn: string; name_en: string | null } | null
  society: Society
}

/** One water receipt: details on screen, the two-copy slip on paper. */
export default function ReceiptPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()
  const { data: r, isLoading } = useQuery({
    queryKey: ['water', 'receipt', id],
    queryFn: async () => (await api.get<Detail>(`/water/receipts/${id}`)).data,
  })
  // opened with ?print=1 from the list: print once the receipt is on screen
  useEffect(() => {
    if (r && sp.get('print') === '1') setTimeout(() => window.print(), 400)
  }, [r, sp])
  if (isLoading || !r) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/water/receipts/${r.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['water'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const amount = Number(r.amount)
  const c = r.connection
  const months = r.items.map((it) => (it.bill ? billLabel(it.bill) : it.description)).join(', ')
  const dueAfter = r.items.reduce((s, it) => s + Number(it.due_after ?? 0), 0)
  const showDue = r.society.show_due !== false
  const tk = (v: number) => `${money(v)}৳`

  return (
    <>
      <div className="no-print">
        <PageFrame
          className="ml pl"
          crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('পানির রশিদ'), to: '/water/receipts' }, { label: digits(r.receipt_no) }]}
          title={tx('পানির বিলের রশিদ — {{p0}}', { p0: digits(r.receipt_no) })}
          actions={
            <>
              <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
                {tx('রশিদ প্রিন্ট')}
              </Button>
              {r.status === 'active' && can('water.edit') && (
                <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
                  {tx('রশিদ বাতিল')}
                </Button>
              )}
            </>
          }
        >
          {r.status !== 'active' && (
            <Alert
              type={r.status === 'cancelled' ? 'error' : 'warning'}
              showIcon
              style={{ marginBottom: 16 }}
              title={RECEIPT_STATUS_LABEL[r.status] ?? r.status}
              description={r.cancel_reason ? `${tx('কারণ')}: ${r.cancel_reason}` : undefined}
            />
          )}
          <Card size="small" style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={{ xs: 1, md: 3 }}>
              <Descriptions.Item label={tx('গ্রাহক')}>{c ? <Link to={`/water/connections/${c.id}`}>{nameOf(c)}</Link> : r.payer_name}</Descriptions.Item>
              <Descriptions.Item label={tx('সংযোগ নং')}>{c ? digits(c.connection_no) : '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('তারিখ')}>{fmtDate(r.date)}</Descriptions.Item>
              <Descriptions.Item label={tx('মোট টাকা')}>
                <strong>৳ {money(amount)}</strong>
              </Descriptions.Item>
              <Descriptions.Item label={tx('জরিমানা')}>{r.penalty ? `৳ ${money(r.penalty)}` : '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('মাধ্যম')}>
                {METHOD_LABEL[r.method] ?? r.method}
                {r.fund && r.method !== 'cash' ? ` — ${accountLabel(r.fund)}` : ''}
              </Descriptions.Item>
              <Descriptions.Item label={tx('ভাউচার')}>{r.journal ? digits(r.journal.voucher_no) : '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('অবস্থা')}>
                <Tag color={RECEIPT_STATUS_COLOR[r.status]}>{RECEIPT_STATUS_LABEL[r.status] ?? r.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={tx('আদায়কারী')}>{nameOf(r.creator)}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Table<Item>
            rowKey={(it) => it.bill?.id ?? it.description}
            size="small"
            pagination={false}
            dataSource={r.items}
            columns={[
              { title: tx('কিসের বিল'), render: (_, it) => (it.bill ? billLabel(it.bill) : it.description) },
              { title: tx('বিল নং'), render: (_, it) => digits(it.bill?.bill_no ?? '') },
              { title: tx('আদায়'), dataIndex: 'amount', align: 'right', render: money },
              { title: tx('আদায়ের পর বকেয়া'), dataIndex: 'due_after', align: 'right', render: (v) => (v === null ? '' : money(v)) },
            ]}
          />
        </PageFrame>
      </div>

      <div className="print-only">
        <ReceiptPaper society={r.society} doc={{ type: 'receipt', id: r.id }} payerCopy={tx('গ্রাহক কপি')}>
          {r.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
          <ReceiptTop society={r.society} title={tx('পানির বিল আদায় রশিদ')} qr={appUrl(`/verify/receipt/${r.verify_token}`)} />
          <ReceiptMeta
            lines={[
              <>
                {tx('রশিদ নং')}: {digits(r.receipt_no)}
              </>,
              <>
                {tx('সংযোগ নং')}: {c ? digits(c.connection_no) : '—'}
              </>,
            ]}
            date={
              <>
                {tx('সংগৃহীত তারিখ')}: {fmtDate(r.date)} {tx('ইং')}
              </>
            }
          />
          <ReceiptFacts
            rows={[
              [tx('গ্রাহকের নাম'), c ? nameOf(c) : r.payer_name],
              [tx('পিতা/স্বামীর নাম'), c?.father_name || '—'],
              [tx('গ্রাম/পাড়া/মোবাইল নং'), `${[nameOf({ name_bn: c?.village ?? '', name_en: c?.village_en }), c?.address].filter(Boolean).join(', ') || '—'}/${c?.mobile ? digits(c.mobile) : tx('নেই')}`],
              [tx('সংযোগের ধরন'), c ? nameOf({ name_bn: c.type ?? '', name_en: c.type_en }) : null],
              [tx('যে বিল পরিশোধ'), months],
              [tx('জরিমানা'), r.penalty ? tk(r.penalty) : null],
              [tx('মোট আদায়ের পরিমাণ'), <strong key="t">{tk(amount)}</strong>],
              [tx('কথায়'), amountInWords(amount)],
              [tx('আদায়ের পর বকেয়া'), showDue ? tk(dueAfter) : null],
              [tx('মাধ্যম'), r.method !== 'cash' ? `${METHOD_LABEL[r.method] ?? r.method}${r.fund ? ` — ${accountLabel(r.fund)}` : ''}${r.reference ? `, ${tx('রেফারেন্স')}: ${digits(r.reference)}` : ''}` : null],
              [tx('মন্তব্য'), r.remarks],
            ]}
          />
          <ReceiptSign society={r.society} collector={nameOf(r.creator)} left={tx('গ্রাহক/প্রদানকারীর স্বাক্ষর')} />
          <ReceiptFoot society={r.society} fallback={tx('এটি সিস্টেম-জেনারেটেড রশিদ। অনুগ্রহ করে আপনার রেকর্ডের জন্য সংরক্ষণ করুন।')} />
        </ReceiptPaper>
      </div>

      <Modal open={cancelling} forceRender title={tx('রশিদ বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর রশিদ বাতিল হবে, আদায় ও জরিমানা উল্টে যাবে এবং বিলগুলো আবার বকেয়া দেখাবে।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[{ required: true, message: tx('কারণ লিখুন') }]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
