import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Form, Input, InputNumber, Radio, Space, Switch, Tag } from 'antd'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { t as tx } from '../../lib/i18n'

type SmsSettings = {
  sms_enabled: boolean
  sms_gateway_url: string | null
  sms_http_method: 'GET' | 'POST'
  sms_sender_id: string | null
  sms_success_text: string | null
  sms_auto_payment: boolean
  sms_auto_savings: boolean
  sms_reminders: boolean
  sms_reminder_days: number
  sms_api_key_set: boolean
  configured: boolean
}

/** Generic HTTP SMS gateway. The API key is write-only: the browser only learns whether one is saved. */
export default function SmsSettingsPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [testMobile, setTestMobile] = useState('')
  const [testing, setTesting] = useState(false)
  const { data } = useQuery({
    queryKey: ['sms-settings'],
    queryFn: async () => (await api.get<SmsSettings>('/sms/settings')).data,
  })
  useEffect(() => {
    if (data) form.setFieldsValue({ ...data, sms_api_key: '', clear_api_key: false })
  }, [data, form])

  const save = async (v: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = (await api.put<SmsSettings>('/sms/settings', v)).data
      queryClient.setQueryData(['sms-settings'], res)
      message.success(tx('সংরক্ষণ হয়েছে।'))
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const test = async () => {
    setTesting(true)
    try {
      const log = (await api.post<{ status: string; response: string | null }>('/sms/test', { mobile: testMobile })).data
      if (log.status === 'sent') message.success(tx('পরীক্ষামূলক এসএমএস পাঠানো হয়েছে।'))
      else if (log.status === 'logged') message.info(tx('এসএমএস বন্ধ/কনফিগার করা নেই — শুধু লগে রাখা হয়েছে।'))
      else message.error(tx('পাঠানো যায়নি: {{r}}', { r: log.response ?? '' }))
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('SMS সেটিংস')}</h2>
        <Space>
          <Link to="/settings/sms-templates">{tx('SMS টেমপ্লেট')}</Link>
          <Link to="/settings/sms-logs">{tx('SMS লগ')}</Link>
        </Space>
      </div>
      {data && !data.configured && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={tx('এসএমএস এখনো চালু/কনফিগার করা হয়নি। বার্তাগুলো শুধু লগে জমা থাকবে।')} />
      )}
      <Form form={form} layout="vertical" onFinish={save} style={{ maxWidth: 720 }}>
        <Card size="small" title={tx('গেটওয়ে')} style={{ marginBottom: 16 }}>
          <Form.Item name="sms_enabled" label={tx('এসএমএস চালু')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="sms_gateway_url"
            label={tx('গেটওয়ে URL')}
            extra={tx('URL-এ {api_key}, {sender_id}, {mobile} (01…), {mobile88} (8801…) ও {message} লিখুন — পাঠানোর সময় আসল মান বসবে। POST হলে URL-এর প্যারামিটারগুলো ফর্ম বডি হিসেবে যাবে।')}
          >
            <Input placeholder="https://sms.example.com/api/send?api_key={api_key}&senderid={sender_id}&number={mobile88}&message={message}" />
          </Form.Item>
          <Form.Item name="sms_http_method" label={tx('পদ্ধতি')}>
            <Radio.Group options={['GET', 'POST']} />
          </Form.Item>
          <Form.Item
            name="sms_api_key"
            label={
              <>
                {tx('API কী')}&nbsp;{data?.sms_api_key_set ? <Tag color="green">{tx('সংরক্ষিত আছে')}</Tag> : <Tag>{tx('নেই')}</Tag>}
              </>
            }
            extra={tx('খালি রাখলে আগের কী-ই থাকবে। কী কখনো ব্রাউজারে দেখানো হয় না।')}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          {data?.sms_api_key_set && (
            <Form.Item name="clear_api_key" valuePropName="checked">
              <Checkbox>{tx('সংরক্ষিত কী মুছে ফেলুন')}</Checkbox>
            </Form.Item>
          )}
          <Form.Item name="sms_sender_id" label={tx('সেন্ডার আইডি')}>
            <Input maxLength={30} />
          </Form.Item>
          <Form.Item name="sms_success_text" label={tx('সফলতার চিহ্ন')} extra={tx('গেটওয়ের উত্তরে এই লেখা থাকলে সফল ধরা হবে। খালি রাখলে HTTP 2xx মানেই সফল।')}>
            <Input maxLength={100} />
          </Form.Item>
        </Card>
        <Card size="small" title={tx('স্বয়ংক্রিয় এসএমএস')} style={{ marginBottom: 16 }}>
          <Form.Item name="sms_auto_payment" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>{tx('টাকা জমার রশিদ হলে কৃষককে এসএমএস')}</Checkbox>
          </Form.Item>
          <Form.Item name="sms_auto_savings" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>{tx('সঞ্চয় জমা/উত্তোলনে এসএমএস')}</Checkbox>
          </Form.Item>
          <Form.Item name="sms_reminders" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>{tx('কিস্তির তারিখের আগে রিমাইন্ডার')}</Checkbox>
          </Form.Item>
          <Form.Item name="sms_reminder_days" label={tx('কত দিন আগে রিমাইন্ডার')}>
            <InputNumber min={0} max={30} />
          </Form.Item>
        </Card>
        <Button type="primary" htmlType="submit" loading={saving}>
          {tx('সংরক্ষণ')}
        </Button>
      </Form>

      <Card size="small" title={tx('পরীক্ষামূলক এসএমএস')} style={{ maxWidth: 720, marginTop: 24 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input placeholder={tx('মোবাইল নম্বর')} value={testMobile} onChange={(e) => setTestMobile(e.target.value)} maxLength={14} />
          <Button onClick={test} loading={testing} disabled={!testMobile}>
            {tx('পাঠান')}
          </Button>
        </Space.Compact>
      </Card>
    </>
  )
}
