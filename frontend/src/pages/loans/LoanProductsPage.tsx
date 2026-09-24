import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Switch, Table, Tag } from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { toOptions } from '../../lib/funds'
import { useLoanMeta, useLoanProducts, type LoanProduct, type ScheduleRow } from '../../lib/loans'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import SchedulePreview from './SchedulePreview'

const DEFAULTS = { category: 'agriculture', interest_method: 'flat', frequency: 'monthly', installments: 12, penalty_rate: 2, grace_days: 7, guarantors_required: 1, is_active: true }

export default function LoanProductsPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useLoanMeta()
  const { data, isFetching } = useLoanProducts()
  const [editing, setEditing] = useState<LoanProduct | 'new' | null>(null)
  const [form] = Form.useForm()
  const terms = Form.useWatch([], form) as Partial<LoanProduct> | undefined
  const oneTime = terms?.frequency === 'one_time'

  useEffect(() => {
    if (!editing) return
    form.resetFields()
    form.setFieldsValue(editing === 'new' ? DEFAULTS : { ...editing, max_amount: Number(editing.max_amount) })
  }, [editing, form])

  // sample schedule for 10,000 or the product maximum, whichever is smaller
  const sample = Math.min(10000, Number(terms?.max_amount) || 10000)
  const previewParams = terms && terms.interest_rate != null && terms.frequency && (oneTime ? terms.term_months : terms.installments)
    ? { amount: sample, interest_rate: terms.interest_rate, interest_method: terms.interest_method, frequency: terms.frequency, installments: oneTime ? 1 : terms.installments, term_months: oneTime ? terms.term_months : undefined }
    : null
  const preview = useQuery({
    queryKey: ['loan-product-preview', previewParams],
    queryFn: async () => (await api.get<{ rows: ScheduleRow[]; total_interest: number }>('/loan-products/preview', { params: previewParams })).data,
    enabled: !!editing && !!previewParams,
  })

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      if (editing === 'new') await api.post('/loan-products', v)
      else if (editing) await api.put(`/loan-products/${editing.id}`, v)
      message.success(tx('সংরক্ষণ হয়েছে'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['loan-products'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('ঋণের ধরন (Loan Product)')}</h2>
        {can('loan.edit') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {tx('নতুন ঋণের ধরন')}
          </Button>
        )}
      </div>
      <Table<LoanProduct>
        rowKey="id"
        loading={isFetching}
        dataSource={data}
        pagination={false}
        scroll={{ x: 1100 }}
        columns={[
          { title: tx('কোড'), dataIndex: 'code', width: 90 },
          { title: tx('নাম'), render: (_, r) => nameOf(r) },
          { title: tx('ধরন'), dataIndex: 'category', render: (v: string) => meta.data?.categories[v] ?? v },
          { title: tx('সর্বোচ্চ'), dataIndex: 'max_amount', align: 'right', render: money },
          { title: tx('জমার গুণিতক'), dataIndex: 'savings_multiplier', align: 'right', render: (v) => (v === null ? '—' : `${digits(Number(v))}×`) },
          { title: tx('সুদ (বার্ষিক)'), render: (_, r) => `${digits(Number(r.interest_rate))}% · ${meta.data?.methods[r.interest_method] ?? r.interest_method}` },
          {
            title: tx('কিস্তি'),
            render: (_, r) =>
              r.frequency === 'one_time'
                ? `${meta.data?.frequencies[r.frequency]} — ${tx('{{p0}} মাস', { p0: digits(r.term_months ?? '') })}`
                : `${digits(r.installments)} × ${meta.data?.frequencies[r.frequency] ?? r.frequency}`,
          },
          { title: tx('জরিমানা'), render: (_, r) => tx('{{p0}}%/মাস, ছাড় {{p1}} দিন', { p0: digits(Number(r.penalty_rate)), p1: digits(r.grace_days) }) },
          { title: tx('জামিনদার'), dataIndex: 'guarantors_required', align: 'right', render: (v: number) => digits(v) },
          { title: tx('চলমান ঋণ'), dataIndex: 'running', align: 'right', render: (v: number) => digits(v ?? 0) },
          { title: tx('অবস্থা'), dataIndex: 'is_active', render: (v: boolean) => (v ? <Tag color="green">{tx('চালু')}</Tag> : <Tag>{tx('বন্ধ')}</Tag>) },
          ...(can('loan.edit') ? [{ title: '', width: 60, render: (_: unknown, r: LoanProduct) => <Button size="small" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} onClick={() => setEditing(r)} /> }] : []),
        ]}
      />

      <Modal open={!!editing} forceRender width={900} title={editing === 'new' ? tx('নতুন ঋণের ধরন') : tx('ঋণের ধরন সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('ফিরে যান')}>
        {editing && editing !== 'new' && (editing.running ?? 0) > 0 && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('চলমান ঋণগুলো আগের শর্তেই চলবে; পরিবর্তন শুধু নতুন আবেদনে প্রযোজ্য।')} />
        )}
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={6}>
              <Form.Item name="code" label={tx('কোড')} rules={[required(tx('কোড দিন'))]}>
                <Input maxLength={20} />
              </Form.Item>
            </Col>
            <Col xs={24} md={9}>
              <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
                <Input maxLength={150} />
              </Form.Item>
            </Col>
            <Col xs={24} md={9}>
              <Form.Item name="name_en" label={tx('নাম (English)')}>
                <Input maxLength={150} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="category" label={tx('ধরন')} rules={[required(tx('বাছাই করুন'))]}>
                <Select options={toOptions(meta.data?.categories)} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="max_amount" label={tx('সর্বোচ্চ ঋণ')} rules={[required(tx('টাকার পরিমাণ দিন'))]}>
                <InputNumber min={1} precision={2} style={{ width: '100%' }} prefix="৳" />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="savings_multiplier" label={tx('সঞ্চয়+শেয়ারের গুণিতক')} tooltip={tx('ঋণসীমা = সর্বোচ্চ ঋণ ও (গুণিতক × সঞ্চয়+শেয়ার) — যেটি কম। খালি রাখলে শুধু সর্বোচ্চ ঋণ।')}>
                <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} suffix="×" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="interest_rate" label={tx('সুদের হার (বার্ষিক %)')} rules={[required(tx('সুদের হার দিন'))]}>
                <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} suffix="%" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="interest_method" label={tx('সুদের পদ্ধতি')}>
                <Select options={toOptions(meta.data?.methods)} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="frequency" label={tx('কিস্তির ধরন')}>
                <Select options={toOptions(meta.data?.frequencies)} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              {oneTime ? (
                <Form.Item name="term_months" label={tx('মেয়াদ (মাস)')} rules={[required(tx('মেয়াদ দিন'))]}>
                  <InputNumber min={1} max={120} style={{ width: '100%' }} />
                </Form.Item>
              ) : (
                <Form.Item name="installments" label={tx('কিস্তির সংখ্যা')} rules={[required(tx('কিস্তির সংখ্যা দিন'))]}>
                  <InputNumber min={1} max={520} style={{ width: '100%' }} />
                </Form.Item>
              )}
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="penalty_rate" label={tx('জরিমানা (মাসিক %)')} tooltip={tx('মেয়াদোত্তীর্ণ কিস্তির বকেয়ার উপর, দিন হিসাবে।')} rules={[required(tx('হার দিন'))]}>
                <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} suffix="%" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="grace_days" label={tx('ছাড়ের দিন')} rules={[required(tx('দিন দিন'))]}>
                <InputNumber min={0} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="guarantors_required" label={tx('জামিনদার লাগবে')} rules={[required(tx('সংখ্যা দিন'))]}>
                <InputNumber min={0} max={5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="is_active" label={tx('চালু')} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label={tx('বিবরণ')}>
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <h4>{tx('নমুনা কিস্তির তালিকা (৳{{p0}})', { p0: money(sample) })}</h4>
        <SchedulePreview rows={preview.data?.rows} loading={preview.isFetching} />
      </Modal>
    </>
  )
}
