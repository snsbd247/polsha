import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Row, Spin, Tag, Typography } from 'antd'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, fmtBytes, fmtDate, fmtDateTime } from '../../lib/format'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'
import type { AuthUser, LicenseState, LicenseStatus } from '../../lib/types'
import SettingsShell from './SettingsShell'

type SystemInfo = {
  license: LicenseStatus
  installation_id: string
  system: {
    app_version: string
    php: string
    laravel: string
    database: string
    disk_free: number | null
    disk_total: number | null
    last_backup: { id: number; filename: string; size: number; created_at: string } | null
    scheduler_heartbeat: string | null
    scheduler_ok: boolean
    timezone: string
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export const LICENSE_STATE: Record<LicenseState, { label: string; color: string }> = {
  valid: { label: tx('বৈধ'), color: 'green' },
  expiring: { label: tx('মেয়াদ শেষ হতে চলেছে'), color: 'orange' },
  expired: { label: tx('মেয়াদ শেষ'), color: 'red' },
  missing: { label: tx('লাইসেন্স নেই'), color: 'red' },
  invalid: { label: tx('অবৈধ লাইসেন্স'), color: 'red' },
}

export default function LicensePage() {
  const { message } = App.useApp()
  const { user, setUser } = useAuth()
  const [form] = Form.useForm<{ key: string }>()
  const [saving, setSaving] = useState(false)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['system-license'],
    queryFn: async () => (await api.get<SystemInfo>('/system/license')).data,
  })

  const install = async ({ key }: { key: string }) => {
    setSaving(true)
    try {
      const r = await api.post<{ license: LicenseStatus }>('/system/license', { key: key.trim() })
      message.success(tx('লাইসেন্স ইনস্টল হয়েছে।'))
      form.resetFields()
      if (user) setUser({ ...user, license: r.data.license } as AuthUser)
      refetch()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !data) return <Spin />
  const { license: l, system: s } = data
  const st = LICENSE_STATE[l.state]

  return (
    <SettingsShell title={tx('লাইসেন্স ও ইনস্টলেশন')} subtitle={tx('এই ইনস্টলেশনের আইডি, লাইসেন্সের মেয়াদ ও নতুন লাইসেন্স কী বসানো।')}>
      {l.locked && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title={tx('সিস্টেম এখন শুধু দেখার জন্য (Read-only)')}
          description={tx('নতুন লাইসেন্স কী ইনস্টল না করা পর্যন্ত কোনো তথ্য যোগ বা পরিবর্তন করা যাবে না। নিচের ইনস্টলেশন আইডি সরবরাহকারীকে পাঠান।')}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={tx('লাইসেন্স')}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={tx('অবস্থা')}>
                <Tag color={st.color}>{st.label}</Tag>
                {!l.enforced && <Tag>{tx('লক চালু নেই')}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label={tx('লাইসেন্সধারী')}>{l.licensed_to ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('ইস্যু')}>{l.issued ? fmtDate(l.issued) : '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('মেয়াদ')}>
                {l.expires ? fmtDate(l.expires) : '—'}
                {l.days_left !== null && l.days_left >= 0 && ` (${tx('আর {{p0}} দিন', { p0: digits(l.days_left) })})`}
              </Descriptions.Item>
              <Descriptions.Item label={tx('ইনস্টলেশন আইডি')}>
                <Typography.Text copyable code>
                  {data.installation_id}
                </Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
          {user?.is_super_admin && (
            <Card title={tx('নতুন লাইসেন্স কী ইনস্টল')} style={{ marginTop: 16 }}>
              <Form form={form} layout="vertical" onFinish={install}>
                <Form.Item name="key" label={tx('লাইসেন্স কী')} rules={[required(tx('কী দিন'))]} extra={tx('সরবরাহকারীর দেওয়া পুরো কী (POLSHA1. দিয়ে শুরু) পেস্ট করুন।')}>
                  <Input.TextArea rows={4} style={{ fontFamily: 'monospace' }} />
                </Form.Item>
                <Button type="primary" htmlType="submit" icon={<SafetyCertificateOutlined />} loading={saving}>
                  {tx('ইনস্টল')}
                </Button>
              </Form>
            </Card>
          )}
        </Col>
        <Col xs={24} lg={12}>
          <Card title={tx('সিস্টেমের তথ্য')}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={tx('সংস্করণ')}>{s.app_version}</Descriptions.Item>
              <Descriptions.Item label="PHP / Laravel">{`${s.php} / ${s.laravel}`}</Descriptions.Item>
              <Descriptions.Item label={tx('ডাটাবেস')}>{s.database}</Descriptions.Item>
              <Descriptions.Item label={tx('সময় অঞ্চল')}>{s.timezone}</Descriptions.Item>
              <Descriptions.Item label={tx('ডিস্ক খালি')}>{s.disk_free !== null && s.disk_total ? `${fmtBytes(s.disk_free)} / ${fmtBytes(s.disk_total)}` : '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('শেষ ব্যাকআপ')}>
                {s.last_backup ? fmtDateTime(s.last_backup.created_at) : <Tag color="red">{tx('কোনো ব্যাকআপ নেই')}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label={tx('শিডিউলার (cron)')}>
                {s.scheduler_ok ? <Tag color="green">{tx('চালু')}</Tag> : <Tag color="red">{tx('চলছে না')}</Tag>}
                {s.scheduler_heartbeat && fmtDateTime(s.scheduler_heartbeat)}
              </Descriptions.Item>
            </Descriptions>
            {!s.scheduler_ok && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                title={tx('cron চালু না থাকলে স্বয়ংক্রিয় ব্যাকআপ, SMS ও জরিমানা হিসাব হবে না।')}
                description={<code>* * * * * php artisan schedule:run</code>}
              />
            )}
          </Card>
        </Col>
      </Row>
    </SettingsShell>
  )
}
