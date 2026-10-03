import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Select, Table } from 'antd'
import { ArrowLeftOutlined, CalculatorOutlined, CalendarOutlined, CloseOutlined, DeleteOutlined, FileTextOutlined, PlusOutlined, SendOutlined, UnorderedListOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import SubTabs, { useView } from '../../components/SubTabs'
import SimpleEntryForm from './SimpleEntryForm'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountFilter, accountLabel, money, useAccountOptions } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../savings/savings.css'
import '../loans/loans.css'
import '../cash/cash.css'
import './accounting.css'

type Line = { account_id?: number; debit?: number | null; credit?: number | null; remarks?: string }
type Journal = { id: number; voucher_no: string; voucher_type: string; date: string; narration: string | null; status: string; lines: (Line & { account: { key?: string | null } })[] }

function Section({ no, icon, title, children }: { no: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="lf-card iv-section">
      <header className="lf-card-head">
        <span className="iv-section-icon">{icon}</span>
        <h3>
          {digits(no)}. {title}
        </h3>
      </header>
      <div className="lf-card-body">{children}</div>
    </section>
  )
}

/** A manual journal (debits = credits) or the opening-balance voucher; either goes for approval before it posts. */
export default function JournalFormPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { data: accounts } = useAccountOptions()
  // a new journal starts as a simple entry; the full debit/credit form is the other tab
  const view = useView('simple')

  const existing = useQuery({
    queryKey: ['journal', id],
    enabled: !!id,
    queryFn: async () => (await api.get<Journal & { lines: (Line & { account: { id: number; code: string } })[] }>(`/journals/${id}`)).data,
  })
  const type: string = existing.data?.voucher_type ?? (search.get('type') === 'opening' ? 'opening' : 'journal')
  const opening = type === 'opening'
  const obe = accounts?.find((a) => a.key === 'opening_balance_equity')

  useEffect(() => {
    if (id) {
      const j = existing.data
      if (j)
        form.setFieldsValue({
          date: dayjs(j.date),
          narration: j.narration,
          // The balancing Opening Balance Equity line is re-added by the server.
          lines: j.lines.filter((l) => !(j.voucher_type === 'opening' && l.account_id === obe?.id)).map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || null, credit: Number(l.credit) || null, remarks: l.remarks })),
        })
    } else {
      form.setFieldsValue({ date: dayjs(), lines: opening ? [{}] : [{}, {}] })
    }
  }, [id, existing.data, opening, obe?.id, form])

  const lines: Line[] = Form.useWatch('lines', form) ?? []
  const dr = lines.reduce((s, l) => s + (Number(l?.debit) || 0), 0)
  const cr = lines.reduce((s, l) => s + (Number(l?.credit) || 0), 0)
  const diff = Math.round((dr - cr) * 100) / 100
  const filled = lines.filter((l) => l?.account_id && (Number(l.debit) || Number(l.credit))).length

  const options = (accounts ?? []).filter((a) => !(opening && a.id === obe?.id)).map((a) => ({ value: a.id, label: accountLabel(a) }))

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    const payload = {
      voucher_type: type,
      date: (v.date as Dayjs).format('YYYY-MM-DD'),
      narration: v.narration,
      lines: (v.lines as Line[]).map((l) => ({ ...l, debit: l.debit || 0, credit: l.credit || 0 })),
    }
    setSaving(true)
    try {
      const r = id ? await api.put(`/journals/${id}`, payload) : await api.post('/journals', payload)
      message.success(tx('ভাউচার {{p0}} অনুমোদনের জন্য পাঠানো হয়েছে।', { p0: digits(r.data.voucher_no) }))
      queryClient.invalidateQueries({ queryKey: ['journals'] })
      queryClient.invalidateQueries({ queryKey: ['journal', String(r.data.id)] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      navigate(`/accounting/journals/${r.data.id}`)
    } catch (e) {
      // Balance/line errors belong to the whole list, so always show them as a message too.
      applyFormErrors(form, e)
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const title = opening ? tx('প্রারম্ভিক জের এন্ট্রি') : tx('জার্নাল এন্ট্রি')
  const frame = (children: ReactNode) => (
    <PageFrame
      crumbs={[{ label: tx('হিসাব'), to: '/accounting/summary' }, { label: tx('ভাউচার'), to: '/accounting/journals' }, { label: title }]}
      title={existing.data ? `${title} — ${digits(existing.data.voucher_no)}` : title}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate(id ? `/accounting/journals/${id}` : '/accounting/journals')}>
          {id ? tx('ভাউচারে ফিরুন') : tx('তালিকায় ফিরুন')}
        </Button>
      }
    >
      {children}
    </PageFrame>
  )

  if (id && existing.data && existing.data.status !== 'returned') {
    return frame(<Alert type="warning" showIcon title={tx('শুধু ফেরত আসা ভাউচার সংশোধন করা যায়।')} />)
  }

  const entryTabs =
    !id && !opening ? (
      <SubTabs
        items={[
          { key: 'simple', label: tx('সহজ এন্ট্রি') },
          { key: 'detailed', label: tx('বিস্তারিত এন্ট্রি (ডেবিট-ক্রেডিট)') },
        ]}
      />
    ) : null
  if (!id && !opening && view === 'simple') {
    return frame(
      <>
        {entryTabs}
        <SimpleEntryForm />
      </>,
    )
  }

  return frame(
    <>
      {entryTabs}
      <div className="ln-form-grid jf-grid">
        <Form form={form} layout="vertical" className="iv-form sv-form">
          <Section no={1} icon={<FileTextOutlined />} title={tx('ভাউচারের তথ্য')}>
            <div className="iv-grid jf-head">
              <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="narration" label={tx('বিবরণ')}>
                <Input maxLength={500} placeholder={tx('যেমন: অফিস ভাড়া পরিশোধ — সেপ্টেম্বর')} />
              </Form.Item>
            </div>
          </Section>

          <Section no={2} icon={<UnorderedListOutlined />} title={tx('ডেবিট ও ক্রেডিট লাইন')}>
            <Form.List
              name="lines"
              rules={[
                {
                  validator: async (_, v: Line[]) => {
                    if (!v?.length) throw new Error(tx('অন্তত একটি লাইন দিন'))
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <>
                  <div className="id-payments">
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="key"
                      dataSource={fields}
                      scroll={{ x: 'max-content' }}
                      columns={[
                        { title: '#', width: 40, align: 'center', render: (_, __, i) => digits(i + 1) },
                        {
                          title: tx('হিসাব'),
                          render: (_, f) => (
                            <Form.Item name={[f.name, 'account_id']} rules={[required(tx('হিসাব নির্বাচন করুন'))]} style={{ margin: 0 }}>
                              <Select options={options} showSearch={{ filterOption: accountFilter }} style={{ minWidth: 200 }} placeholder={tx('হিসাব বাছাই করুন')} />
                            </Form.Item>
                          ),
                        },
                        {
                          title: tx('ডেবিট (৳)'),
                          width: 125,
                          render: (_, f) => (
                            <Form.Item name={[f.name, 'debit']} style={{ margin: 0 }}>
                              <InputNumber min={0} precision={2} placeholder="0.00" style={{ width: '100%' }} onChange={(v) => v && form.setFieldValue(['lines', f.name, 'credit'], null)} />
                            </Form.Item>
                          ),
                        },
                        {
                          title: tx('ক্রেডিট (৳)'),
                          width: 125,
                          render: (_, f) => (
                            <Form.Item name={[f.name, 'credit']} style={{ margin: 0 }}>
                              <InputNumber min={0} precision={2} placeholder="0.00" style={{ width: '100%' }} onChange={(v) => v && form.setFieldValue(['lines', f.name, 'debit'], null)} />
                            </Form.Item>
                          ),
                        },
                        {
                          title: tx('মন্তব্য'),
                          width: 140,
                          render: (_, f) => (
                            <Form.Item name={[f.name, 'remarks']} style={{ margin: 0 }}>
                              <Input maxLength={255} />
                            </Form.Item>
                          ),
                        },
                        {
                          title: '',
                          width: 44,
                          render: (_, f) => <Button type="text" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} disabled={fields.length <= 1} onClick={() => remove(f.name)} />,
                        },
                      ]}
                      summary={() => (
                        <Table.Summary.Row className="ln-sum-row">
                          <Table.Summary.Cell index={0} colSpan={2} align="right">
                            {tx('মোট')}
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="right">
                            {money(dr)}
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={3} align="right">
                            {money(cr)}
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={4} colSpan={2}>
                            {diff === 0 ? (
                              <span className="cs-in">{tx('মিলেছে')}</span>
                            ) : opening ? (
                              <span className="ac-muted">{tx('সমন্বয়: {{p0}}', { p0: money(Math.abs(diff)) })}</span>
                            ) : (
                              <span className="cs-out">{tx('পার্থক্য: {{p0}}', { p0: money(Math.abs(diff)) })}</span>
                            )}
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      )}
                    />
                  </div>
                  <Form.ErrorList errors={errors} />
                  <Button className="iv-add" icon={<PlusOutlined />} style={{ marginTop: 10 }} onClick={() => add({})}>
                    {tx('লাইন যোগ করুন')}
                  </Button>
                </>
              )}
            </Form.List>
          </Section>

          <div className="iv-actions">
            <Button icon={<CloseOutlined />} onClick={() => navigate(id ? `/accounting/journals/${id}` : '/accounting/journals')}>
              {tx('বাতিল')}
            </Button>
            <span className="iv-spacer" />
            <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={save} disabled={!opening && diff !== 0}>
              {tx('অনুমোদনের জন্য পাঠান')}
            </Button>
          </div>
        </Form>

        <div className="ln-side">
          <section className="id-box">
            <header>
              <CalculatorOutlined />
              <h3>{tx('ভাউচারের হিসাব')}</h3>
            </header>
            <div className="ln-limit">
              <table className="ln-limit-table">
                <tbody>
                  <tr>
                    <td>{tx('লাইন')}</td>
                    <td>{digits(filled)}</td>
                  </tr>
                  <tr>
                    <td>{tx('মোট ডেবিট')}</td>
                    <td>৳ {money(dr)}</td>
                  </tr>
                  <tr>
                    <td>{tx('মোট ক্রেডিট')}</td>
                    <td>৳ {money(cr)}</td>
                  </tr>
                  <tr className="ln-limit-total">
                    <td>{opening ? tx('প্রারম্ভিক জের সমন্বয়') : tx('পার্থক্য')}</td>
                    <td className={diff === 0 || opening ? undefined : 'cs-out'}>৳ {money(Math.abs(diff))}</td>
                  </tr>
                </tbody>
              </table>
              {!opening && diff !== 0 && <Alert type="warning" showIcon title={tx('ডেবিট ও ক্রেডিট সমান না হলে পাঠানো যাবে না।')} />}
              {!opening && diff === 0 && dr > 0 && <Alert type="success" showIcon title={tx('ডেবিট ও ক্রেডিট মিলেছে।')} />}
            </div>
          </section>
          <section className="id-box">
            <header>
              <FileTextOutlined />
              <h3>{tx('নিয়ম')}</h3>
            </header>
            <p className="sv-foot-note">
              {opening
                ? tx('চালুর দিনের নগদ, ব্যাংক, পাওনা ও দেনার জের দিন। পার্থক্যটুকু স্বয়ংক্রিয়ভাবে "প্রারম্ভিক জের সমন্বয়" হিসাবে যাবে। ম্যানেজারের অনুমোদনের পর পোস্ট হবে।')
                : tx('মোট ডেবিট ও মোট ক্রেডিট সমান হতে হবে। ম্যানেজারের অনুমোদনের পর পোস্ট হবে।')}
            </p>
          </section>
        </div>
      </div>
    </>,
  )
}
