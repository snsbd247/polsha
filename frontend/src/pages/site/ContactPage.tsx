import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, App, Button, Form, Input, Select } from 'antd'
import { ClockCircleFilled, EnvironmentFilled, MailFilled, PhoneFilled, SendOutlined } from '@ant-design/icons'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { PageBanner, usePageTitle, useSite } from './kit'

type Values = { name: string; mobile: string; email?: string; subject: string; message: string; website?: string }

/** Where to find the office, and a form whose messages reach the office inbox. */
export default function ContactPage() {
  const { site, phone, email, address, hours, telHref } = useSite()
  const { message } = App.useApp()
  const [params] = useSearchParams()
  const [form] = Form.useForm<Values>()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const title = tx('যোগাযোগ করুন')
  usePageTitle(title)

  const SUBJECTS: Record<string, string> = {
    service: tx('সেবার অনুরোধ বা অভিযোগ'),
    water: tx('নতুন পানির সংযোগ'),
    membership: tx('সদস্য হতে চাই'),
    shares: tx('শেয়ার কেনা'),
    bill: tx('বিল নিয়ে প্রশ্ন'),
    other: tx('অন্যান্য'),
  }
  const preset = SUBJECTS[params.get('subject') ?? ''] ?? undefined

  const send = async (v: Values) => {
    setSending(true)
    try {
      const r = await api.post<{ message: string }>('/public/website/messages', v)
      setSent(r.data.message)
      form.resetFields()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageBanner title={title} />
      <section className="ld-page">
        <div className="ld-wrap ld-contact-page">
          <div className="ld-contact-cards">
            {address && (
              <div className="ld-card ld-ci">
                <EnvironmentFilled />
                <span>
                  <b>{tx('ঠিকানা')}</b>
                  <small>{address}</small>
                </span>
              </div>
            )}
            {phone && (
              <a className="ld-card ld-ci" href={telHref}>
                <PhoneFilled />
                <span>
                  <b>{tx('ফোন')}</b>
                  <small>{digits(phone)}</small>
                </span>
              </a>
            )}
            {email && (
              <a className="ld-card ld-ci" href={`mailto:${email}`}>
                <MailFilled />
                <span>
                  <b>{tx('ইমেইল')}</b>
                  <small>{email}</small>
                </span>
              </a>
            )}
            {hours && (
              <div className="ld-card ld-ci">
                <ClockCircleFilled />
                <span>
                  <b>{tx('অফিসের সময়')}</b>
                  <small>{hours}</small>
                </span>
              </div>
            )}
          </div>

          <div className="ld-card ld-contact-form">
            <span className="ld-kicker">{tx('বার্তা পাঠান')}</span>
            <h2 className="ld-page-title">{tx('আমাদের লিখুন')}</h2>
            <p className="ld-muted">{tx('প্রশ্ন, সেবার অনুরোধ বা অভিযোগ লিখে পাঠান — অফিস থেকে আপনার মোবাইলে যোগাযোগ করা হবে।')}</p>
            {sent && <Alert type="success" showIcon title={sent} style={{ marginBottom: 16 }} closable onClose={() => setSent(null)} />}
            <Form form={form} layout="vertical" onFinish={send} initialValues={{ subject: preset }} requiredMark={false}>
              <div className="ld-form-2">
                <Form.Item name="name" label={tx('আপনার নাম')} rules={[{ required: true, whitespace: true, message: tx('নাম দিন') }]}>
                  <Input maxLength={100} size="large" />
                </Form.Item>
                <Form.Item name="mobile" label={tx('মোবাইল নম্বর')} rules={[{ required: true, message: tx('মোবাইল নম্বর দিন') }]}>
                  <Input maxLength={14} inputMode="tel" placeholder="01XXXXXXXXX" size="large" />
                </Form.Item>
              </div>
              <div className="ld-form-2">
                <Form.Item name="email" label={tx('ইমেইল (ঐচ্ছিক)')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
                  <Input maxLength={100} size="large" />
                </Form.Item>
                <Form.Item name="subject" label={tx('বিষয়')} rules={[{ required: true, message: tx('বিষয় বাছাই করুন') }]}>
                  <Select size="large" options={Object.values(SUBJECTS).map((s) => ({ value: s, label: s }))} />
                </Form.Item>
              </div>
              <Form.Item name="message" label={tx('বার্তা')} rules={[{ required: true, whitespace: true, min: 5, message: tx('বার্তা লিখুন') }]}>
                <Input.TextArea rows={5} maxLength={3000} showCount />
              </Form.Item>
              {/* left empty by people; simple bots fill it */}
              <Form.Item name="website" className="ld-hp" aria-hidden>
                <Input tabIndex={-1} autoComplete="off" />
              </Form.Item>
              <Button type="primary" htmlType="submit" size="large" icon={<SendOutlined />} loading={sending}>
                {tx('বার্তা পাঠান')}
              </Button>
            </Form>
          </div>

          {site?.map_url && <iframe className="ld-map" src={site.map_url} title={tx('গুগল ম্যাপ')} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
        </div>
      </section>
    </>
  )
}
