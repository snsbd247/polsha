import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, Form, Input, Select, Spin, Switch } from 'antd'
import { ArrowLeftOutlined, CloseOutlined, LockOutlined, SafetyCertificateOutlined, SaveOutlined, UserOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, toEnDigits } from '../../lib/format'
import { roleOptions, useRoles } from '../../lib/queries'
import { mobileRules, passwordRules, required } from '../../lib/rules'
import type { UserRow } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../savings/savings.css'
import '../loans/loans.css'

function Section({ no, icon, title, children }: { no: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="lf-card iv-section">
      <header className="lf-card-head">
        <span className="iv-section-icon">{icon}</span>
        <h3>
          {digits(no)}. {title}
        </h3>
      </header>
      <div className="lf-card-body">{children}</div>
    </section>
  )
}

/** A staff account: name, sign-in name, contact, roles and (for a new one) the first password. */
export default function UserFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { data: roles } = useRoles()
  const picked: string[] = Form.useWatch('roles', form) ?? []

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

  const save = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    const payload = { ...values, mobile: toEnDigits(String(values.mobile ?? '')) }
    setSaving(true)
    try {
      const r = isEdit ? await api.put<UserRow>(`/users/${id}`, payload) : await api.post<UserRow>('/users', payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['users'] })
      navigate(`/admin/users/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (isEdit && isLoading) return <Spin />
  const title = isEdit ? tx('ইউজার সম্পাদনা') : tx('নতুন ইউজার')
  const back = isEdit ? `/admin/users/${id}` : '/admin/users'

  return (
    <PageFrame
      crumbs={[{ label: tx('প্রশাসন'), to: '/admin/users' }, { label: tx('ইউজার'), to: '/admin/users' }, { label: title }]}
      title={title}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate(back)}>
          {tx('ফিরে যান')}
        </Button>
      }
    >
      <div className="ln-form-grid">
        <Form form={form} layout="vertical" className="iv-form sv-form" initialValues={{ is_active: true, must_change_password: true, roles: [] }}>
          <Section no={1} icon={<UserOutlined />} title={tx('ইউজারের তথ্য')}>
            <div className="iv-grid iv-grid-2">
              <Form.Item name="name_bn" label={tx('পূর্ণ নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
                <Input />
              </Form.Item>
              <Form.Item name="name_en" label={tx('পূর্ণ নাম (ইংরেজি)')}>
                <Input />
              </Form.Item>
              <Form.Item name="username" label={tx('ইউজারনেম')} rules={[required(tx('ইউজারনেম দিন')), { pattern: /^[a-zA-Z0-9._-]{3,50}$/, message: tx('ইংরেজি অক্ষর, সংখ্যা, . _ - (৩–৫০ অক্ষর)') }]}>
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item name="mobile" label={tx('মোবাইল')} rules={mobileRules}>
                <Input inputMode="numeric" placeholder="01XXXXXXXXX" />
              </Form.Item>
            </div>
            <Form.Item name="email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
              <Input />
            </Form.Item>
          </Section>

          <Section no={2} icon={<SafetyCertificateOutlined />} title={tx('রোল ও অবস্থা')}>
            <Form.Item name="roles" label={tx('রোল')} rules={[{ required: true, type: 'array', min: 1, message: tx('কমপক্ষে একটি রোল দিন') }]}>
              <Select mode="multiple" options={options} placeholder={tx('রোল বাছাই করুন')} showSearch={{ optionFilterProp: 'label' }} />
            </Form.Item>
            <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
              <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} disabled={isEdit && existing?.id === me?.id} />
            </Form.Item>
          </Section>

          {!isEdit && (
            <Section no={3} icon={<LockOutlined />} title={tx('পাসওয়ার্ড')}>
              <Form.Item name="password" label={tx('প্রাথমিক পাসওয়ার্ড')} rules={passwordRules}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="must_change_password" valuePropName="checked">
                <Checkbox>{tx('প্রথম লগইনে পাসওয়ার্ড বদলাতে হবে')}</Checkbox>
              </Form.Item>
            </Section>
          )}

          <div className="iv-actions">
            <Button icon={<CloseOutlined />} onClick={() => navigate(back)}>
              {tx('বাতিল')}
            </Button>
            <span className="iv-spacer" />
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              {tx('সংরক্ষণ')}
            </Button>
          </div>
        </Form>

        <div className="ln-side">
          <section className="id-box">
            <header>
              <SafetyCertificateOutlined />
              <h3>{tx('বাছাই করা রোল')}</h3>
            </header>
            {picked.length === 0 ? (
              <p className="sv-foot-note">{tx('রোল বাছাই করলে এখানে তার বিবরণ দেখা যাবে।')}</p>
            ) : (
              <ul className="uf-roles">
                {picked.map((name) => {
                  const r = roles?.find((x) => x.name === name)
                  return (
                    <li key={name}>
                      <strong>{r?.label ?? name}</strong>
                      <span>{r?.description || '—'}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <section className="id-box">
            <header>
              <LockOutlined />
              <h3>{tx('নিরাপত্তা')}</h3>
            </header>
            <p className="sv-foot-note">{tx('বারবার ভুল পাসওয়ার্ড দিলে (সেটিংসে ঠিক করা সংখ্যা) অ্যাকাউন্ট কিছুক্ষণের জন্য লক হয়। নিষ্ক্রিয় করলে ইউজার সঙ্গে সঙ্গে লগআউট হয়ে যায়।')}</p>
          </section>
        </div>
      </div>
    </PageFrame>
  )
}
