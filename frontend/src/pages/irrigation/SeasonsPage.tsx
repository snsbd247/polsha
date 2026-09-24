import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Col, DatePicker, Form, Input, Modal, Progress, Row, Select, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { SEASON_STATUS_COLOR, type Season } from '../../lib/irrigation'
import { toOptions } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'

const DATES = ['start_date', 'end_date', 'due_date'] as const

export default function SeasonsPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Season | 'new' | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({
    queryKey: ['seasons'],
    queryFn: async () => (await api.get<{ data: Season[]; statuses: Record<string, string> }>('/seasons')).data,
  })

  const open = (s: Season | 'new') => {
    setEditing(s)
    form.resetFields()
    if (s === 'new') form.setFieldsValue({ status: 'planned' })
    else form.setFieldsValue({ ...s, ...Object.fromEntries(DATES.map((k) => [k, s[k] ? dayjs(s[k]) : null])) })
  }

  const save = async () => {
    const v = await form.validateFields()
    const payload = { ...v, ...Object.fromEntries(DATES.map((k) => [k, (v[k] as Dayjs | null)?.format('YYYY-MM-DD') ?? null])) }
    try {
      if (editing === 'new') await api.post('/seasons', payload)
      else await api.put(`/seasons/${(editing as Season).id}`, payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['seasons'] })
      queryClient.invalidateQueries({ queryKey: ['invoice-meta'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('মৌসুম')}</h2>
        <Can perm="irrigation.edit">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {tx('নতুন মৌসুম')}
          </Button>
        </Can>
      </div>
      <Table<Season>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.data}
        pagination={false}
        scroll={{ x: 1000 }}
        columns={[
          { title: tx('মৌসুম'), dataIndex: 'name_bn', render: (v, s) => <Link to={`/irrigation/rates?season_id=${s.id}`}>{v}</Link> },
          { title: tx('ফসল'), dataIndex: 'crop' },
          { title: tx('সময়কাল'), render: (_, s) => `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}` },
          { title: tx('পরিশোধের শেষ তারিখ'), dataIndex: 'due_date', render: fmtDate },
          { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag color={SEASON_STATUS_COLOR[v]}>{data?.statuses[v] ?? v}</Tag> },
          { title: tx('ইনভয়েস'), dataIndex: 'invoice_count', align: 'right', render: (v, s) => <Link to={`/irrigation/invoices?season_id=${s.id}`}>{digits(v)}</Link> },
          { title: tx('বিল (টাকা)'), dataIndex: 'billed', align: 'right', render: money },
          { title: tx('আদায় (টাকা)'), dataIndex: 'collected', align: 'right', render: money },
          {
            title: tx('আদায়ের হার'),
            width: 140,
            render: (_, s) => <Progress size="small" percent={s.billed ? Math.round((s.collected / s.billed) * 100) : 0} format={(p) => digits(p ?? 0) + '%'} />,
          },
          {
            title: '',
            width: 100,
            render: (_, s) => (
              <Can perm="irrigation.edit">
                <Button onClick={() => open(s)}>{tx('সম্পাদনা')}</Button>
              </Can>
            ),
          },
        ]}
      />
      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন মৌসুম') : tx('মৌসুম সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label={tx('নাম')} rules={[required(tx('নাম দিন'))]} extra={tx('যেমন: বোরো ২০২৬')}>
            <Input />
          </Form.Item>
          <Form.Item name="crop" label={tx('ফসল')}>
            <Input placeholder={tx('যেমন: বোরো ধান')} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="start_date" label={tx('শুরুর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="end_date" label={tx('শেষের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="due_date" label={tx('পরিশোধের শেষ তারিখ')} extra={tx('এই তারিখের পর বকেয়া "মেয়াদোত্তীর্ণ" দেখাবে')}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label={tx('অবস্থা')} extra={tx('বন্ধ মৌসুমে নতুন ইনভয়েস করা যায় না')}>
            <Select options={toOptions(data?.statuses)} />
          </Form.Item>
          <Form.Item name="remarks" label={tx('মন্তব্য')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
