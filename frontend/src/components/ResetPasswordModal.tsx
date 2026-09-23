import { App, Form, Input, Modal } from 'antd'
import { api, applyFormErrors, errorMessage } from '../lib/api'
import { passwordRules } from '../lib/rules'
import { t as tx } from '../lib/i18n'

export default function ResetPasswordModal({ user, onClose }: { user: { id: number; name_bn: string } | null; onClose: () => void }) {
  const [form] = Form.useForm()
  const { message } = App.useApp()

  const submit = async () => {
    const values = await form.validateFields()
    try {
      const r = await api.post(`/users/${user!.id}/reset-password`, values)
      message.success(r.data.message)
      form.resetFields()
      onClose()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <Modal open={!!user} title={tx('পাসওয়ার্ড রিসেট — {{p0}}', { p0: user?.name_bn ?? '' })} onCancel={onClose} onOk={submit} okText={tx('রিসেট')} cancelText={tx('বাতিল')} destroyOnHidden>
      <p>{tx('ইউজার পরবর্তী লগইনে নিজের পাসওয়ার্ড দিতে বাধ্য হবেন এবং সব ডিভাইস থেকে লগআউট হয়ে যাবেন।')}</p>
      <Form form={form} layout="vertical">
        <Form.Item name="password" label={tx('অস্থায়ী পাসওয়ার্ড')} rules={passwordRules}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
