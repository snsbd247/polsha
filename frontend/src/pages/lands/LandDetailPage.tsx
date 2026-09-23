import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Popconfirm, Radio, Row, Space, Spin, Table, Tabs, Tag, Timeline, Typography } from 'antd'
import { EditOutlined, SwapOutlined, UserSwitchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can, useAuth } from '../../auth/AuthContext'
import AuditLogTable from '../../components/AuditLogTable'
import FarmerPicker from '../../components/FarmerPicker'
import OwnersEditor from '../../components/OwnersEditor'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { CULTIVATION_COLOR, fmtArea, LAND_STATUS_COLOR, useLandMeta, type LandRow } from '../../lib/land'
import { required } from '../../lib/rules'
import type { AuditLog } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

type Period = { id: number; farmer_id: number; farmer: { id: number; farmer_code: string; name_bn: string; father_name: string }; start_date: string; end_date: string | null; remarks: string | null }
type LandDetail = LandRow & {
  location: string
  remarks: string | null
  owner_history: (Period & { share_percent: string })[]
  cultivation_history: (Period & { type: string; terms: string | null })[]
  patwaris: { id: number; name: string; mobile: string }[]
  created_at: string
}

export default function LandDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useLandMeta()
  const [modal, setModal] = useState<'transfer' | 'cultivation' | 'end' | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [form] = Form.useForm()

  const { data: land, isLoading } = useQuery({
    queryKey: ['lands', id],
    queryFn: async () => (await api.get<LandDetail>(`/lands/${id}`)).data,
  })
  const audit = useQuery({
    queryKey: ['lands', id, 'history', historyPage],
    queryFn: async () => (await api.get<Paginated<AuditLog>>(`/lands/${id}/history`, { params: { page: historyPage } })).data,
    placeholderData: keepPreviousData,
  })

  if (isLoading || !land) return <Spin />

  const open = (m: 'transfer' | 'cultivation' | 'end') => {
    form.resetFields()
    if (m === 'transfer') form.setFieldsValue({ effective_date: dayjs(), owners: [{ share_percent: 100 }] })
    if (m === 'cultivation') form.setFieldsValue({ start_date: dayjs(), type: land.cultivation?.type ?? 'own' })
    if (m === 'end') form.setFieldsValue({ end_date: dayjs() })
    setModal(m)
  }

  const submit = async () => {
    const v = await form.validateFields()
    const fmt = (d?: Dayjs) => d?.format('YYYY-MM-DD')
    try {
      const r =
        modal === 'transfer'
          ? await api.post<LandDetail>(`/lands/${id}/transfer`, { ...v, effective_date: fmt(v.effective_date) })
          : modal === 'cultivation'
            ? await api.post<LandDetail>(`/lands/${id}/cultivation`, { ...v, start_date: fmt(v.start_date) })
            : await api.post<LandDetail>(`/lands/${id}/cultivation/end`, { ...v, end_date: fmt(v.end_date) })
      // The endpoints return the updated land — show it immediately, then refresh lists.
      queryClient.setQueryData(['lands', id], r.data)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setModal(null)
      queryClient.invalidateQueries({ queryKey: ['lands'], predicate: (q) => q.queryKey[1] !== id })
      queryClient.invalidateQueries({ queryKey: ['farmers'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const remove = async () => {
    try {
      await api.delete(`/lands/${id}`)
      message.success(tx('মুছে ফেলা হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['lands'] })
      navigate('/lands')
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const periodText = (p: { start_date: string; end_date: string | null }) => `${fmtDate(p.start_date)} — ${p.end_date ? fmtDate(p.end_date) : tx('বর্তমান')}`

  return (
    <>
      <div className="page-header">
        <h2>
          {tx('জমি')}{' '}{land.land_code} <Tag color={LAND_STATUS_COLOR[land.status]}>{meta?.statuses[land.status]}</Tag>
        </h2>
        <Space wrap className="no-print">
          <Can perm="land.edit">
            <Button icon={<EditOutlined />} onClick={() => navigate(`/lands/${id}/edit`)}>
              {tx('সম্পাদনা')}
            </Button>
          </Can>
          <Can perm="land.delete">
            <Popconfirm title={tx('জমির রেকর্ড মুছবেন?')} okText={tx('মুছুন')} cancelText={tx('না')} onConfirm={remove}>
              <Button danger>{tx('মুছুন')}</Button>
            </Popconfirm>
          </Can>
          <Button onClick={() => window.print()}>{tx('প্রিন্ট')}</Button>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={tx('জমির তথ্য')}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label={tx('মৌজা')}>
                {land.mouza} (JL {digits(land.jl_no)}) — {land.location}
              </Descriptions.Item>
              <Descriptions.Item label={tx('জরিপ / খতিয়ান / দাগ')}>
                {meta?.surveys[land.survey]}{' '}{tx('· খতিয়ান')}{' '}{digits(land.khatian_no)}{' '}{tx('· দাগ')}{' '}{digits(land.dag_no)}
              </Descriptions.Item>
              <Descriptions.Item label={tx('পরিমাণ')}>{fmtArea(land.area_decimal, meta)}</Descriptions.Item>
              <Descriptions.Item label={tx('জমির ধরন')}>{land.land_type ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('পাতওয়ারী')}>{land.patwaris.length ? land.patwaris.map((p) => `${p.name} (${digits(p.mobile)})`).join(', ') : '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('মন্তব্য')}>{land.remarks ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={tx('এন্ট্রি')}>{fmtDateTime(land.created_at)}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={tx('বর্তমান মালিক')}
            extra={can('land.edit') && <Button size="small" icon={<SwapOutlined />} onClick={() => open('transfer')}>{tx('মালিকানা হস্তান্তর')}</Button>}
          >
            {land.owners.length ? (
              land.owners.map((o) => (
                <div key={o.id} style={{ padding: '4px 0' }}>
                  <Link to={`/farmers/${o.farmer_id}`}>{o.name_bn}</Link> <Typography.Text type="secondary">{tx('পিতা:')}{' '}{o.father_name}</Typography.Text>
                  <Tag style={{ marginInlineStart: 8 }}>{digits(o.share_percent)}%</Tag>
                  <Typography.Text type="secondary">{fmtDate(o.start_date)}{' '}{tx('থেকে')}</Typography.Text>
                </div>
              ))
            ) : (
              <Alert type="error" showIcon title={tx('কোনো মালিক নেই')} />
            )}
          </Card>
          <Card
            title={tx('চাষি')}
            style={{ marginTop: 16 }}
            extra={
              can('land.edit') && (
                <Space>
                  <Button size="small" icon={<UserSwitchOutlined />} onClick={() => open('cultivation')}>
                    {land.cultivation ? tx('চাষি পরিবর্তন') : tx('চাষি দিন')}
                  </Button>
                  {land.cultivation && (
                    <Button size="small" onClick={() => open('end')}>
                      {tx('চাষ শেষ')}
                    </Button>
                  )}
                </Space>
              )
            }
          >
            {land.cultivation ? (
              <>
                <Link to={`/farmers/${land.cultivation.farmer_id}`}>{land.cultivation.name_bn}</Link>{' '}
                <Typography.Text type="secondary">{tx('পিতা:')}{' '}{land.cultivation.father_name}</Typography.Text>{' '}
                <Tag color={CULTIVATION_COLOR[land.cultivation.type]}>{meta?.cultivation_types[land.cultivation.type]}</Tag>
                <div>
                  <Typography.Text type="secondary">{fmtDate(land.cultivation.start_date)}{' '}{tx('থেকে')}</Typography.Text>
                  {land.cultivation.terms && <div>{tx('শর্ত:')}{' '}{land.cultivation.terms}</div>}
                </div>
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('এখন কোনো চাষি নেই')} />
            )}
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 16 }}>
        <Tabs
          items={[
            {
              key: 'owners',
              label: tx('মালিকানার ইতিহাস'),
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={land.owner_history}
                  scroll={{ x: 600 }}
                  columns={[
                    { title: tx('মালিক'), render: (_, o) => <Link to={`/farmers/${o.farmer_id}`}>{o.farmer.name_bn}</Link> },
                    { title: tx('পিতা'), render: (_, o) => o.farmer.father_name },
                    { title: tx('অংশ'), dataIndex: 'share_percent', render: (v) => `${digits(Number(v))}%` },
                    { title: tx('সময়কাল'), render: (_, o) => (o.end_date ? periodText(o) : <Tag color="green">{periodText(o)}</Tag>) },
                    { title: tx('মন্তব্য'), dataIndex: 'remarks' },
                  ]}
                />
              ),
            },
            {
              key: 'cultivation',
              label: tx('চাষের ইতিহাস'),
              children: land.cultivation_history.length ? (
                <Timeline
                  items={land.cultivation_history.map((c) => ({
                    color: c.end_date ? 'gray' : CULTIVATION_COLOR[c.type],
                    content: (
                      <>
                        <Link to={`/farmers/${c.farmer_id}`}>{c.farmer.name_bn}</Link> — {meta?.cultivation_types[c.type]}
                        <div>{periodText(c)}</div>
                        {c.terms && <div>{tx('শর্ত:')}{' '}{c.terms}</div>}
                        {c.remarks && <Typography.Text type="secondary">{c.remarks}</Typography.Text>}
                      </>
                    ),
                  }))}
                />
              ) : (
                <Empty description={tx('চাষের কোনো রেকর্ড নেই')} />
              ),
            },
            {
              key: 'audit',
              label: tx('পরিবর্তনের লগ'),
              children: <AuditLogTable data={audit.data} loading={audit.isFetching} page={historyPage} onPage={setHistoryPage} />,
            },
          ]}
        />
      </Card>

      <Modal
        open={!!modal}
        forceRender
        width={modal === 'transfer' ? 640 : 520}
        title={{ transfer: tx('মালিকানা হস্তান্তর'), cultivation: land.cultivation ? tx('চাষি পরিবর্তন') : tx('চাষি দিন'), end: tx('চাষ শেষ') }[modal ?? 'end']}
        onCancel={() => setModal(null)}
        onOk={submit}
        okText={tx('সংরক্ষণ')}
        cancelText={tx('বাতিল')}
      >
        <Form form={form} layout="vertical">
          {modal === 'transfer' && (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('বর্তমান মালিকানা এই তারিখে শেষ হবে এবং নতুন মালিকানা শুরু হবে। \'নিজ চাষ\' করা চাষি নতুন মালিকদের মধ্যে না থাকলে তার চাষও শেষ হবে।')} />
              <OwnersEditor />
              <Form.Item name="effective_date" label={tx('কার্যকর তারিখ')} rules={[required(tx('তারিখ দিন'))]} style={{ marginTop: 12 }}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
              <Form.Item name="remarks" label={tx('মন্তব্য (দলিল নং ইত্যাদি)')}>
                <Input />
              </Form.Item>
            </>
          )}
          {modal === 'cultivation' && (
            <>
              <Form.Item name="type" label={tx('চাষের ধরন')}>
                <Radio.Group options={Object.entries(meta?.cultivation_types ?? {}).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="farmer_id" label={tx('নতুন চাষি')} rules={[required(tx('চাষি বাছাই করুন'))]}>
                <FarmerPicker />
              </Form.Item>
              <Form.Item name="terms" label={tx('শর্ত')}>
                <Input />
              </Form.Item>
              <Form.Item name="start_date" label={tx('শুরুর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
            </>
          )}
          {modal === 'end' && (
            <>
              <Form.Item name="end_date" label={tx('শেষের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
              <Form.Item name="remarks" label={tx('কারণ')}>
                <Input />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  )
}
