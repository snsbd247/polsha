import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Table, Tag } from 'antd'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'

type Period = {
  id: number
  period_key: string
  fiscal_year: string
  start_date: string
  end_date: string
  status: 'open' | 'closed'
  closed_at: string | null
  closer: { name_bn: string; name_en: string | null } | null
  posted_count: number
  pending_count: number
}

export default function PeriodsPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [reopen, setReopen] = useState<Period | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({ queryKey: ['accounting-periods'], queryFn: async () => (await api.get<Period[]>('/accounting/periods')).data })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accounting-periods'] })

  const close = async (p: Period) => {
    try {
      await api.post(`/accounting/periods/${p.id}/close`)
      message.success(tx('মাস বন্ধ হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const submitReopen = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/accounting/periods/${reopen!.id}/reopen`, v)
      message.success(tx('মাস আবার খোলা হয়েছে।'))
      setReopen(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('হিসাবকাল (মাস বন্ধ)')}</h2>
      </div>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tx('মাস বন্ধ করলে ওই মাসের তারিখে আর কোনো লেনদেন বা সংশোধন করা যাবে না। প্রথম লেনদেনের সময় মাস স্বয়ংক্রিয়ভাবে খোলে।')} />
      <Table<Period>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 800 }}
        columns={[
          { title: tx('মাস'), dataIndex: 'period_key', width: 110, render: digits },
          { title: tx('অর্থবছর'), dataIndex: 'fiscal_year', width: 120, render: digits },
          { title: tx('সময়কাল'), render: (_, p) => `${fmtDate(p.start_date)} — ${fmtDate(p.end_date)}` },
          { title: tx('ভাউচার'), dataIndex: 'posted_count', width: 90, render: digits },
          { title: tx('অপেক্ষমাণ'), dataIndex: 'pending_count', width: 100, render: (n: number) => (n ? <Tag color="gold">{digits(n)}</Tag> : digits(0)) },
          {
            title: tx('অবস্থা'),
            render: (_, p) =>
              p.status === 'closed' ? (
                <>
                  <Tag color="red">{tx('বন্ধ')}</Tag>
                  <span style={{ fontSize: 12 }}>
                    {nameOf(p.closer)} · {fmtDateTime(p.closed_at)}
                  </span>
                </>
              ) : (
                <Tag color="green">{tx('খোলা')}</Tag>
              ),
          },
          {
            title: '',
            width: 130,
            render: (_, p) =>
              !can('accounting.approve') ? null : p.status === 'open' ? (
                <Popconfirm title={tx('{{p0}} মাস বন্ধ করবেন?', { p0: digits(p.period_key) })} okText={tx('হ্যাঁ')} cancelText={tx('না')} onConfirm={() => close(p)}>
                  <Button size="small" disabled={dayjs(p.end_date).isAfter(dayjs(), 'day') || dayjs(p.end_date).isSame(dayjs(), 'day')}>
                    {tx('মাস বন্ধ করুন')}
                  </Button>
                </Popconfirm>
              ) : (
                <Button size="small" danger onClick={() => { form.resetFields(); setReopen(p) }}>
                  {tx('আবার খুলুন')}
                </Button>
              ),
          },
        ]}
      />
      <Modal open={!!reopen} forceRender title={reopen ? tx('{{p0}} মাস আবার খুলুন', { p0: digits(reopen.period_key) }) : ''} onCancel={() => setReopen(null)} onOk={submitReopen} okText={tx('আবার খুলুন')} cancelText={tx('বাতিল')} okButtonProps={{ danger: true }}>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
