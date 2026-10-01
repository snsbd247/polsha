import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Input, InputNumber, Radio, Select, Spin } from 'antd'
import { AppstoreFilled, BellFilled, CalculatorFilled, DesktopOutlined, EnvironmentFilled, LockFilled, SaveFilled, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'
import SettingsShell, { SettingsCard } from './SettingsShell'

const MONTHS = [tx('জানুয়ারি'), tx('ফেব্রুয়ারি'), tx('মার্চ'), tx('এপ্রিল'), tx('মে'), tx('জুন'), tx('জুলাই'), tx('আগস্ট'), tx('সেপ্টেম্বর'), tx('অক্টোবর'), tx('নভেম্বর'), tx('ডিসেম্বর')]

export default function PreferencesPage() {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/settings')).data,
  })

  const load = (d: Record<string, unknown>) =>
    form.setFieldsValue({
      ...d,
      default_locale: d.default_locale ?? 'bn',
      page_size: Number(d.page_size ?? 25),
      idle_logout_minutes: Number(d.idle_logout_minutes ?? 0),
      go_live_date: d.go_live_date ? dayjs(String(d.go_live_date)) : null,
    })
  useEffect(() => {
    if (data) load(data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const save = async (v: Record<string, unknown>) => {
    setSaving(true)
    try {
      await api.put('/settings/preferences', { ...v, go_live_date: v.go_live_date ? (v.go_live_date as dayjs.Dayjs).format('YYYY-MM-DD') : null })
      message.success(tx('সেটিংস সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['public-settings'] })
      refetch()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !data) return <Spin />

  return (
    <SettingsShell title={tx('সিস্টেম পছন্দসমূহ')} subtitle={tx('প্রদর্শন, নিরাপত্তা, অর্থবছর এবং সদস্যপদ, জমি, ঋণ ও পেমেন্টের নিয়ম।')}>
      <Form form={form} layout="vertical" onFinish={save}>
        <div className="st-row-bottom">
          <SettingsCard icon={<DesktopOutlined />} title={tx('প্রদর্শন')}>
            <Form.Item name="default_locale" label={tx('ডিফল্ট ভাষা')} extra={tx('নতুন কম্পিউটার/মোবাইলে প্রথমবার এই ভাষায় খুলবে; প্রত্যেকে নিজে বদলাতে পারবেন।')}>
              <Radio.Group
                options={[
                  { value: 'bn', label: 'বাংলা' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </Form.Item>
            <Form.Item name="digits" label={tx('সংখ্যা দেখাবে')}>
              <Radio.Group
                options={[
                  { value: 'bn', label: tx('বাংলা (১২৩)') },
                  { value: 'en', label: tx('ইংরেজি (123)') },
                ]}
              />
            </Form.Item>
            <Form.Item name="page_size" label={tx('প্রতি পাতায় সারি')} extra={tx('তালিকার পাতায় একবারে কতটি সারি দেখাবে।')} className="st-last">
              <Select style={{ width: 160 }} options={[10, 25, 50, 100].map((n) => ({ value: n, label: n }))} />
            </Form.Item>
          </SettingsCard>
          <SettingsCard icon={<LockFilled />} title={tx('নিরাপত্তা ও চালু')}>
            <Form.Item name="idle_logout_minutes" label={tx('নিষ্ক্রিয় থাকলে স্বয়ংক্রিয় লগআউট (মিনিট)')} extra={tx('০ মানে বন্ধ। শেয়ার করা কম্পিউটারে ১৫–৩০ মিনিট রাখা ভালো।')}>
              <InputNumber min={0} max={480} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="go_live_date" label={tx('চালু (Go-Live) তারিখ')} extra={tx('এই তারিখ থেকে নতুন সিস্টেমে লেনদেন শুরু; আগের জের প্রারম্ভিক ইমপোর্টে আসবে।')} className="st-last">
              <DatePicker format="DD/MM/YYYY" style={{ width: 200 }} />
            </Form.Item>
          </SettingsCard>
          <SettingsCard icon={<CalculatorFilled />} title={tx('অর্থবছর')}>
            <Form.Item name="fiscal_year_start_month" label={tx('অর্থবছর শুরুর মাস')} rules={[required(tx('মাস দিন'))]}>
              <Select options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
            </Form.Item>
            <Form.Item name="current_fiscal_year" label={tx('চলতি অর্থবছর')} rules={[{ pattern: /^\d{4}-\d{2}$/, message: tx('যেমন 2026-27') }]} className="st-last">
              <Input placeholder="2026-27" />
            </Form.Item>
          </SettingsCard>
        </div>

        <div className="st-row-bottom" style={{ marginTop: 12 }}>
          <SettingsCard icon={<TeamOutlined />} title={tx('সদস্যপদ')}>
            <Form.Item name="admission_fee" label={tx('নির্দিষ্ট ভর্তি ফি')} extra={tx('আবেদনের সময় স্বয়ংক্রিয়ভাবে বসবে; প্রয়োজনে কারণসহ বদলানো যাবে।')}>
              <InputNumber min={0} prefix={tx('৳')} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="voter_min_membership_months" label={tx('ভোটার হতে ন্যূনতম সদস্যকাল (মাস)')} extra={tx('০ মানে সব সক্রিয় সদস্য ভোটার।')} className="st-last">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </SettingsCard>
          <SettingsCard icon={<EnvironmentFilled />} title={tx('জমি ও ঋণ')}>
            <Form.Item name="bigha_decimal" label={tx('১ বিঘা = কত শতক')} extra={tx('এলাকাভেদে আলাদা (সাধারণত ৩৩)। ১ কাঠা = বিঘার ২০ ভাগের ১ ভাগ।')} rules={[required(tx('মান দিন'))]}>
              <InputNumber min={1} max={200} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="loan_max_guarantees" label={tx('একজন সদস্য সর্বোচ্চ কতটি চলমান ঋণের জামিনদার হতে পারবেন')} rules={[required(tx('মান দিন'))]} className="st-last">
              <InputNumber min={1} max={20} style={{ width: '100%' }} />
            </Form.Item>
          </SettingsCard>
          <SettingsCard icon={<AppstoreFilled />} title={tx('একত্রিত পেমেন্ট ও শেয়ার')}>
            <Form.Item
              name="combined_payment_order"
              label={tx('টাকা সমন্বয়ের ক্রম')}
              extra={tx('যে ক্রমে বাছাই করবেন, সেই ক্রমে বকেয়া পরিশোধ হবে; বাকি টাকা সঞ্চয়ে যাবে। আদায়ের সময় প্রয়োজনে বদলানো যায়।')}
              rules={[{ validator: (_, v?: string[]) => (v?.length === 3 ? Promise.resolve() : Promise.reject(new Error(tx('তিনটিই ক্রম অনুযায়ী বাছাই করুন')))) }]}
            >
              <Select
                mode="multiple"
                options={[
                  { value: 'loan', label: tx('ঋণ') },
                  { value: 'irrigation', label: tx('সেচ') },
                  { value: 'share', label: tx('শেয়ার') },
                ]}
              />
            </Form.Item>
            <Form.Item name="share_min_amount" label={tx('ন্যূনতম শেয়ার মূলধন')} extra={tx('শেয়ার এই পরিমাণে না পৌঁছা পর্যন্ত একত্রিত পেমেন্টে শেয়ার বকেয়া ধরা হবে। ০ মানে শেয়ার বকেয়া নেই।')}>
              <InputNumber min={0} prefix={tx('৳')} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="share_unit_price" label={tx('প্রতি শেয়ারের মূল্য')} extra={tx('সদস্যের শেয়ার মূলধনকে এই মূল্য দিয়ে ভাগ করে শেয়ারের সংখ্যা দেখানো হয়।')} className="st-last">
              <InputNumber min={0.01} prefix={tx('৳')} style={{ width: '100%' }} />
            </Form.Item>
          </SettingsCard>
        </div>

        <div className="st-row-bottom" style={{ marginTop: 12 }}>
          <SettingsCard icon={<BellFilled />} title={tx('সতর্কবার্তা (উপরের ঘণ্টায়)')}>
            <Form.Item name="alert_day_close_days" label={tx('নগদের দিন কত দিন বন্ধ না হলে')} extra={tx('নগদ লেনদেন আছে কিন্তু দিন বন্ধ হয়নি — এত দিন পার হলে সতর্কবার্তা।')} rules={[required(tx('মান দিন'))]}>
              <InputNumber min={1} max={60} suffix={tx('দিন')} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="alert_field_cash_days" label={tx('মাঠকর্মীর হাতে টাকা কত দিন থাকলে')} extra={tx('মাঠের আদায় এত দিনেও অফিসে জমা না হলে সতর্কবার্তা।')} rules={[required(tx('মান দিন'))]}>
              <InputNumber min={1} max={60} suffix={tx('দিন')} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="alert_approval_days" label={tx('অনুমোদন কত দিন আটকে থাকলে')} extra={tx('যিনি অনুমোদন দেবেন, তাকেই দেখানো হয়।')} rules={[required(tx('মান দিন'))]} className="st-last">
              <InputNumber min={1} max={60} suffix={tx('দিন')} style={{ width: '100%' }} />
            </Form.Item>
          </SettingsCard>
        </div>

        <div className="st-footer">
          <Button onClick={() => load(data)}>{tx('বাতিল')}</Button>
          <Button type="primary" htmlType="submit" icon={<SaveFilled />} loading={saving}>
            {tx('সেটিংস সংরক্ষণ')}
          </Button>
        </div>
      </Form>
    </SettingsShell>
  )
}
