import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, InputNumber, Radio, Result, Spin, Tabs, Tag, Typography } from 'antd'
import { api, applyFormErrors, errorMessage } from '../lib/api'
import { money } from '../lib/accounting'
import { digits, fmtDate, toEnDigits } from '../lib/format'
import { logoUrl, usePublicSettings } from '../lib/settings'
import { nameOf, t as tx } from '../lib/i18n'
import LanguageToggle from '../components/LanguageToggle'

type Info = {
  enabled: boolean
  methods: { method: string; number: string }[]
  note: string | null
  society_name_bn: string
  society_name_en: string
  methods_labels: Record<string, string>
}
type FarmerHit = { farmer_code: string; name_bn: string; name_en: string | null }
type Status = {
  request_no: string
  status: string
  status_label: string
  amount: string
  trx_id: string
  paid_on: string
  receipt_no: string | null
  reject_reason: string | null
}

const STATUS_COLOR: Record<string, string> = { pending: 'gold', verified: 'green', rejected: 'red' }

function SubmitForm({ info }: { info: Info }) {
  const [form] = Form.useForm()
  const [farmer, setFarmer] = useState<FarmerHit | null>(null)
  const [farmerError, setFarmerError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ request_no: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const method = Form.useWatch('method', form) as string | undefined
  const target = info.methods.find((m) => m.method === method)

  const lookup = async () => {
    const code = toEnDigits(String(form.getFieldValue('farmer_code') ?? '')).trim()
    setFarmer(null)
    setFarmerError(null)
    if (!code) return
    setChecking(true)
    try {
      setFarmer((await api.get<FarmerHit>('/public/payments/farmer', { params: { code } })).data)
    } catch (e) {
      setFarmerError(errorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  const submit = async (v: Record<string, unknown> & { paid_on: Dayjs }) => {
    setError(null)
    setSubmitting(true)
    try {
      setDone((await api.post('/public/payments', { ...v, paid_on: v.paid_on.format('YYYY-MM-DD') })).data)
    } catch (e) {
      if (!applyFormErrors(form, e)) setError(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (done)
    return (
      <Result
        status="success"
        title={tx('অনুরোধ নং: {{no}}', { no: digits(done.request_no) })}
        subTitle={
          <>
            {done.message}
            <br />
            {tx('এই নম্বরটি লিখে রাখুন — অবস্থা জানতে লাগবে।')}
          </>
        }
        extra={
          <Button
            onClick={() => {
              setDone(null)
              setFarmer(null)
              form.resetFields()
            }}
          >
            {tx('আরেকটি জমা দিন')}
          </Button>
        }
      />
    )

  return (
    <Form form={form} layout="vertical" onFinish={submit} initialValues={{ method: info.methods[0]?.method, paid_on: dayjs() }} requiredMark={false}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={tx('প্রথমে নিচের নম্বরে "Send Money" করুন, তারপর লেনদেনের তথ্য দিয়ে এই ফর্মটি জমা দিন। ক্যাশিয়ার যাচাই করলে রশিদ তৈরি হবে।')}
        description={info.note || undefined}
      />
      <Form.Item name="method" label={tx('পেমেন্ট মাধ্যম')} rules={[{ required: true }]}>
        <Radio.Group optionType="button" buttonStyle="solid" options={info.methods.map((m) => ({ value: m.method, label: info.methods_labels[m.method] ?? m.method }))} />
      </Form.Item>
      {target && (
        <Alert
          type="success"
          style={{ marginBottom: 16 }}
          title={
            <>
              {tx('সমিতির {{m}} নম্বর', { m: info.methods_labels[target.method] ?? target.method })}: <b style={{ fontSize: 18 }}>{digits(target.number)}</b>
            </>
          }
        />
      )}
      <Form.Item
        name="farmer_code"
        label={tx('কৃষক আইডি')}
        rules={[{ required: true, message: tx('কৃষক আইডি দিন') }]}
        validateStatus={farmerError ? 'error' : undefined}
        help={farmerError ?? (farmer ? `✓ ${nameOf(farmer)}` : undefined)}
      >
        <Input.Search enterButton={tx('যাচাই')} loading={checking} onSearch={lookup} onBlur={lookup} maxLength={30} />
      </Form.Item>
      <Form.Item name="payer_name" label={tx('প্রদানকারীর নাম')} rules={[{ required: true, message: tx('নাম দিন') }]}>
        <Input maxLength={150} />
      </Form.Item>
      <Form.Item name="mobile" label={tx('আপনার মোবাইল (SMS পাবেন)')} rules={[{ required: true, message: tx('মোবাইল নম্বর দিন') }]}>
        <Input inputMode="tel" maxLength={14} />
      </Form.Item>
      <Form.Item name="sender_number" label={tx('যে নম্বর থেকে টাকা পাঠিয়েছেন')} rules={[{ required: true, message: tx('নম্বর দিন') }]}>
        <Input inputMode="tel" maxLength={14} />
      </Form.Item>
      <Form.Item
        name="trx_id"
        label={tx('ট্রানজ্যাকশন আইডি (TrxID)')}
        rules={[
          { required: true, message: tx('TrxID দিন') },
          { pattern: /^[A-Za-z0-9]{6,40}$/, message: tx('শুধু ইংরেজি অক্ষর ও সংখ্যা, অন্তত ৬টি') },
        ]}
      >
        <Input maxLength={40} style={{ textTransform: 'uppercase' }} />
      </Form.Item>
      <Form.Item name="amount" label={tx('টাকার পরিমাণ')} rules={[{ required: true, message: tx('টাকার পরিমাণ দিন') }]}>
        <InputNumber min={1} max={10000000} style={{ width: '100%' }} prefix="৳" />
      </Form.Item>
      <Form.Item name="paid_on" label={tx('পাঠানোর তারিখ')} rules={[{ required: true }]}>
        <DatePicker
          format="DD/MM/YYYY"
          style={{ width: '100%' }}
          disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(dayjs().subtract(59, 'day'), 'day')}
        />
      </Form.Item>
      <Form.Item name="note" label={tx('মন্তব্য (কোন বাবদ, যেমন সেচ/ঋণ)')}>
        <Input.TextArea rows={2} maxLength={300} />
      </Form.Item>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
        {tx('জমা দিন')}
      </Button>
    </Form>
  )
}

function StatusCheck() {
  const [result, setResult] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const check = async (v: { request_no: string; mobile: string }) => {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      setResult((await api.get<Status>('/public/payments/status', { params: v })).data)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Form layout="vertical" onFinish={check} requiredMark={false}>
        <Form.Item name="request_no" label={tx('অনুরোধ নং')} rules={[{ required: true, message: tx('অনুরোধ নং দিন') }]}>
          <Input maxLength={30} />
        </Form.Item>
        <Form.Item name="mobile" label={tx('জমা দেওয়ার সময়ের মোবাইল')} rules={[{ required: true, message: tx('মোবাইল নম্বর দিন') }]}>
          <Input inputMode="tel" maxLength={14} />
        </Form.Item>
        <Button htmlType="submit" block loading={loading}>
          {tx('অবস্থা দেখুন')}
        </Button>
      </Form>
      {error && <Alert type="error" showIcon title={error} style={{ marginTop: 16 }} />}
      {result && (
        <Descriptions bordered size="small" column={1} style={{ marginTop: 16 }}>
          <Descriptions.Item label={tx('অনুরোধ নং')}>{digits(result.request_no)}</Descriptions.Item>
          <Descriptions.Item label={tx('অবস্থা')}>
            <Tag color={STATUS_COLOR[result.status]}>{result.status_label}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={tx('টাকা')}>৳ {money(result.amount)}</Descriptions.Item>
          <Descriptions.Item label="TrxID">{result.trx_id}</Descriptions.Item>
          <Descriptions.Item label={tx('তারিখ')}>{fmtDate(result.paid_on)}</Descriptions.Item>
          {result.receipt_no && <Descriptions.Item label={tx('রশিদ নং')}>{digits(result.receipt_no)}</Descriptions.Item>}
          {result.reject_reason && <Descriptions.Item label={tx('বাতিলের কারণ')}>{result.reject_reason}</Descriptions.Item>}
        </Descriptions>
      )}
    </>
  )
}

/** Public (no login) page: farmers report a bKash/Nagad payment for cashier verification, and check its status. */
export default function PublicPaymentPage() {
  const { data: settings } = usePublicSettings()
  const { data: info, isLoading, error } = useQuery({
    queryKey: ['public-payment-info'],
    queryFn: async () => (await api.get<Info>('/public/payment-info')).data,
  })

  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 520, alignSelf: 'flex-start' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Link to="/login">{tx('লগইন')}</Link>
          <LanguageToggle />
        </div>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          {settings?.logo && <img src={logoUrl()} alt="" style={{ height: 56, marginBottom: 8 }} />}
          <Typography.Title level={4} style={{ margin: 0 }}>
            {nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }) || tx('সমবায় ERP')}
          </Typography.Title>
          <Typography.Text type="secondary">{tx('অনলাইন পেমেন্ট জমা')}</Typography.Text>
        </div>
        {isLoading ? (
          <Spin />
        ) : error || !info ? (
          <Alert type="error" showIcon title={errorMessage(error)} />
        ) : (
          <Tabs
            items={[
              {
                key: 'submit',
                label: tx('পেমেন্টের তথ্য দিন'),
                children: info.enabled ? <SubmitForm info={info} /> : <Alert type="warning" showIcon title={tx('অনলাইন পেমেন্ট জমা এখন বন্ধ আছে।')} />,
              },
              { key: 'status', label: tx('অবস্থা জানুন'), children: <StatusCheck /> },
            ]}
          />
        )}
      </Card>
    </div>
  )
}
