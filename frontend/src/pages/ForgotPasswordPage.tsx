import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Alert, App, Button, Card, Form, Input, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../lib/api'
import { t as tx } from '../lib/i18n'
import LanguageToggle from '../components/LanguageToggle'

/** Two steps: ask for an SMS code (same answer whether or not the account exists), then set a new password with it. */
export default function ForgotPasswordPage() {
  const { user } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [login, setLogin] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const requestCode = async (v: { login: string }) => {
    setError(null)
    setBusy(true)
    try {
      const r = (await api.post<{ message: string }>('/auth/forgot-password', v)).data
      setLogin(v.login)
      setInfo(r.message)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const reset = async (v: { code: string; password: string; password_confirmation: string }) => {
    setError(null)
    setBusy(true)
    try {
      const r = (await api.post<{ message: string }>('/auth/reset-password', { ...v, login })).data
      message.success(r.message)
      navigate('/login', { replace: true })
    } catch (e) {
      if (!applyFormErrors(form, e)) setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <LanguageToggle />
        </div>
        <Typography.Title level={4} style={{ textAlign: 'center' }}>
          {tx('পাসওয়ার্ড রিসেট')}
        </Typography.Title>
        {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} />}
        {login === null ? (
          <Form layout="vertical" onFinish={requestCode} requiredMark={false}>
            <Typography.Paragraph type="secondary">{tx('অ্যাকাউন্টে নিবন্ধিত মোবাইলে একটি কোড পাঠানো হবে।')}</Typography.Paragraph>
            <Form.Item name="login" label={tx('ইউজারনেম বা মোবাইল')} rules={[{ required: true, message: tx('ইউজারনেম বা মোবাইল দিন') }]}>
              <Input prefix={<UserOutlined />} autoFocus autoComplete="username" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={busy}>
              {tx('কোড পাঠান')}
            </Button>
          </Form>
        ) : (
          <Form form={form} layout="vertical" onFinish={reset} requiredMark={false}>
            {info && <Alert type="info" showIcon title={info} style={{ marginBottom: 16 }} />}
            <Form.Item name="code" label={tx('কোড')} rules={[{ required: true, message: tx('কোড দিন') }]}>
              <Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={10} size="large" />
            </Form.Item>
            <Form.Item
              name="password"
              label={tx('নতুন পাসওয়ার্ড')}
              rules={[
                { required: true, message: tx('পাসওয়ার্ড দিন') },
                { min: 8, message: tx('অন্তত ৮ অক্ষর') },
                { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: tx('অক্ষর ও সংখ্যা দুটোই থাকতে হবে') },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" size="large" />
            </Form.Item>
            <Form.Item
              name="password_confirmation"
              label={tx('আবার লিখুন')}
              dependencies={['password']}
              rules={[
                { required: true, message: tx('পাসওয়ার্ড আবার দিন') },
                ({ getFieldValue }) => ({
                  validator: (_, v) => (!v || v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error(tx('দুটি পাসওয়ার্ড মেলেনি')))),
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={busy}>
              {tx('পাসওয়ার্ড বদলান')}
            </Button>
            <Button type="link" block onClick={() => setLogin(null)}>
              {tx('কোড পাইনি — আবার চেষ্টা করুন')}
            </Button>
          </Form>
        )}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link to="/login">{tx('লগইনে ফিরে যান')}</Link>
        </div>
      </Card>
    </div>
  )
}
