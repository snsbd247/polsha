import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Form, Input, Modal, Space, Switch, Table, Tag } from 'antd'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import SettingsShell from './SettingsShell'

type Template = { id: number; key: string; name_bn: string; name_en: string | null; body: string; variables: string[]; is_active: boolean }
type Preview = { text: string; length: number; parts: number }

function EditModal({ tpl, onClose }: { tpl: Template | null; onClose: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const body = Form.useWatch('body', form) as string | undefined

  useEffect(() => {
    if (tpl) form.setFieldsValue({ body: tpl.body, name_en: tpl.name_en, is_active: tpl.is_active })
  }, [tpl, form])

  // Debounced server-side preview so sample values and part counting match what will be sent.
  useEffect(() => {
    if (!tpl || body === undefined) return
    const timer = setTimeout(() => {
      api
        .post<Preview>(`/sms/templates/${tpl.id}/preview`, { body })
        .then((r) => setPreview(r.data))
        .catch(() => setPreview(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [tpl, body])

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/sms/templates/${tpl!.id}`, await form.validateFields())
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['sms-templates'] })
      onClose()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={tpl !== null} title={tpl ? nameOf(tpl) : ''} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} confirmLoading={saving} width={640} forceRender>
      <Form form={form} layout="vertical">
        <Form.Item label={tx('ব্যবহারযোগ্য চলক')}>
          <Space wrap size={[4, 4]}>
            {tpl?.variables.map((v) => (
              <Tag key={v} style={{ cursor: 'pointer' }} onClick={() => form.setFieldValue('body', `${form.getFieldValue('body') ?? ''}{${v}}`)}>
                {`{${v}}`}
              </Tag>
            ))}
          </Space>
        </Form.Item>
        <Form.Item name="body" label={tx('বার্তা')} rules={[{ required: true, message: tx('বার্তা লিখুন') }]}>
          <Input.TextArea rows={5} maxLength={640} showCount />
        </Form.Item>
        {preview && (
          <Alert
            type="info"
            style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}
            title={tx('নমুনা')}
            description={
              <>
                {preview.text}
                <div style={{ color: '#888', marginTop: 4 }}>{tx('{{len}} অক্ষর · {{parts}} টি এসএমএস', { len: digits(preview.length), parts: digits(preview.parts) })}</div>
              </>
            }
          />
        )}
        <Form.Item name="name_en" label={tx('ইংরেজি নাম')}>
          <Input maxLength={150} />
        </Form.Item>
        <Form.Item name="is_active" label={tx('চালু')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** Editable message bodies for every automatic SMS. */
export default function SmsTemplatesPage() {
  const [editing, setEditing] = useState<Template | null>(null)
  const { data, isFetching } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: async () => (await api.get<Template[]>('/sms/templates')).data,
  })
  return (
    <SettingsShell title={tx('SMS টেমপ্লেট')} subtitle="">
      <p style={{ color: '#888' }}>{tx('বাংলা এসএমএসে প্রতি ৭০ অক্ষরে একটি এসএমএস ধরা হয়। {society} চলকে সমিতির নাম বসে।')}</p>
      <Table<Template>
        rowKey="id"
        loading={isFetching}
        dataSource={data}
        pagination={false}
        scroll={{ x: 800 }}
        onRow={(r) => ({ onClick: () => setEditing(r), style: { cursor: 'pointer' } })}
        columns={[
          { title: tx('নাম'), render: (_, r) => nameOf(r) },
          { title: tx('বার্তা'), dataIndex: 'body', ellipsis: true },
          { title: tx('অবস্থা'), dataIndex: 'is_active', width: 100, render: (v: boolean) => (v ? <Tag color="green">{tx('চালু')}</Tag> : <Tag>{tx('বন্ধ')}</Tag>) },
        ]}
      />
      <EditModal tpl={editing} onClose={() => setEditing(null)} />
    </SettingsShell>
  )
}
