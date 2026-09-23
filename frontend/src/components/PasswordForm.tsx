import { Button, Form, Input, App } from 'antd'
import { api, applyFormErrors, errorMessage } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import type { AuthUser } from '../lib/types'
import { passwordRules } from '../lib/rules'
import { t as tx } from '../lib/i18n'

export default function PasswordForm({ onDone }: { onDone?: () => void }) {
  const [form] = Form.useForm()
  const { setUser } = useAuth()
  const { message } = App.useApp()

  const onFinish = async (values: Record<string, string>) => {
    try {
      const r = await api.post<{ message: string; user: AuthUser }>('/me/password', values)
      message.success(r.data.message)
      setUser(r.data.user)
      form.resetFields()
      onDone?.()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} style={{ maxWidth: 400 }}>
      <Form.Item name="current_password" label={tx('বর্তমান পাসওয়ার্ড')} rules={[{ required: true, message: tx('বর্তমান পাসওয়ার্ড দিন') }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Form.Item name="password" label={tx('নতুন পাসওয়ার্ড')} rules={passwordRules} hasFeedback>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="password_confirmation"
        label={tx('নতুন পাসওয়ার্ড আবার')}
        dependencies={['password']}
        hasFeedback
        rules={[
          { required: true, message: tx('আবার লিখুন') },
          ({ getFieldValue }) => ({
            validator: (_, v) => (!v || getFieldValue('password') === v ? Promise.resolve() : Promise.reject(new Error(tx('দুটি পাসওয়ার্ড মেলেনি')))),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit">
        {tx('পাসওয়ার্ড বদলান')}
      </Button>
    </Form>
  )
}
