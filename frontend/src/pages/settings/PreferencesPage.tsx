import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, DatePicker, Form, InputNumber, Radio, Row, Select, Space, Spin } from 'antd'
import dayjs from 'dayjs'
import RelatedLinks from '../../components/RelatedLinks'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { t as tx } from '../../lib/i18n'

export default function PreferencesPage() {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/settings')).data,
  })

  useEffect(() => {
    if (data)
      form.setFieldsValue({
        default_locale: data.default_locale ?? 'bn',
        page_size: Number(data.page_size ?? 25),
        idle_logout_minutes: Number(data.idle_logout_minutes ?? 0),
        go_live_date: data.go_live_date ? dayjs(String(data.go_live_date)) : null,
      })
  }, [data, form])

  const save = async (v: Record<string, unknown>) => {
    setSaving(true)
    try {
      await api.put('/settings/preferences', { ...v, go_live_date: v.go_live_date ? (v.go_live_date as dayjs.Dayjs).format('YYYY-MM-DD') : null })
      message.success(tx('সেটিংস সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['public-settings'] })
      refetch()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <Spin />

  return (
    <>
      <div className="page-header">
        <h2>{tx('সিস্টেম পছন্দসমূহ')}</h2>
        <Space wrap>
          <RelatedLinks links={[{ to: '/settings/general', label: tx('সাধারণ সেটিংস (সংখ্যা ও টাকা)') }]} />
        </Space>
      </div>
      <Form form={form} layout="vertical" onFinish={save}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title={tx('প্রদর্শন')}>
              <Form.Item name="default_locale" label={tx('ডিফল্ট ভাষা')} extra={tx('নতুন কম্পিউটার/মোবাইলে প্রথমবার এই ভাষায় খুলবে; প্রত্যেকে নিজে বদলাতে পারবেন।')}>
                <Radio.Group
                  options={[
                    { value: 'bn', label: 'বাংলা' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="page_size" label={tx('প্রতি পাতায় সারি')} extra={tx('তালিকার পাতায় একবারে কতটি সারি দেখাবে।')}>
                <Select style={{ width: 160 }} options={[10, 25, 50, 100].map((n) => ({ value: n, label: n }))} />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title={tx('নিরাপত্তা ও চালু')}>
              <Form.Item name="idle_logout_minutes" label={tx('নিষ্ক্রিয় থাকলে স্বয়ংক্রিয় লগআউট (মিনিট)')} extra={tx('০ মানে বন্ধ। শেয়ার করা কম্পিউটারে ১৫–৩০ মিনিট রাখা ভালো।')}>
                <InputNumber min={0} max={480} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="go_live_date" label={tx('চালু (Go-Live) তারিখ')} extra={tx('এই তারিখ থেকে নতুন সিস্টেমে লেনদেন শুরু; আগের জের প্রারম্ভিক ইমপোর্টে আসবে।')}>
                <DatePicker format="DD/MM/YYYY" style={{ width: 200 }} />
              </Form.Item>
            </Card>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" loading={saving} style={{ marginTop: 16 }}>
          {tx('সংরক্ষণ')}
        </Button>
      </Form>
    </>
  )
}
