import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { Alert, App, Button, Card, Col, DatePicker, Form, Popconfirm, Row, Statistic, Table } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { monthLabel } from '../../lib/water'
import PageFrame from '../../components/PageFrame'

type Row = { id: number; connection_no: string; name_bn: string; name_en: string | null; type: string | null; type_en: string | null; fee: number }
type Preview = { period: string; count: number; total: number; already_billed: number; rows: Row[]; no_fee: Row[] }
type Values = { period: Dayjs; bill_date: Dayjs; due_date?: Dayjs }

/** Every active connection's fixed monthly bill for one month, in one go. */
export default function BillingPage() {
  const [form] = Form.useForm<Values>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const periodValue = Form.useWatch('period', form)
  const period = periodValue?.format('YYYY-MM')

  const { data: preview, isFetching } = useQuery({
    queryKey: ['water', 'billing-preview', period],
    queryFn: async () => (await api.get<Preview>('/water/billing/preview', { params: { period } })).data,
    enabled: !!period,
  })

  const generate = async (v: Values) => {
    setBusy(true)
    try {
      const r = await api.post<{ count: number; total: number }>('/water/billing', {
        period: v.period.format('YYYY-MM'),
        bill_date: v.bill_date.format('YYYY-MM-DD'),
        due_date: v.due_date?.format('YYYY-MM-DD'),
      })
      message.success(tx('{{p0}}টি বিল তৈরি হয়েছে — মোট ৳{{p1}}', { p0: digits(r.data.count), p1: money(r.data.total) }))
      queryClient.invalidateQueries({ queryKey: ['water'] })
      navigate(`/water/bills?period=${v.period.format('YYYY-MM')}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('মাসিক বিল তৈরি') }]}
      title={tx('মাসিক বিল তৈরি')}
      subtitle={tx('মাস বাছাই করলে কারা বিল পাবেন তা আগে দেখায়; চালু সব সংযোগের বিল একসাথে তৈরি হয় ও হিসাবের খাতায় ওঠে।')}
    >
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" onFinish={generate} initialValues={{ period: dayjs(), bill_date: dayjs() }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="period" label={tx('কোন মাসের বিল')} rules={[{ required: true }]}>
                <DatePicker picker="month" format={(d) => monthLabel(d.format('YYYY-MM'))} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs().add(1, 'month'), 'month')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="bill_date" label={tx('বিলের তারিখ')} rules={[{ required: true }]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="due_date" label={tx('পরিশোধের শেষ তারিখ (ঐচ্ছিক)')}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {preview && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={8}>
              <Card size="small">
                <Statistic title={tx('বিল হবে')} value={tx('{{p0}}টি সংযোগ', { p0: digits(preview.count) })} />
              </Card>
            </Col>
            <Col xs={12} md={8}>
              <Card size="small">
                <Statistic title={tx('মোট টাকা')} value={money(preview.total)} prefix="৳" />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small">
                <Statistic title={tx('এই মাসের বিল আগেই হয়েছে')} value={tx('{{p0}}টি', { p0: digits(preview.already_billed) })} />
              </Card>
            </Col>
          </Row>
          {preview.no_fee.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title={tx('{{p0}}টি সংযোগের মাসিক ফি ঠিক করা নেই — এগুলোর বিল হবে না।', { p0: digits(preview.no_fee.length) })}
              description={
                <>
                  {preview.no_fee.map((r) => `${digits(r.connection_no)} ${nameOf(r)}`).join(', ')} —{' '}
                  <Link to="/water/types">{tx('সংযোগের ধরন ও ফি ঠিক করুন')}</Link>
                </>
              }
            />
          )}
          <Table<Row>
            rowKey="id"
            size="small"
            loading={isFetching}
            dataSource={preview.rows}
            pagination={{ pageSize: 50 }}
            columns={[
              { title: '#', width: 60, render: (_, __, i) => digits(i + 1) },
              { title: tx('সংযোগ নং'), dataIndex: 'connection_no', width: 130, render: (v: string) => digits(v) },
              { title: tx('গ্রাহক'), render: (_, r) => nameOf(r) },
              { title: tx('ধরন'), render: (_, r) => nameOf({ name_bn: r.type, name_en: r.type_en }) },
              { title: tx('বিল'), dataIndex: 'fee', width: 120, align: 'right', render: money },
            ]}
          />
          {can('water.create') && (
            <Popconfirm
              title={tx('{{p0}}-এর {{p1}}টি বিল তৈরি করবেন?', { p0: monthLabel(preview.period), p1: digits(preview.count) })}
              description={tx('বিল তৈরির সাথে সাথে হিসাবের খাতায় ওঠে; ভুল হলে বিল বাতিলের অনুরোধ করতে হবে।')}
              onConfirm={() => form.submit()}
              disabled={!preview.count}
            >
              <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={busy} disabled={!preview.count} style={{ marginTop: 16 }}>
                {tx('বিল তৈরি করুন')}
              </Button>
            </Popconfirm>
          )}
        </>
      )}
    </PageFrame>
  )
}
