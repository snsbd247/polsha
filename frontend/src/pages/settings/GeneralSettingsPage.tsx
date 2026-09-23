import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Radio, Row, Select, Spin, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { logoUrl } from '../../lib/settings'
import { required } from '../../lib/rules'

type Settings = Record<string, unknown> & { logo_url: string | null }

const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর']

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
      message.success('সেটিংস সংরক্ষণ হয়েছে।')
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
      message.success('লোগো আপলোড হয়েছে।')
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
        <h2>সাধারণ সেটিংস</h2>
      </div>
      <Form form={form} layout="vertical" onFinish={save}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Card title="সমিতির তথ্য">
              <Form.Item name="society_name_bn" label="সমিতির নাম (বাংলা)" rules={[required('নাম দিন')]}>
                <Input />
              </Form.Item>
              <Form.Item name="society_name_en" label="সমিতির নাম (ইংরেজি)">
                <Input />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="registration_no" label="নিবন্ধন নম্বর">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="registration_date" label="নিবন্ধনের তারিখ">
                    <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="address" label="ঠিকানা">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="phone" label="ফোন">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="email" label="ইমেইল" rules={[{ type: 'email', message: 'সঠিক ইমেইল দিন' }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="লোগো">
              {data?.logo_url && <img src={`${logoUrl()}?v=${encodeURIComponent(String(data.logo))}`} alt="লোগো" style={{ height: 72, display: 'block', marginBottom: 12 }} />}
              <Upload accept="image/png,image/jpeg" showUploadList={false} beforeUpload={uploadLogo}>
                <Button icon={<UploadOutlined />}>লোগো আপলোড (PNG/JPG, সর্বোচ্চ ৫০০KB)</Button>
              </Upload>
            </Card>
            <Card title="হিসাব ও প্রদর্শন" style={{ marginTop: 16 }}>
              <Form.Item name="fiscal_year_start_month" label="অর্থবছর শুরুর মাস" rules={[required('মাস দিন')]}>
                <Select options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
              </Form.Item>
              <Form.Item name="current_fiscal_year" label="চলতি অর্থবছর" rules={[{ pattern: /^\d{4}-\d{2}$/, message: 'যেমন 2026-27' }]}>
                <Input placeholder="2026-27" />
              </Form.Item>
              <Form.Item name="digits" label="সংখ্যা দেখাবে">
                <Radio.Group options={[{ value: 'bn', label: 'বাংলা (১২৩)' }, { value: 'en', label: 'ইংরেজি (123)' }]} />
              </Form.Item>
              <Form.Item name="currency_symbol" label="টাকার চিহ্ন" rules={[required('চিহ্ন দিন')]}>
                <Input style={{ width: 80 }} />
              </Form.Item>
            </Card>
            <Card title="সদস্যপদ" style={{ marginTop: 16 }}>
              <Form.Item name="admission_fee" label="নির্দিষ্ট ভর্তি ফি" extra="আবেদনের সময় স্বয়ংক্রিয়ভাবে বসবে; প্রয়োজনে কারণসহ বদলানো যাবে।">
                <InputNumber min={0} prefix="৳" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="voter_min_membership_months" label="ভোটার হতে ন্যূনতম সদস্যকাল (মাস)" extra="০ মানে সব সক্রিয় সদস্য ভোটার।">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
            <Card title="জমি" style={{ marginTop: 16 }}>
              <Form.Item name="bigha_decimal" label="১ বিঘা = কত শতক" extra="এলাকাভেদে আলাদা (সাধারণত ৩৩)। ১ কাঠা = বিঘার ২০ ভাগের ১ ভাগ।" rules={[required('মান দিন')]}>
                <InputNumber min={1} max={200} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" style={{ marginTop: 16 }}>
          সংরক্ষণ
        </Button>
      </Form>
    </>
  )
}
