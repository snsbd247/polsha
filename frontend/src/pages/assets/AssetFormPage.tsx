import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Select, Spin } from 'antd'
import { AppstoreOutlined, ArrowLeftOutlined, CalculatorOutlined, CalendarOutlined, CloseOutlined, DollarOutlined, DownOutlined, EnvironmentOutlined, SaveOutlined, UpOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { METHOD_LABEL } from '../../lib/irrigation'
import { toOptions } from '../../lib/phase2'
import { useAssetFunds, useAssetMeta } from '../../lib/phase8'
import type { Mouza } from '../../lib/types'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import type { AssetRow } from './AssetListPage'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../savings/savings.css'
import '../loans/loans.css'

const PAY_METHODS: Record<string, string> = { ...METHOD_LABEL, credit: tx('বাকিতে (সরবরাহকারীর কাছে দেনা)') }

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

/** New asset (purchase / opening / donation) or edit of the descriptive fields; the depreciation it will carry is worked out beside the form. */
export default function AssetFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const meta = useAssetMeta()
  const funds = useAssetFunds()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const existing = useQuery({ queryKey: ['asset', id], enabled: isEdit, queryFn: async () => (await api.get<AssetRow>(`/assets/${id}`)).data })

  const acquisition: string = Form.useWatch('acquisition', form) ?? 'purchase'
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const categoryId: number | undefined = Form.useWatch('category_id', form)
  const costIn: number | undefined = Form.useWatch('cost', form)
  const salvageIn: number | undefined = Form.useWatch('salvage_value', form)
  const lifeIn: number | undefined = Form.useWatch('life_months', form)
  const openingDep: number | undefined = Form.useWatch('opening_depreciation', form)
  const remarks: string | undefined = Form.useWatch('remarks', form)
  const category = meta.data?.categories.find((c) => c.id === categoryId)
  // the optional details stay folded on a new asset; editing shows them all
  const [more, setMore] = useState(isEdit)

  useEffect(() => {
    if (existing.data) form.setFieldsValue(existing.data)
  }, [existing.data, form])

  // what the asset will carry: an empty salvage / life falls back to the category's rate
  const cost = isEdit ? Number(existing.data?.cost ?? 0) : Number(costIn ?? 0)
  const salvage = isEdit ? Number(existing.data?.salvage_value ?? 0) : salvageIn != null ? Number(salvageIn) : category ? (cost * Number(category.salvage_percent)) / 100 : 0
  const life = isEdit ? Number(existing.data?.life_months ?? 0) : lifeIn || category?.life_months || 0
  const monthly = life > 0 ? Math.max(0, cost - salvage) / life : 0
  const already = isEdit ? Number(existing.data?.accumulated_depreciation ?? 0) : acquisition === 'opening' ? Number(openingDep ?? 0) : 0

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    const payload = {
      ...v,
      purchase_date: (v.purchase_date as Dayjs | undefined)?.format('YYYY-MM-DD'),
      opening_date: (v.opening_date as Dayjs | undefined)?.format('YYYY-MM-DD'),
      fund_account_id: v.method && v.method !== 'cash' && v.method !== 'credit' ? v.fund_account_id : null,
    }
    setSaving(true)
    try {
      const r = isEdit ? await api.put<{ id: number }>(`/assets/${id}`, payload) : await api.post<{ id: number; asset_code: string }>('/assets', payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['asset', String(r.data.id)] })
      queryClient.invalidateQueries({ queryKey: ['asset-dashboard'] })
      navigate(`/assets/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (isEdit && existing.isLoading) return <Spin style={{ display: 'block', marginTop: 64 }} />
  const back = isEdit ? `/assets/${id}` : '/assets'
  const title = isEdit ? tx('সম্পদ সম্পাদনা') : tx('নতুন সম্পদ')

  return (
    <PageFrame
      crumbs={[{ label: tx('সম্পদ'), to: '/assets/dashboard' }, { label: tx('সম্পদ রেজিস্টার'), to: '/assets' }, { label: title }]}
      title={isEdit ? `${title} — ${digits(existing.data?.asset_code)}` : title}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate(back)}>
          {isEdit ? tx('সম্পদে ফিরুন') : tx('তালিকায় ফিরুন')}
        </Button>
      }
    >
      <div className="ln-form-grid">
        <Form form={form} layout="vertical" className="iv-form sv-form" initialValues={{ acquisition: 'purchase', method: 'cash', purchase_date: dayjs(), condition: 'good' }}>
          <Section no={1} icon={<AppstoreOutlined />} title={tx('সম্পদের বিবরণ')}>
            <div className="iv-grid iv-grid-2">
              <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
                <Input maxLength={200} placeholder={tx('যেমন: গভীর নলকূপ পাম্প')} />
              </Form.Item>
              <Form.Item hidden={!more} name="name_en" label={tx('নাম (ইংরেজি)')}>
                <Input maxLength={200} placeholder="e.g. Deep tube-well pump" />
              </Form.Item>
            </div>
            <div className="iv-grid iv-grid-3">
              <Form.Item name="category_id" label={tx('শ্রেণি')} rules={[required(tx('শ্রেণি বাছাই করুন'))]}>
                <Select
                  loading={meta.isLoading}
                  placeholder={tx('শ্রেণি বাছাই করুন')}
                  showSearch={{ optionFilterProp: 'label' }}
                  options={(meta.data?.categories ?? []).filter((c) => c.is_active || c.id === existing.data?.category_id).map((c) => ({ value: c.id, label: `${c.code} — ${nameOf(c)}` }))}
                />
              </Form.Item>
              <Form.Item hidden={!more} name="brand_model" label={tx('ব্র্যান্ড / মডেল')}>
                <Input maxLength={150} />
              </Form.Item>
              <Form.Item hidden={!more} name="serial_no" label={tx('সিরিয়াল নম্বর')}>
                <Input maxLength={100} />
              </Form.Item>
            </div>
            <div className="iv-grid iv-grid-2">
              <Form.Item hidden={!more} name="supplier" label={tx('সরবরাহকারী')}>
                <Input maxLength={150} />
              </Form.Item>
              <Form.Item hidden={!more} name="mouza_id" label={tx('মৌজা')}>
                <Select allowClear showSearch={{ optionFilterProp: 'label' }} loading={mouzas.isLoading} placeholder={tx('মৌজা বাছাই করুন')} options={(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))} />
              </Form.Item>
            </div>
            <Form.Item hidden={!more} name="remarks" label={tx('মন্তব্য (ঐচ্ছিক)')} extra={<span className="iv-count">{tx('{{p0}}/৫০০ অক্ষর', { p0: digits(remarks?.length ?? 0) })}</span>}>
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
            {isEdit && <Alert type="info" showIcon className="sv-note" title={tx('অবস্থান, দায়িত্বপ্রাপ্ত ও অবস্থা বদলাতে সম্পদের পাতার "স্থানান্তর/অবস্থা" ব্যবহার করুন — এতে ইতিহাস থাকে। মূল্য ও তারিখ বদলানো যায় না।')} />}
          </Section>

          {!isEdit && (
            <Section no={2} icon={<EnvironmentOutlined />} title={tx('অবস্থান ও দায়িত্ব')}>
              <div className="iv-grid iv-grid-3">
                <Form.Item name="location" label={tx('অবস্থান')}>
                  <Input maxLength={200} placeholder={tx('যেমন: অফিস গুদাম')} />
                </Form.Item>
                <Form.Item name="custodian" label={tx('দায়িত্বপ্রাপ্ত')}>
                  <Input maxLength={150} />
                </Form.Item>
                <Form.Item name="condition" label={tx('ভৌত অবস্থা')}>
                  <Select options={toOptions(meta.data?.conditions)} />
                </Form.Item>
              </div>
            </Section>
          )}

          {!isEdit && (
            <Section no={3} icon={<DollarOutlined />} title={tx('মূল্য ও অর্জন')}>
              <div className="iv-grid iv-grid-3">
                <Form.Item name="acquisition" label={tx('অর্জনের ধরন')}>
                  <Select options={toOptions(meta.data?.acquisitions)} />
                </Form.Item>
                <Form.Item name="purchase_date" label={tx('ক্রয়/প্রাপ্তির তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                  <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                </Form.Item>
                <Form.Item name="cost" label={tx('ক্রয়মূল্য (৳)')} rules={[required(tx('মূল্য দিন'))]}>
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} prefix="৳" placeholder="0.00" />
                </Form.Item>
              </div>
              <div className="iv-grid iv-grid-2">
                <Form.Item hidden={!more} name="salvage_value" label={tx('অবশিষ্ট মূল্য (৳)')} extra={category ? tx('খালি রাখলে শ্রেণির হার: {{p0}}%', { p0: digits(Number(category.salvage_percent)) }) : undefined}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="৳" placeholder="0.00" />
                </Form.Item>
                <Form.Item hidden={!more} name="life_months" label={tx('আয়ুষ্কাল (মাস)')} extra={category ? tx('খালি রাখলে শ্রেণির আয়ুষ্কাল: {{p0}} মাস', { p0: digits(category.life_months) }) : undefined}>
                  <InputNumber min={1} max={1200} style={{ width: '100%' }} />
                </Form.Item>
              </div>
              {acquisition === 'opening' && (
                <div className="iv-grid iv-grid-2">
                  <Form.Item name="opening_depreciation" label={tx('এ পর্যন্ত পুঞ্জীভূত অবচয় (৳)')}>
                    <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="৳" placeholder="0.00" />
                  </Form.Item>
                  <Form.Item name="opening_date" label={tx('হিসাবে তোলার তারিখ')} extra={tx('খালি রাখলে আজকের তারিখ')}>
                    <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                  </Form.Item>
                </div>
              )}
              {acquisition === 'purchase' && (
                <div className="iv-grid iv-grid-3">
                  <Form.Item name="method" label={tx('পরিশোধের মাধ্যম')}>
                    <Select options={toOptions(PAY_METHODS)} />
                  </Form.Item>
                  {method !== 'cash' && method !== 'credit' && (
                    <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                      <Select
                        loading={funds.isFetching}
                        options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))}
                      />
                    </Form.Item>
                  )}
                  {method !== 'cash' && (
                    <Form.Item hidden={!more} name="reference" label={tx('রেফারেন্স')}>
                      <Input maxLength={100} />
                    </Form.Item>
                  )}
                </div>
              )}
              <Alert
                type="info"
                showIcon
                className="sv-note"
                title={
                  acquisition === 'purchase'
                    ? tx('সংরক্ষণ করলে স্বয়ংক্রিয় ভাউচার হবে: সম্পদ ডেবিট, নগদ/ব্যাংক/দেনা ক্রেডিট। অবচয় ক্রয়ের মাস থেকে সরল রেখা পদ্ধতিতে।')
                    : acquisition === 'opening'
                      ? tx('পূর্বের সম্পদ প্রারম্ভিক জের সমন্বয়ের বিপরীতে হিসাবে উঠবে; অবচয় পরের মাস থেকে।')
                      : tx('অনুদানের সম্পদ সাধারণ তহবিলের বিপরীতে হিসাবে উঠবে।')
                }
              />
            </Section>
          )}

          <button type="button" className={`lf-more-toggle${more ? ' on' : ''}`} onClick={() => setMore((m) => !m)}>
            {more ? <UpOutlined /> : <DownOutlined />}
            {tx('আরও তথ্য (ঐচ্ছিক)')}
            <small>{tx('ইংরেজি নাম, ব্র্যান্ড, সিরিয়াল, সরবরাহকারী, মৌজা, মন্তব্য, অবশিষ্ট মূল্য ও আয়ুষ্কাল (খালি রাখলে শ্রেণি থেকে), রেফারেন্স')}</small>
          </button>
          <div className="iv-actions">
            <Button icon={<CloseOutlined />} onClick={() => navigate(back)}>
              {tx('বাতিল')}
            </Button>
            {!isEdit && <Button onClick={() => form.resetFields()}>{tx('রিসেট')}</Button>}
            <span className="iv-spacer" />
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              {tx('সংরক্ষণ')}
            </Button>
          </div>
        </Form>

        <div className="ln-side">
          <section className="id-box">
            <header>
              <CalculatorOutlined />
              <h3>{tx('অবচয়ের হিসাব')}</h3>
            </header>
            {!cost || !life ? (
              <p className="sv-foot-note">{tx('শ্রেণি ও ক্রয়মূল্য দিলে মাসিক অবচয় দেখা যাবে।')}</p>
            ) : (
              <div className="ln-limit">
                <table className="ln-limit-table">
                  <tbody>
                    <tr>
                      <td>{tx('ক্রয়মূল্য')}</td>
                      <td>৳ {money(cost)}</td>
                    </tr>
                    <tr>
                      <td>{tx('অবশিষ্ট মূল্য')}</td>
                      <td>৳ {money(salvage)}</td>
                    </tr>
                    <tr>
                      <td>{tx('আয়ুষ্কাল')}</td>
                      <td>{tx('{{p0}} মাস', { p0: digits(life) })}</td>
                    </tr>
                    {already > 0 && (
                      <tr>
                        <td>{tx('এ পর্যন্ত অবচয়')}</td>
                        <td>৳ {money(already)}</td>
                      </tr>
                    )}
                    <tr>
                      <td>{tx('বার্ষিক অবচয়')}</td>
                      <td>৳ {money(monthly * 12)}</td>
                    </tr>
                    <tr className="ln-limit-total">
                      <td>{tx('মাসিক অবচয়')}</td>
                      <td>৳ {money(monthly)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="sv-foot-note">{tx('সরল রেখা পদ্ধতি: (ক্রয়মূল্য − অবশিষ্ট মূল্য) ÷ আয়ুষ্কাল।')}</p>
              </div>
            )}
          </section>
          {category && (
            <section className="id-box">
              <header>
                <AppstoreOutlined />
                <h3>{tx('শ্রেণির নিয়ম')}</h3>
              </header>
              <div className="ln-limit">
                <table className="ln-limit-table">
                  <tbody>
                    <tr>
                      <td>{tx('শ্রেণি')}</td>
                      <td>{nameOf(category)}</td>
                    </tr>
                    <tr>
                      <td>{tx('আয়ুষ্কাল')}</td>
                      <td>{tx('{{p0}} মাস', { p0: digits(category.life_months) })}</td>
                    </tr>
                    <tr>
                      <td>{tx('অবশিষ্ট মূল্যের হার')}</td>
                      <td>{digits(Number(category.salvage_percent))}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </PageFrame>
  )
}
