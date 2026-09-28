import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Input, Radio, Select, Spin } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, CloseOutlined, InfoCircleFilled, SaveOutlined, TagOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import type { Season } from '../../lib/irrigation'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import './seasons.css'

type Meta = { statuses: Record<string, string>; types: Record<string, string> }
const DATES = ['start_date', 'end_date', 'due_date'] as const
const STATUS_HINT: Record<string, string> = {
  open: 'ইনভয়েস ও রেটে এই মৌসুম ব্যবহার করা যাবে।',
  planned: 'মৌসুম এখনো শুরু হয়নি; রেট ঠিক করে রাখা যায়।',
  closed: 'বন্ধ মৌসুমে নতুন ইনভয়েস করা যায় না।',
}

/** Add or edit a season. */
export default function SeasonFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const remarks: string | undefined = Form.useWatch('remarks', form)

  const meta = useQuery({ queryKey: ['seasons'], queryFn: async () => (await api.get<Meta & { data: Season[] }>('/seasons')).data })
  const season = useQuery({ queryKey: ['seasons', id], queryFn: async () => (await api.get<Season>(`/seasons/${id}`)).data, enabled: !!id })

  useEffect(() => {
    const s = season.data
    if (s) form.setFieldsValue({ ...s, ...Object.fromEntries(DATES.map((k) => [k, s[k] ? dayjs(s[k]) : null])) })
  }, [season.data, form])

  const save = async () => {
    const v = await form.validateFields()
    const payload = { ...v, ...Object.fromEntries(DATES.map((k) => [k, (v[k] as Dayjs | null)?.format('YYYY-MM-DD') ?? null])) }
    setSaving(true)
    try {
      const r = id ? await api.put(`/seasons/${id}`, payload) : await api.post('/seasons', payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['seasons'] })
      queryClient.invalidateQueries({ queryKey: ['invoice-meta'] })
      navigate(`/irrigation/seasons/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const title = id ? tx('মৌসুম সম্পাদনা') : tx('নতুন মৌসুম')
  return (
    <PageFrame
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('মৌসুমের তালিকা'), to: '/irrigation/seasons' }, { label: title }]}
      title={title}
      subtitle={tx('নতুন কৃষি মৌসুম তৈরি করুন। সেচের রেট ও ইনভয়েস তৈরিতে এই তথ্য ব্যবহার হবে।')}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/irrigation/seasons')}>
          {tx('মৌসুমের তালিকায় ফিরুন')}
        </Button>
      }
    >
      {id && season.isLoading ? (
        <Spin />
      ) : (
        <Form form={form} layout="vertical" className="sn-form" requiredMark initialValues={{ status: 'open', type: undefined }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && e.preventDefault()}>
          <section className="sn-form-card">
            <header className="sn-form-head">
              <span className="sn-badge">
                <DashIcon name="sprout" size={32} color="#1f9d55" stroke={2.2} />
              </span>
              <div>
                <h3>{tx('মৌসুমের তথ্য')}</h3>
                <p>{tx('মৌসুমের মূল তথ্য দিন।')}</p>
              </div>
            </header>
            <div className="sn-form-grid">
              <div>
                <Form.Item name="name_bn" label={tx('মৌসুমের নাম')} rules={[required(tx('নাম দিন'))]}>
                  <Input prefix={<DashIcon name="sprout" size={16} color="#4b5563" stroke={2} />} placeholder={tx('মৌসুমের নাম (যেমন: বোরো ২০২৬, আমন ২০২৬)')} />
                </Form.Item>
                <Form.Item name="code" label={tx('মৌসুমের কোড')} rules={[required(tx('কোড দিন'))]} normalize={(v?: string) => v?.toUpperCase()}>
                  <Input prefix={<TagOutlined />} placeholder={tx('অনন্য কোড (যেমন: BORO26, AMAN26)')} maxLength={20} />
                </Form.Item>
                <Form.Item name="type" label={tx('মৌসুমের ধরন')} rules={[required(tx('ধরন বাছাই করুন'))]}>
                  <Select placeholder={tx('মৌসুমের ধরন বাছাই করুন')} options={Object.entries(meta.data?.types ?? {}).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
                <Form.Item name="start_date" label={tx('শুরুর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                  <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" placeholder={tx('শুরুর তারিখ বাছাই করুন')} />
                </Form.Item>
                <Form.Item name="crop" label={tx('ফসল')}>
                  <Input prefix={<DashIcon name="sprout" size={16} color="#4b5563" stroke={2} />} placeholder={tx('যেমন: বোরো ধান')} />
                </Form.Item>
              </div>
              <div>
                <Form.Item name="end_date" label={tx('শেষের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                  <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" placeholder={tx('শেষের তারিখ বাছাই করুন')} />
                </Form.Item>
                <Form.Item name="due_date" label={tx('পরিশোধের শেষ তারিখ')} extra={tx('এই তারিখের পর বকেয়া "মেয়াদোত্তীর্ণ" দেখাবে')}>
                  <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" />
                </Form.Item>
                <Form.Item name="remarks" label={tx('বিবরণ')} extra={<span className="sn-count">{tx('{{p0}}/৫০০ অক্ষর', { p0: String(remarks?.length ?? 0) })}</span>}>
                  <Input.TextArea rows={4} maxLength={500} placeholder={tx('মৌসুমের বিবরণ লিখুন (ঐচ্ছিক)...')} />
                </Form.Item>
                <Form.Item name="status" label={tx('অবস্থা')} rules={[required(tx('অবস্থা বাছাই করুন'))]}>
                  <Radio.Group className="sn-status">
                    {Object.entries(meta.data?.statuses ?? {}).map(([value, label]) => (
                      <Radio key={value} value={value}>
                        <strong>{label}</strong>
                        <small>{tx(STATUS_HINT[value] ?? '')}</small>
                      </Radio>
                    ))}
                  </Radio.Group>
                </Form.Item>
              </div>
            </div>
          </section>

          <div className="sn-note">
            <InfoCircleFilled />
            <div>
              <strong>{tx('জরুরি নোট')}</strong>
              <span>{tx('মৌসুমের কোড অনন্য হতে হবে। এই মৌসুম সেচের রেট, ইনভয়েস ও চাষ সংক্রান্ত অংশে ব্যবহার হবে।')}</span>
            </div>
          </div>

          <div className="sn-actions">
            <Button icon={<CloseOutlined />} onClick={() => navigate(-1)}>
              {tx('বাতিল')}
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              {tx('মৌসুম সংরক্ষণ')}
            </Button>
          </div>
        </Form>
      )}
    </PageFrame>
  )
}
