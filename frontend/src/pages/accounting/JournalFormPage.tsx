import { useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Table, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountFilter, accountLabel, money, useAccountOptions } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'

type Line = { account_id?: number; debit?: number | null; credit?: number | null; remarks?: string }
type Journal = { id: number; voucher_no: string; voucher_type: string; date: string; narration: string | null; status: string; lines: (Line & { account: { key?: string | null } })[] }

export default function JournalFormPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: accounts } = useAccountOptions()

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
          lines: j.lines
            .filter((l) => !(j.voucher_type === 'opening' && l.account_id === obe?.id))
            .map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || null, credit: Number(l.credit) || null, remarks: l.remarks })),
        })
    } else {
      form.setFieldsValue({ date: dayjs(), lines: opening ? [{}] : [{}, {}] })
    }
  }, [id, existing.data, opening, obe?.id, form])

  const lines: Line[] = Form.useWatch('lines', form) ?? []
  const dr = lines.reduce((s, l) => s + (Number(l?.debit) || 0), 0)
  const cr = lines.reduce((s, l) => s + (Number(l?.credit) || 0), 0)
  const diff = Math.round((dr - cr) * 100) / 100

  const options = (accounts ?? []).filter((a) => !(opening && a.id === obe?.id)).map((a) => ({ value: a.id, label: accountLabel(a) }))

  const save = async () => {
    const v = await form.validateFields()
    const payload = {
      voucher_type: type,
      date: (v.date as Dayjs).format('YYYY-MM-DD'),
      narration: v.narration,
      lines: (v.lines as Line[]).map((l) => ({ ...l, debit: l.debit || 0, credit: l.credit || 0 })),
    }
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
    }
  }

  if (id && existing.data && existing.data.status !== 'returned') {
    return <Alert type="warning" showIcon title={tx('শুধু ফেরত আসা ভাউচার সংশোধন করা যায়।')} />
  }

  return (
    <>
      <div className="page-header">
        <h2>
          {opening ? tx('প্রারম্ভিক জের এন্ট্রি') : tx('জার্নাল এন্ট্রি')}
          {existing.data && ` — ${digits(existing.data.voucher_no)}`}
        </h2>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={
          opening
            ? tx('চালুর দিনের নগদ, ব্যাংক, পাওনা ও দেনার জের দিন। পার্থক্যটুকু স্বয়ংক্রিয়ভাবে "প্রারম্ভিক জের সমন্বয়" হিসাবে যাবে। ম্যানেজারের অনুমোদনের পর পোস্ট হবে।')
            : tx('মোট ডেবিট ও মোট ক্রেডিট সমান হতে হবে। ম্যানেজারের অনুমোদনের পর পোস্ট হবে।')
        }
      />
      <Card>
        <Form form={form} layout="vertical">
          <Space wrap size="large" align="start">
            <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="narration" label={tx('বিবরণ')} style={{ minWidth: 320 }}>
              <Input maxLength={500} />
            </Form.Item>
          </Space>
          <Form.List name="lines" rules={[{ validator: async (_, v: Line[]) => { if (!v?.length) throw new Error(tx('অন্তত একটি লাইন দিন')) } }]}>
            {(fields, { add, remove }, { errors }) => (
              <>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="key"
                  dataSource={fields}
                  scroll={{ x: 760 }}
                  columns={[
                    {
                      title: tx('হিসাব'),
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'account_id']} rules={[required(tx('হিসাব নির্বাচন করুন'))]} style={{ margin: 0 }}>
                          <Select options={options} showSearch={{ filterOption: accountFilter }} style={{ minWidth: 260 }} placeholder={tx('হিসাব')} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: tx('ডেবিট'),
                      width: 150,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'debit']} style={{ margin: 0 }}>
                          <InputNumber min={0} precision={2} style={{ width: '100%' }} onChange={(v) => v && form.setFieldValue(['lines', f.name, 'credit'], null)} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: tx('ক্রেডিট'),
                      width: 150,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'credit']} style={{ margin: 0 }}>
                          <InputNumber min={0} precision={2} style={{ width: '100%' }} onChange={(v) => v && form.setFieldValue(['lines', f.name, 'debit'], null)} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: tx('মন্তব্য'),
                      width: 200,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'remarks']} style={{ margin: 0 }}>
                          <Input maxLength={255} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: '',
                      width: 48,
                      render: (_, f) => <Button type="text" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} disabled={fields.length <= 1} onClick={() => remove(f.name)} />,
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} align="right">
                        <b>{tx('মোট')}</b>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1}>
                        <b>{money(dr)}</b>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2}>
                        <b>{money(cr)}</b>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} colSpan={2}>
                        {diff === 0 ? (
                          <Typography.Text type="success">{tx('মিলেছে')}</Typography.Text>
                        ) : opening ? (
                          <Typography.Text type="secondary">{tx('সমন্বয়: {{p0}}', { p0: money(Math.abs(diff)) })}</Typography.Text>
                        ) : (
                          <Typography.Text type="danger">{tx('পার্থক্য: {{p0}}', { p0: money(Math.abs(diff)) })}</Typography.Text>
                        )}
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
                <Form.ErrorList errors={errors} />
                <Button icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({})}>
                  {tx('লাইন যোগ করুন')}
                </Button>
              </>
            )}
          </Form.List>
          <Space style={{ marginTop: 24 }}>
            <Button type="primary" onClick={save} disabled={!opening && diff !== 0}>
              {tx('অনুমোদনের জন্য পাঠান')}
            </Button>
            <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
          </Space>
        </Form>
      </Card>
    </>
  )
}
