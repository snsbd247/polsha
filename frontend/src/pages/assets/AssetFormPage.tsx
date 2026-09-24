import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Spin } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
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

const PAY_METHODS: Record<string, string> = { ...METHOD_LABEL, credit: tx('বাকিতে (সরবরাহকারীর কাছে দেনা)') }

/** New asset (purchase / opening / donation) or edit of the descriptive fields. */
export default function AssetFormPage() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const meta = useAssetMeta()
  const funds = useAssetFunds()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const existing = useQuery({ queryKey: ['asset', id], enabled: isEdit, queryFn: async () => (await api.get<AssetRow>(`/assets/${id}`)).data })

  const acquisition: string = Form.useWatch('acquisition', form) ?? 'purchase'
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const categoryId: number | undefined = Form.useWatch('category_id', form)
  const cost: number | undefined = Form.useWatch('cost', form)
  const category = meta.data?.categories.find((c) => c.id === categoryId)

  useEffect(() => {
    if (existing.data) form.setFieldsValue(existing.data)
  }, [existing.data, form])

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    const payload = {
      ...v,
      purchase_date: (v.purchase_date as Dayjs | undefined)?.format('YYYY-MM-DD'),
      opening_date: (v.opening_date as Dayjs | undefined)?.format('YYYY-MM-DD'),
      fund_account_id: v.method && v.method !== 'cash' && v.method !== 'credit' ? v.fund_account_id : null,
    }
    try {
      const r = isEdit ? await api.put<{ id: number }>(`/assets/${id}`, payload) : await api.post<{ id: number; asset_code: string }>('/assets', payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['asset', String(r.data.id)] })
      navigate(`/assets/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  if (isEdit && existing.isLoading) return <Spin style={{ display: 'block', marginTop: 64 }} />

  return (
    <>
      <div className="page-header">
        <h2>{isEdit ? tx('সম্পদ সম্পাদনা — {{p0}}', { p0: digits(existing.data?.asset_code) }) : tx('নতুন সম্পদ')}</h2>
      </div>
      <Form form={form} layout="vertical" initialValues={{ acquisition: 'purchase', method: 'cash', purchase_date: dayjs(), condition: 'good' }}>
        <Card title={tx('সম্পদের বিবরণ')} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="category_id" label={tx('শ্রেণি')} rules={[required(tx('শ্রেণি বাছাই করুন'))]}>
                <Select
                  loading={meta.isLoading}
                  options={(meta.data?.categories ?? []).filter((c) => c.is_active || c.id === existing.data?.category_id).map((c) => ({ value: c.id, label: `${c.code} — ${nameOf(c)}` }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="brand_model" label={tx('ব্র্যান্ড / মডেল')}>
                <Input maxLength={150} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="serial_no" label={tx('সিরিয়াল নম্বর')}>
                <Input maxLength={100} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="supplier" label={tx('সরবরাহকারী')}>
                <Input maxLength={150} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="mouza_id" label={tx('মৌজা')}>
                <Select allowClear showSearch={{ optionFilterProp: 'label' }} loading={mouzas.isLoading} options={(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))} />
              </Form.Item>
            </Col>
            {!isEdit && (
              <>
                <Col xs={24} md={8}>
                  <Form.Item name="location" label={tx('অবস্থান')}>
                    <Input maxLength={200} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="custodian" label={tx('দায়িত্বপ্রাপ্ত')}>
                    <Input maxLength={150} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="condition" label={tx('অবস্থা')}>
                    <Select options={toOptions(meta.data?.conditions)} />
                  </Form.Item>
                </Col>
              </>
            )}
            <Col xs={24}>
              <Form.Item name="remarks" label={tx('মন্তব্য')}>
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </Col>
          </Row>
          {isEdit && <Alert type="info" showIcon title={tx('অবস্থান, দায়িত্বপ্রাপ্ত ও অবস্থা বদলাতে সম্পদের পাতার "স্থানান্তর/অবস্থা" ব্যবহার করুন — এতে ইতিহাস থাকে। মূল্য ও তারিখ বদলানো যায় না।')} />}
        </Card>

        {!isEdit && (
          <Card title={tx('মূল্য ও অর্জন')} style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item name="acquisition" label={tx('অর্জনের ধরন')}>
                  <Select options={toOptions(meta.data?.acquisitions)} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="purchase_date" label={tx('ক্রয়/প্রাপ্তির তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="cost" label={tx('ক্রয়মূল্য')} rules={[required(tx('মূল্য দিন'))]}>
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} prefix="৳" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="salvage_value"
                  label={tx('অবশিষ্ট মূল্য')}
                  extra={category && cost ? tx('খালি রাখলে শ্রেণির হার ({{p0}}%): ৳{{p1}}', { p0: digits(Number(category.salvage_percent)), p1: money((cost * Number(category.salvage_percent)) / 100) }) : undefined}
                >
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="৳" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="life_months" label={tx('আয়ুষ্কাল (মাস)')} extra={category ? tx('খালি রাখলে শ্রেণির আয়ুষ্কাল: {{p0}} মাস', { p0: digits(category.life_months) }) : undefined}>
                  <InputNumber min={1} max={1200} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              {acquisition === 'opening' && (
                <>
                  <Col xs={24} md={8}>
                    <Form.Item name="opening_depreciation" label={tx('এ পর্যন্ত পুঞ্জীভূত অবচয়')}>
                      <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="৳" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="opening_date" label={tx('হিসাবে তোলার তারিখ')} extra={tx('খালি রাখলে আজকের তারিখ')}>
                      <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                    </Form.Item>
                  </Col>
                </>
              )}
              {acquisition === 'purchase' && (
                <>
                  <Col xs={24} md={8}>
                    <Form.Item name="method" label={tx('পরিশোধের মাধ্যম')}>
                      <Select options={toOptions(PAY_METHODS)} />
                    </Form.Item>
                  </Col>
                  {method !== 'cash' && method !== 'credit' && (
                    <Col xs={24} md={8}>
                      <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                        <Select
                          loading={funds.isFetching}
                          options={(funds.data ?? [])
                            .filter((f) => (method === 'bank' ? f.kind === 'bank' : true))
                            .map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))}
                        />
                      </Form.Item>
                    </Col>
                  )}
                  {method !== 'cash' && (
                    <Col xs={24} md={8}>
                      <Form.Item name="reference" label={tx('রেফারেন্স')}>
                        <Input maxLength={100} />
                      </Form.Item>
                    </Col>
                  )}
                </>
              )}
            </Row>
            <Alert
              type="info"
              showIcon
              title={
                acquisition === 'purchase'
                  ? tx('সংরক্ষণ করলে স্বয়ংক্রিয় ভাউচার হবে: সম্পদ ডেবিট, নগদ/ব্যাংক/দেনা ক্রেডিট। অবচয় ক্রয়ের মাস থেকে সরল রেখা পদ্ধতিতে।')
                  : acquisition === 'opening'
                    ? tx('পূর্বের সম্পদ প্রারম্ভিক জের সমন্বয়ের বিপরীতে হিসাবে উঠবে; অবচয় পরের মাস থেকে।')
                    : tx('অনুদানের সম্পদ সাধারণ তহবিলের বিপরীতে হিসাবে উঠবে।')
              }
            />
          </Card>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="primary" onClick={save}>
            {tx('সংরক্ষণ')}
          </Button>
          <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
        </div>
      </Form>
    </>
  )
}
