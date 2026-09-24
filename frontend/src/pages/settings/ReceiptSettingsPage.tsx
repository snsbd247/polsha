import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, Form, Input, Radio, Row, Space, Spin, Switch } from 'antd'
import RelatedLinks from '../../components/RelatedLinks'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'

export default function ReceiptSettingsPage() {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/settings')).data,
  })

  useEffect(() => {
    if (data) form.setFieldsValue({ ...data, receipt_copies: Number(data.receipt_copies ?? 1) })
  }, [data, form])

  const save = async (v: Record<string, unknown>) => {
    setSaving(true)
    try {
      await api.put('/settings/receipt', v)
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
        <h2>{tx('রশিদ সেটিংস')}</h2>
        <Space wrap>
          <RelatedLinks links={[{ to: '/settings/branding', label: tx('ব্র্যান্ডিং ও লোগো') }, { to: '/payments/receipts', label: tx('রশিদ তালিকা') }]} />
        </Space>
      </div>
      <Form form={form} layout="vertical" onFinish={save}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title={tx('কাগজ ও কপি')}>
              <Form.Item name="receipt_paper" label={tx('কাগজের মাপ')} extra={tx('থার্মাল = ৮০মিমি রোল প্রিন্টার।')}>
                <Radio.Group
                  options={[
                    { value: 'a4', label: 'A4' },
                    { value: 'a5', label: 'A5' },
                    { value: 'thermal', label: tx('থার্মাল (৮০মিমি)') },
                  ]}
                />
              </Form.Item>
              <Form.Item name="receipt_copies" label={tx('কপি সংখ্যা')} extra={tx('২ কপি হলে একই পাতায় “অফিস কপি” ও “গ্রাহক কপি” ছাপা হবে।')}>
                <Radio.Group
                  options={[
                    { value: 1, label: tx('১ কপি') },
                    { value: 2, label: tx('২ কপি (অফিস + গ্রাহক)') },
                  ]}
                />
              </Form.Item>
              <Form.Item name="receipt_show_qr" label={tx('যাচাইয়ের QR কোড দেখাবে')} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="receipt_show_due" label={tx('রশিদে অবশিষ্ট বকেয়া দেখাবে')} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title={tx('স্বাক্ষর ও পাদটীকা')}>
              <Form.Item name="receipt_sign_left" label={tx('বাম পাশের স্বাক্ষরের লেখা')} rules={[required(tx('লেখা দিন'))]}>
                <Input maxLength={60} />
              </Form.Item>
              <Form.Item name="receipt_sign_right" label={tx('ডান পাশের স্বাক্ষরের লেখা')} rules={[required(tx('লেখা দিন'))]}>
                <Input maxLength={60} />
              </Form.Item>
              <Form.Item name="receipt_footer_note" label={tx('রশিদের পাদটীকা')} extra={tx('ফাঁকা রাখলে প্রতিটি রশিদের নিজস্ব লেখা থাকবে।')}>
                <Input.TextArea rows={2} maxLength={300} />
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
