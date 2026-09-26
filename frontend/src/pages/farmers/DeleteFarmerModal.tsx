import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { App, Form, Input, Modal, Select } from 'antd'
import { api, errorMessage } from '../../lib/api'
import { toOptions, useFarmerMeta } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Target = { id: number; farmer_code: string; name_bn: string; name_en: string | null }

/** Soft-delete a farmer with a coded reason; the record then shows on the Deleted Farmers page. */
export default function DeleteFarmerModal({ farmer, onClose, onDone }: { farmer: Target | null; onClose: () => void; onDone?: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (farmer) form.setFieldsValue({ reason_code: 'duplicate', reason: '' })
  }, [farmer, form])

  const submit = async () => {
    if (!farmer) return
    const v = await form.validateFields()
    setSaving(true)
    try {
      const r = await api.delete(`/farmers/${farmer.id}`, { data: v })
      message.success(r.data.message)
      queryClient.invalidateQueries({ queryKey: ['farmers'] })
      queryClient.invalidateQueries({ queryKey: ['farmers-deleted'] })
      onClose()
      onDone?.()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const reasons = toOptions(meta?.delete_reasons).filter((o) => o.value !== 'merged')

  return (
    <Modal
      open={!!farmer}
      forceRender
      title={farmer ? tx('কৃষক মুছুন: {{p0}} ({{p1}})', { p0: nameOf(farmer), p1: farmer.farmer_code }) : ''}
      okText={tx('মুছুন')}
      okButtonProps={{ danger: true }}
      cancelText={tx('বাতিল')}
      confirmLoading={saving}
      onOk={submit}
      onCancel={onClose}
    >
      <p style={{ color: '#6b7280', fontSize: 13 }}>{tx('মুছে ফেলা কৃষক "মুছে ফেলা কৃষক" পাতায় থাকবে এবং সেখান থেকে পুনরুদ্ধার করা যাবে।')}</p>
      <Form form={form} layout="vertical">
        <Form.Item name="reason_code" label={tx('মুছার কারণ')} rules={[{ required: true }]}>
          <Select options={reasons} />
        </Form.Item>
        <Form.Item name="reason" label={tx('মন্তব্য')}>
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
