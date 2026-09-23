import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Checkbox, Form, Input, Select, Space, Spin, Switch } from 'antd'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { toEnDigits } from '../../lib/format'
import { roleOptions, useRoles } from '../../lib/queries'
import { mobileRules, passwordRules, required } from '../../lib/rules'
import type { UserRow } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

export default function UserFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: roles } = useRoles()

  const { data: existing, isLoading } = useQuery({
    queryKey: ['users', id],
    queryFn: async () => (await api.get<UserRow>(`/users/${id}`)).data,
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) form.setFieldsValue({ ...existing, roles: existing.roles.map((r) => r.name) })
  }, [existing, form])

  // Only a Super Admin can see/assign the Super Admin role.
  const options = roleOptions(roles).filter((o) => me?.is_super_admin || o.value !== 'super_admin')

  const onFinish = async (values: Record<string, unknown>) => {
    const payload = { ...values, mobile: toEnDigits(String(values.mobile ?? '')) }
    try {
      const r = isEdit ? await api.put<UserRow>(`/users/${id}`, payload) : await api.post<UserRow>('/users', payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['users'] })
      navigate(`/admin/users/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  if (isEdit && isLoading) return <Spin />

  return (
    <>
      <div className="page-header">
        <h2>{isEdit ? tx('ইউজার সম্পাদনা') : tx('নতুন ইউজার')}</h2>
      </div>
      <Card style={{ maxWidth: 720 }}>
        <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ is_active: true, must_change_password: true, roles: [] }}>
          <Form.Item name="name_bn" label={tx('পূর্ণ নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
            <Input />
          </Form.Item>
          <Form.Item name="name_en" label={tx('পূর্ণ নাম (ইংরেজি)')}>
            <Input />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item
              name="username"
              label={tx('ইউজারনেম')}
              style={{ minWidth: 240 }}
              rules={[required(tx('ইউজারনেম দিন')), { pattern: /^[a-zA-Z0-9._-]{3,50}$/, message: tx('ইংরেজি অক্ষর, সংখ্যা, . _ - (৩–৫০ অক্ষর)') }]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="mobile" label={tx('মোবাইল')} style={{ minWidth: 240 }} rules={mobileRules}>
              <Input inputMode="numeric" placeholder="01XXXXXXXXX" />
            </Form.Item>
          </Space>
          <Form.Item name="email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="roles" label={tx('রোল')} rules={[{ required: true, type: 'array', min: 1, message: tx('কমপক্ষে একটি রোল দিন') }]}>
            <Select mode="multiple" options={options} placeholder={tx('রোল বাছাই করুন')} showSearch={{ optionFilterProp: 'label' }} />
          </Form.Item>
          {!isEdit && (
            <>
              <Form.Item name="password" label={tx('প্রাথমিক পাসওয়ার্ড')} rules={passwordRules}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="must_change_password" valuePropName="checked">
                <Checkbox>{tx('প্রথম লগইনে পাসওয়ার্ড বদলাতে হবে')}</Checkbox>
              </Form.Item>
            </>
          )}
          <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
            <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} disabled={isEdit && existing?.id === me?.id} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              {tx('সংরক্ষণ')}
            </Button>
            <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
          </Space>
        </Form>
      </Card>
    </>
  )
}
