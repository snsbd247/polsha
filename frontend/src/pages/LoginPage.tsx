import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Checkbox, Form, Input, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../lib/api'
import { logoUrl, usePublicSettings } from '../lib/settings'

type Values = { username: string; password: string; remember: boolean }

export default function LoginPage() {
  const { user, login } = useAuth()
  const { data: settings } = usePublicSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={user.must_change_password ? '/change-password' : '/'} replace />

  const onFinish = async (v: Values) => {
    setError(null)
    setSubmitting(true)
    try {
      const u = await login(v.username, v.password, v.remember)
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(u.must_change_password ? '/change-password' : from, { replace: true })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {settings?.logo && <img src={logoUrl()} alt="" style={{ height: 64, marginBottom: 8 }} />}
          <Typography.Title level={4} style={{ margin: 0 }}>
            {settings?.society_name_bn ?? 'সমবায় ERP'}
          </Typography.Title>
          <Typography.Text type="secondary">আপনার অ্যাকাউন্টে লগইন করুন</Typography.Text>
        </div>
        {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} initialValues={{ remember: false }} requiredMark={false}>
          <Form.Item name="username" label="ইউজারনেম বা মোবাইল" rules={[{ required: true, message: 'ইউজারনেম বা মোবাইল দিন' }]}>
            <Input prefix={<UserOutlined />} autoFocus autoComplete="username" size="large" />
          </Form.Item>
          <Form.Item name="password" label="পাসওয়ার্ড" rules={[{ required: true, message: 'পাসওয়ার্ড দিন' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>
          <Form.Item name="remember" valuePropName="checked">
            <Checkbox>আমাকে মনে রাখো</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            লগইন
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 13, textAlign: 'center' }}>
          পাসওয়ার্ড ভুলে গেলে অ্যাডমিনের সাথে যোগাযোগ করুন।
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
