import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Radio, Row, Select, Spin, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { logoUrl } from '../../lib/settings'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'

type Settings = Record<string, unknown> & { logo_url: string | null }

const MONTHS = [tx('জানুয়ারি'), tx('ফেব্রুয়ারি'), tx('মার্চ'), tx('এপ্রিল'), tx('মে'), tx('জুন'), tx('জুলাই'), tx('আগস্ট'), tx('সেপ্টেম্বর'), tx('অক্টোবর'), tx('নভেম্বর'), tx('ডিসেম্বর')]

export default function GeneralSettingsPage() {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const queryClient = useQueryClient()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Settings>('/settings')).data,
  })

  useEffect(() => {
    if (data) form.setFieldsValue({ ...data, registration_date: data.registration_date ? dayjs(String(data.registration_date)) : null })
  }, [data, form])

  const save = async (v: Record<string, unknown>) => {
    try {
      await api.put('/settings', { ...v, registration_date: v.registration_date ? (v.registration_date as dayjs.Dayjs).format('YYYY-MM-DD') : null })
      message.success(tx('সেটিংস সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['public-settings'] })
      refetch()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const uploadLogo = async (file: File) => {
    const fd = new FormData()
    fd.append('logo', file)
    try {
      await api.post('/settings/logo', fd)
      message.success(tx('লোগো আপলোড হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['public-settings'] })
      refetch()
    } catch (e) {
      message.error(errorMessage(e))
    }
    return false
  }

  if (isLoading) return <Spin />

  return (
    <>
      <div className="page-header">
        <h2>{tx('সাধারণ সেটিংস')}</h2>
      </div>
      <Form form={form} layout="vertical" onFinish={save}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Card title={tx('সমিতির তথ্য')}>
              <Form.Item name="society_name_bn" label={tx('সমিতির নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
                <Input />
              </Form.Item>
              <Form.Item name="society_name_en" label={tx('সমিতির নাম (ইংরেজি)')}>
                <Input />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="registration_no" label={tx('নিবন্ধন নম্বর')}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="registration_date" label={tx('নিবন্ধনের তারিখ')}>
                    <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="address" label={tx('ঠিকানা')}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="phone" label={tx('ফোন')}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title={tx('লোগো')}>
              {data?.logo_url && <img src={`${logoUrl()}?v=${encodeURIComponent(String(data.logo))}`} alt={tx('লোগো')} style={{ height: 72, display: 'block', marginBottom: 12 }} />}
              <Upload accept="image/png,image/jpeg" showUploadList={false} beforeUpload={uploadLogo}>
                <Button icon={<UploadOutlined />}>{tx('লোগো আপলোড (PNG/JPG, সর্বোচ্চ ৫০০KB)')}</Button>
              </Upload>
            </Card>
            <Card title={tx('হিসাব ও প্রদর্শন')} style={{ marginTop: 16 }}>
              <Form.Item name="fiscal_year_start_month" label={tx('অর্থবছর শুরুর মাস')} rules={[required(tx('মাস দিন'))]}>
                <Select options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
              </Form.Item>
              <Form.Item name="current_fiscal_year" label={tx('চলতি অর্থবছর')} rules={[{ pattern: /^\d{4}-\d{2}$/, message: tx('যেমন 2026-27') }]}>
                <Input placeholder="2026-27" />
              </Form.Item>
              <Form.Item name="digits" label={tx('সংখ্যা দেখাবে')}>
                <Radio.Group options={[{ value: 'bn', label: tx('বাংলা (১২৩)') }, { value: 'en', label: tx('ইংরেজি (123)') }]} />
              </Form.Item>
              <Form.Item name="currency_symbol" label={tx('টাকার চিহ্ন')} rules={[required(tx('চিহ্ন দিন'))]}>
                <Input style={{ width: 80 }} />
              </Form.Item>
            </Card>
            <Card title={tx('সদস্যপদ')} style={{ marginTop: 16 }}>
              <Form.Item name="admission_fee" label={tx('নির্দিষ্ট ভর্তি ফি')} extra={tx('আবেদনের সময় স্বয়ংক্রিয়ভাবে বসবে; প্রয়োজনে কারণসহ বদলানো যাবে।')}>
                <InputNumber min={0} prefix={tx('৳')} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="voter_min_membership_months" label={tx('ভোটার হতে ন্যূনতম সদস্যকাল (মাস)')} extra={tx('০ মানে সব সক্রিয় সদস্য ভোটার।')}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
            <Card title={tx('জমি')} style={{ marginTop: 16 }}>
              <Form.Item name="bigha_decimal" label={tx('১ বিঘা = কত শতক')} extra={tx('এলাকাভেদে আলাদা (সাধারণত ৩৩)। ১ কাঠা = বিঘার ২০ ভাগের ১ ভাগ।')} rules={[required(tx('মান দিন'))]}>
                <InputNumber min={1} max={200} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
            <Card title={tx('ঋণ')} style={{ marginTop: 16 }}>
              <Form.Item name="loan_max_guarantees" label={tx('একজন সদস্য সর্বোচ্চ কতটি চলমান ঋণের জামিনদার হতে পারবেন')} rules={[required(tx('মান দিন'))]}>
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" style={{ marginTop: 16 }}>
          {tx('সংরক্ষণ')}
        </Button>
      </Form>
    </>
  )
}
