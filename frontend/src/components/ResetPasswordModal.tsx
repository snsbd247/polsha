import { App, Form, Input, Modal } from 'antd'
import { api, applyFormErrors, errorMessage } from '../lib/api'
import { passwordRules } from '../lib/rules'

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
    <Modal open={!!user} title={`পাসওয়ার্ড রিসেট — ${user?.name_bn ?? ''}`} onCancel={onClose} onOk={submit} okText="রিসেট" cancelText="বাতিল" destroyOnHidden>
      <p>ইউজার পরবর্তী লগইনে নিজের পাসওয়ার্ড দিতে বাধ্য হবেন এবং সব ডিভাইস থেকে লগআউট হয়ে যাবেন।</p>
      <Form form={form} layout="vertical">
        <Form.Item name="password" label="অস্থায়ী পাসওয়ার্ড" rules={passwordRules}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
