import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Col, Descriptions, Row, Spin, Tag, Typography } from 'antd'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import { api } from '../../lib/api'
import { digits, fmtBytes, fmtDate, fmtDateTime } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import type { LicenseInfo } from '../../lib/types'
import SettingsShell from './SettingsShell'

type SystemInfo = {
  license: LicenseInfo
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

const STATE: Record<LicenseInfo['state'], { label: string; color: string }> = {
  active: { label: tx('সক্রিয়'), color: 'green' },
  grace: { label: tx('গ্রেস পিরিয়ড'), color: 'orange' },
  blocked: { label: tx('বন্ধ'), color: 'red' },
}

/** What support needs to know about this installation, and a short view of the license. */
export default function LicensePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['system-license'],
    queryFn: async () => (await api.get<SystemInfo>('/system/license')).data,
  })

  if (isLoading || !data) return <Spin />
  const { license: l, system: s } = data
  const st = STATE[l.state]

  return (
    <SettingsShell title={tx('সিস্টেম ও ইনস্টলেশন')} subtitle={tx('এই ইনস্টলেশনের আইডি, লাইসেন্সের সংক্ষেপ ও সার্ভারের তথ্য।')}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={tx('লাইসেন্স')}
            extra={
              <Link to="/license-verification">
                <Button icon={<SafetyCertificateOutlined />}>{tx('লাইসেন্স পাতা')}</Button>
              </Link>
            }
          >
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={tx('অবস্থা')}>
                <Tag color={st.color}>{st.label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={tx('ডোমেইন')}>{l.domain ?? l.current_domain}</Descriptions.Item>
              <Descriptions.Item label={tx('মেয়াদ')}>
                {l.expires_at ? fmtDate(l.expires_at) : '—'}
                {l.days_until_expiry !== null && l.days_until_expiry >= 0 && ` (${tx('আর {{p0}} দিন', { p0: digits(l.days_until_expiry) })})`}
              </Descriptions.Item>
              <Descriptions.Item label={tx('শেষ সফল যাচাই')}>{l.last_ok_at ? fmtDateTime(l.last_ok_at) : '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('ইনস্টলেশন আইডি')}>
                <Typography.Text copyable code>
                  {data.installation_id}
                </Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
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
                title={tx('cron চালু না থাকলে স্বয়ংক্রিয় ব্যাকআপ, SMS, জরিমানা হিসাব ও লাইসেন্স যাচাই হবে না।')}
                description={<code>* * * * * php artisan schedule:run</code>}
              />
            )}
          </Card>
        </Col>
      </Row>
    </SettingsShell>
  )
}
