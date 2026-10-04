import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { App, Button, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select } from 'antd'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { useWaterMeta, type WaterConnection } from '../../lib/water'

type Values = Omit<WaterConnection, 'connected_on' | 'id' | 'connection_no' | 'status' | 'status_date' | 'status_reason'> & { connected_on: Dayjs; connection_fee?: number }

/** New connection (with its connection fee) or edit of the customer's details. */
export default function ConnectionForm({ open, connection, onClose, onSaved }: { open: boolean; connection?: WaterConnection | null; onClose: () => void; onSaved: (c: WaterConnection) => void }) {
  const [form] = Form.useForm<Values>()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const { data: meta } = useWaterMeta()
  const villages = useQuery({
    queryKey: ['villages', 'all'],
    queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { active_only: 1 } })).data,
    enabled: open,
  })
  const typeId = Form.useWatch('type_id', form)
  const type = meta?.types.find((t) => t.id === typeId)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (connection) form.setFieldsValue({ ...connection, monthly_fee: connection.monthly_fee, connected_on: dayjs(connection.connected_on) })
    else form.setFieldsValue({ connected_on: dayjs() })
  }, [open, connection, form])

  // a new connection starts with its type's connection fee
  useEffect(() => {
    if (!connection && type) form.setFieldValue('connection_fee', Number(type.connection_fee))
  }, [type, connection, form])

  const save = async (v: Values) => {
    setSaving(true)
    try {
      const body = { ...v, connected_on: v.connected_on.format('YYYY-MM-DD'), monthly_fee: v.monthly_fee ?? null }
      const r = connection ? await api.put<WaterConnection>(`/water/connections/${connection.id}`, body) : await api.post<WaterConnection>('/water/connections', body)
      message.success(connection ? tx('সংযোগের তথ্য সংরক্ষণ হয়েছে।') : tx('নতুন সংযোগ খোলা হয়েছে: {{p0}}', { p0: r.data.connection_no }))
      queryClient.invalidateQueries({ queryKey: ['water'] })
      onSaved(r.data)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={560}
      title={connection ? tx('সংযোগ সম্পাদনা — {{p0}}', { p0: connection.connection_no }) : tx('নতুন পানির সংযোগ')}
      extra={
        <Button type="primary" loading={saving} onClick={() => form.submit()}>
          {tx('সংরক্ষণ')}
        </Button>
      }
    >
      <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="name_bn" label={tx('গ্রাহকের নাম (বাংলা)')} rules={[{ required: true, message: tx('নাম দিন') }]}>
              <Input maxLength={150} autoFocus />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
              <Input maxLength={150} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="father_name" label={tx('পিতা/স্বামীর নাম')}>
              <Input maxLength={150} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="mobile" label={tx('মোবাইল')}>
              <Input maxLength={14} inputMode="tel" placeholder="01XXXXXXXXX" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="village_id" label={tx('গ্রাম')}>
              <Select allowClear showSearch={{ optionFilterProp: 'label' }} loading={villages.isLoading} options={villages.data?.map((v) => ({ value: v.id, label: nameOf(v) }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="address" label={tx('পাড়া / বাড়ি')}>
              <Input maxLength={250} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="type_id" label={tx('সংযোগের ধরন')} rules={[{ required: true, message: tx('ধরন বাছাই করুন') }]}>
              <Select
                options={meta?.types
                  .filter((t) => t.is_active || t.id === connection?.type_id)
                  .map((t) => ({ value: t.id, label: `${nameOf(t)} — ${tx('মাসিক ৳{{p0}}', { p0: money(t.monthly_fee) })}` }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="connected_on" label={tx('সংযোগের তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="monthly_fee" label={tx('আলাদা মাসিক ফি (ঐচ্ছিক)')} extra={type ? tx('খালি থাকলে ধরনের ফি: ৳{{p0}}', { p0: money(type.monthly_fee) }) : undefined}>
              <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
            </Form.Item>
          </Col>
          {!connection && (
            <Col xs={24} md={12}>
              <Form.Item name="connection_fee" label={tx('সংযোগ ফি')} extra={tx('০ দিলে কোনো ফি-র বিল হবে না।')}>
                <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
              </Form.Item>
            </Col>
          )}
          <Col xs={24}>
            <Form.Item name="nid" label={tx('NID (ঐচ্ছিক)')}>
              <Input maxLength={17} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="remarks" label={tx('মন্তব্য')}>
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Drawer>
  )
}
