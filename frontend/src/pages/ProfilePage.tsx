import { App, Button, Card, Col, Form, Input, Popconfirm, Row } from 'antd'
import { useAuth } from '../auth/AuthContext'
import PasswordForm from '../components/PasswordForm'
import { api, applyFormErrors, errorMessage } from '../lib/api'
import type { AuthUser } from '../lib/types'
import { digits } from '../lib/format'
import { t as tx } from '../lib/i18n'

export default function ProfilePage() {
  const { user, setUser, logout } = useAuth()
  const [form] = Form.useForm()
  const { message } = App.useApp()

  const save = async (values: Record<string, string>) => {
    try {
      const r = await api.post<{ user: AuthUser }>('/me', values)
      setUser(r.data.user)
      message.success(tx('সংরক্ষণ হয়েছে।'))
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const logoutAll = async () => {
    try {
      await api.post('/me/logout-all')
    } finally {
      await logout()
    }
  }

  if (!user) return null

  return (
    <>
      <div className="page-header">
        <h2>{tx('আমার প্রোফাইল')}</h2>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={tx('তথ্য')}>
            <Form form={form} layout="vertical" initialValues={user} onFinish={save}>
              <Form.Item label={tx('ইউজারনেম')}>
                <Input value={user.username} disabled />
              </Form.Item>
              <Form.Item label={tx('মোবাইল')}>
                <Input value={digits(user.mobile)} disabled />
              </Form.Item>
              <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[{ required: true, message: tx('নাম দিন') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
                <Input />
              </Form.Item>
              <Form.Item name="email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
                <Input />
              </Form.Item>
              <Button type="primary" htmlType="submit">
                {tx('সংরক্ষণ')}
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={tx('পাসওয়ার্ড বদলান')}>
            <PasswordForm />
          </Card>
          <Card title={tx('নিরাপত্তা')} style={{ marginTop: 16 }}>
            <Popconfirm title={tx('সব ডিভাইস থেকে লগআউট করবেন?')} onConfirm={logoutAll} okText={tx('হ্যাঁ')} cancelText={tx('না')}>
              <Button danger>{tx('সব ডিভাইস থেকে লগআউট')}</Button>
            </Popconfirm>
          </Card>
        </Col>
      </Row>
    </>
  )
}
