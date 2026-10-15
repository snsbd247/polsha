import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, App, Button, ConfigProvider, Descriptions, Form, Input, Tag } from 'antd'
import { KeyOutlined, LogoutOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import type { AxiosError } from 'axios'
import { useAuth } from '../../auth/AuthContext'
import { useLicense } from '../../auth/LicenseContext'
import { api, errorMessage } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { logoUrl, usePublicSettings } from '../../lib/settings'
import { nameOf, t as tx } from '../../lib/i18n'
import type { LicenseInfo } from '../../lib/types'
import SettingsShell, { SettingsCard } from '../settings/SettingsShell'
import './license.css'

const STATE_TAG: Record<LicenseInfo['state'], { color: string; label: string }> = {
  active: { color: 'green', label: tx('সক্রিয়') },
  grace: { color: 'orange', label: tx('গ্রেস পিরিয়ড') },
  blocked: { color: 'red', label: tx('বন্ধ') },
}

/** Licence status, (re)activation with a key, and "Recheck now". Any signed-in user may use it. */
export default function LicenseVerificationPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { info, blocked, refresh, setInfo } = useLicense()
  const { data: settings } = usePublicSettings()
  const [form] = Form.useForm<{ license_key: string }>()
  const [activating, setActivating] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    refresh()
  }, [refresh])

  // the button rests as long as the server-side limit
  useEffect(() => {
    if (wait <= 0) return
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(t)
  }, [wait])

  const activate = async ({ license_key }: { license_key: string }) => {
    setActivating(true)
    setError(null)
    try {
      const r = await api.post<{ ok: boolean; message: string; license: LicenseInfo }>('/license/activate', { license_key: license_key.trim() })
      setInfo(r.data.license)
      message.success(r.data.message || tx('লাইসেন্স সক্রিয় হয়েছে।'))
      form.resetFields()
      // unlocked: straight on to the software
      if (!r.data.license.blocked) navigate('/', { replace: true })
    } catch (e) {
      const body = (e as AxiosError<{ message?: string; license?: LicenseInfo }>).response?.data
      if (body?.license) setInfo(body.license)
      setError(body?.message || errorMessage(e))
    } finally {
      setActivating(false)
    }
  }

  const recheck = async () => {
    setChecking(true)
    setWait(info?.recheck_seconds ?? 30)
    try {
      const r = await api.post<{ ok: boolean; message: string; license: LicenseInfo }>('/license/recheck')
      setInfo(r.data.license)
      if (r.data.ok) message.success(tx('হালনাগাদ হয়েছে।'))
      else message.warning(r.data.message || tx('লাইসেন্স সার্ভারের উত্তর পাওয়া যায়নি।'))
      if (!r.data.license.blocked && blocked) navigate('/', { replace: true })
    } catch (e) {
      const status = (e as AxiosError).response?.status
      message.error(status === 429 ? tx('একটু পরে আবার চেষ্টা করুন।') : errorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  const tag = info ? STATE_TAG[info.state] : null
  const days = info?.days_until_expiry
  const statusCard = (
    <SettingsCard
      icon={<SafetyCertificateOutlined />}
      title={tx('বর্তমান অবস্থা')}
      subtitle={tx('লাইসেন্স সার্ভারের সর্বশেষ যাচাই অনুযায়ী।')}
      extra={
        <Button icon={<ReloadOutlined />} loading={checking} disabled={wait > 0 && !checking} onClick={recheck}>
          {wait > 0 && !checking ? tx('আবার যাচাই ({{p0}})', { p0: digits(wait) }) : tx('এখনই আবার যাচাই')}
        </Button>
      }
    >
      <Descriptions column={{ xs: 1, md: 2 }} size="small" className="lv-desc">
        <Descriptions.Item label={tx('অবস্থা')}>{tag ? <Tag color={tag.color}>{tag.label}</Tag> : '—'}</Descriptions.Item>
        <Descriptions.Item label={tx('লাইসেন্স কী')}>{info?.license_key ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={tx('ডোমেইন')}>{info?.domain ?? info?.current_domain ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={tx('মেয়াদ শেষ')}>
          {info?.expires_at ? (
            <>
              {fmtDate(info.expires_at)}
              {days != null && <span className="lv-muted"> ({days >= 0 ? tx('আর {{p0}} দিন', { p0: digits(days) }) : tx('{{p0}} দিন আগে শেষ', { p0: digits(-days) })})</span>}
            </>
          ) : (
            '—'
          )}
        </Descriptions.Item>
        <Descriptions.Item label={tx('শেষ যাচাই')}>
          {info?.last_checked_at ? fmtDateTime(info.last_checked_at) : '—'}
          {info?.last_checked_at && !info.last_check_ok && <Tag color="orange" style={{ marginLeft: 8 }}>{tx('উত্তর পাওয়া যায়নি')}</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label={tx('শেষ সফল যাচাই')}>{info?.last_ok_at ? fmtDateTime(info.last_ok_at) : '—'}</Descriptions.Item>
        {info?.server_message && <Descriptions.Item label={tx('সার্ভারের বার্তা')}>{info.server_message}</Descriptions.Item>}
      </Descriptions>
    </SettingsCard>
  )

  const keyCard = (
    <SettingsCard
      icon={<KeyOutlined />}
      title={blocked ? tx('লাইসেন্স কী দিয়ে সক্রিয় করুন') : tx('আবার সক্রিয় / নবায়ন')}
      subtitle={tx('সফটওয়্যার সরবরাহকারীর দেওয়া লাইসেন্স কী লিখুন। এই ডোমেইন ({{p0}}) নিজে থেকে পাঠানো হবে।', { p0: info?.current_domain ?? window.location.hostname })}
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 14 }} />}
      <Form form={form} layout="vertical" onFinish={activate} className="lv-form">
        <Form.Item name="license_key" label={tx('লাইসেন্স কী')} rules={[{ required: true, whitespace: true, message: tx('লাইসেন্স কী দিন।') }]}>
          <Input size="large" placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" icon={<SafetyCertificateOutlined />} loading={activating}>
          {tx('সক্রিয় করুন')}
        </Button>
      </Form>
    </SettingsCard>
  )

  if (blocked) {
    return (
      <LockedFrame
        title={nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }) || tx('সমবায় ERP')}
        logo={settings?.logo ? logoUrl() : null}
        onLogout={() => logout().then(() => navigate('/login'))}
        userName={nameOf(user)}
      >
        <Alert type="error" showIcon className="lv-alert" title={tx('সফটওয়্যার এখন ব্যবহার করা যাচ্ছে না')} description={info?.message || tx('লাইসেন্স যাচাই করা যায়নি।')} />
        {keyCard}
        {info?.license_key && statusCard}
      </LockedFrame>
    )
  }

  return (
    <SettingsShell title={tx('লাইসেন্স')} subtitle={tx('লাইসেন্সের অবস্থা, মেয়াদ, আবার যাচাই ও নবায়ন।')}>
      {info?.state === 'grace' && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={tx('লাইসেন্সের মেয়াদ শেষ হয়ে গেছে — গ্রেস পিরিয়ড চলছে। তাড়াতাড়ি নবায়ন করুন।')} />
      )}
      <div className="lv-grid">
        {statusCard}
        {keyCard}
      </div>
    </SettingsShell>
  )
}

/** Shown in place of the whole app while it is locked: only the key form and sign-out. */
function LockedFrame({ title, logo, userName, onLogout, children }: { title: string; logo: string | null; userName: string; onLogout: () => void; children: ReactNode }) {
  return (
    <div className="lv-locked">
      <header className="lv-locked-head">
        <span className="lv-brand">
          {logo ? <img src={logo} alt="" /> : <SafetyCertificateOutlined />}
          <b>{title}</b>
        </span>
        <span className="lv-user">
          {userName}
          <Button icon={<LogoutOutlined />} onClick={onLogout}>
            {tx('লগআউট')}
          </Button>
        </span>
      </header>
      <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
        {/* "st": the settings pages' card styles */}
        <main className="lv-locked-body st">{children}</main>
      </ConfigProvider>
    </div>
  )
}
