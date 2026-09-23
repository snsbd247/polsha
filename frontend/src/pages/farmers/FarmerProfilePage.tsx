import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tabs, Tag, Timeline, Typography, Upload } from 'antd'
import { EditOutlined, PrinterOutlined, UploadOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import AuditLogTable from '../../components/AuditLogTable'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, fmtDateTime, fmtBytes } from '../../lib/format'
import { APPLICATION_STATUS, MEMBER_STATUS, openProtectedFile, toOptions, useFarmerMeta, type MemberStatus } from '../../lib/phase2'
import type { AuditLog } from '../../lib/types'

type HistoryRow = { id: number; action: string; from_status: string | null; to_status: string; effective_date: string; reason: string | null; resolution_no: string | null; fee: string | null; creator: { name_bn: string } | null }

type FarmerDetail = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string
  mother_name: string | null
  spouse_name: string | null
  gender: string
  date_of_birth: string | null
  nid: string | null
  birth_reg_no: string | null
  mobile: string | null
  alt_mobile: string | null
  address: string
  mouza: string | null
  post_office: string | null
  occupation: string | null
  remarks: string | null
  is_active: boolean
  photo_url: string | null
  household: { id: number; code: string; head: { id: number; name_bn: string } | null } | null
  household_relation: string | null
  member: { id: number; member_no: number; status: MemberStatus } | null
  member_detail: {
    id: number
    member_no: number
    admitted_on: string
    status: MemberStatus
    is_legacy: boolean
    history: HistoryRow[]
    nominees: { id: number; name: string; relation: string; share_percent: string }[]
  } | null
  applications: { id: number; application_no: string; applied_on: string; status: string }[]
  merged_into: { id: number; farmer_code: string; name_bn: string } | null
  created_at: string
}

type Doc = { id: number; type: string; original_name: string; size: number; remarks: string | null; created_at: string; uploader: { name_bn: string } | null }

const ACTION: Record<string, string> = {
  admit: 'সদস্যপদ অনুমোদন',
  legacy: 'পুরোনো খাতা থেকে এন্ট্রি',
  deactivate: 'নিষ্ক্রিয়',
  activate: 'সক্রিয়',
  cancel: 'সদস্যপদ বাতিল',
  reactivate: 'পুনর্বহাল',
}

function DocumentsTab({ farmerId }: { farmerId: number }) {
  const { can } = useAuth()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [form] = Form.useForm()
  const [file, setFile] = useState<File | null>(null)
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['farmers', farmerId, 'documents'],
    queryFn: async () => (await api.get<Doc[]>(`/farmers/${farmerId}/documents`)).data,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['farmers', farmerId, 'documents'] })

  const upload = async () => {
    const v = await form.validateFields()
    if (!file) {
      message.error('ফাইল বাছাই করুন।')
      return
    }
    const fd = new FormData()
    fd.append('type', v.type)
    fd.append('file', file)
    if (v.remarks) fd.append('remarks', v.remarks)
    try {
      await api.post(`/farmers/${farmerId}/documents`, fd)
      message.success('আপলোড হয়েছে।')
      setOpen(false)
      setFile(null)
      form.resetFields()
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const remove = (d: Doc) =>
    modal.confirm({
      title: 'ডকুমেন্ট মুছবেন?',
      okText: 'মুছুন',
      okButtonProps: { danger: true },
      cancelText: 'না',
      onOk: async () => {
        await api.delete(`/farmers/${farmerId}/documents/${d.id}`)
        refresh()
      },
    })

  return (
    <>
      <Can perm="farmer.edit">
        <Button icon={<UploadOutlined />} style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
          ডকুমেন্ট আপলোড
        </Button>
      </Can>
      <Table<Doc>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 600 }}
        locale={{ emptyText: 'কোনো ডকুমেন্ট নেই' }}
        columns={[
          { title: 'ধরন', dataIndex: 'type', render: (t) => meta?.document_types[t] ?? t },
          { title: 'ফাইল', dataIndex: 'original_name' },
          { title: 'আকার', dataIndex: 'size', render: fmtBytes },
          { title: 'আপলোড', render: (_, d) => `${d.uploader?.name_bn ?? ''} · ${fmtDate(d.created_at)}` },
          {
            title: '',
            render: (_, d) => (
              <Space>
                <Button size="small" onClick={() => openProtectedFile(`/farmers/${farmerId}/documents/${d.id}`).catch((e) => message.error(errorMessage(e)))}>
                  দেখুন
                </Button>
                {can('farmer.edit') && (
                  <Button size="small" danger onClick={() => remove(d)}>
                    মুছুন
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title="ডকুমেন্ট আপলোড" onCancel={() => setOpen(false)} onOk={upload} okText="আপলোড" cancelText="বাতিল" forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="ধরন" rules={[{ required: true, message: 'ধরন দিন' }]}>
            <Select options={toOptions(meta?.document_types)} />
          </Form.Item>
          <Form.Item label="ফাইল (JPG, PNG বা PDF; সর্বোচ্চ ৫MB)" required>
            <Upload accept=".jpg,.jpeg,.png,.pdf" maxCount={1} beforeUpload={(f) => (setFile(f), false)} onRemove={() => setFile(null)}>
              <Button icon={<UploadOutlined />}>ফাইল বাছাই</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="remarks" label="মন্তব্য">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function HistoryTab({ farmerId }: { farmerId: number }) {
  const [page, setPage] = useState(1)
  const { data, isFetching } = useQuery({
    queryKey: ['farmers', farmerId, 'history', page],
    queryFn: async () => (await api.get<Paginated<AuditLog>>(`/farmers/${farmerId}/history`, { params: { page } })).data,
    placeholderData: keepPreviousData,
  })
  return <AuditLogTable data={data} loading={isFetching} page={page} onPage={setPage} />
}

export default function FarmerProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data: meta } = useFarmerMeta()

  const { data: f, isLoading } = useQuery({
    queryKey: ['farmers', id],
    queryFn: async () => (await api.get<FarmerDetail>(`/farmers/${id}`)).data,
  })

  if (isLoading || !f) return <Spin />
  const m = f.member_detail

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Space align="start" size={16} wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space align="start" size={16}>
            <ProtectedImage url={f.photo_url} size={88} />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {f.name_bn} {f.name_en && <Typography.Text type="secondary">({f.name_en})</Typography.Text>}
              </Typography.Title>
              <div>পিতা: {f.father_name}</div>
              <Space wrap style={{ marginTop: 8 }}>
                <Tag>{f.farmer_code}</Tag>
                {f.member ? (
                  <Tag color={MEMBER_STATUS[f.member.status].color}>
                    সদস্য নং {digits(f.member.member_no)} · {MEMBER_STATUS[f.member.status].label}
                  </Tag>
                ) : (
                  <Tag>নন-মেম্বার</Tag>
                )}
                {!f.is_active && <Tag color="red">নিষ্ক্রিয়</Tag>}
              </Space>
            </div>
          </Space>
          <Space wrap className="no-print">
            {can('farmer.edit') && !f.merged_into && (
              <Button icon={<EditOutlined />} onClick={() => navigate(`/farmers/${f.id}/edit`)}>
                সম্পাদনা
              </Button>
            )}
            {can('membership.create') && !f.member && f.is_active && !f.merged_into && (
              <Button type="primary" onClick={() => navigate(`/membership/applications/new?farmer=${f.id}`)}>
                সদস্য করুন
              </Button>
            )}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              প্রিন্ট
            </Button>
          </Space>
        </Space>
        {f.merged_into && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            title={
              <>
                এই রেকর্ডটি <Link to={`/farmers/${f.merged_into.id}`}>{f.merged_into.farmer_code} ({f.merged_into.name_bn})</Link>-এর সাথে মার্জ করা হয়েছে।
              </>
            }
          />
        )}
      </Card>

      <Card>
        <Tabs
          items={[
            {
              key: 'summary',
              label: 'সারসংক্ষেপ',
              children: (
                <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                  <Descriptions.Item label="মাতা">{f.mother_name ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="স্বামী/স্ত্রী">{f.spouse_name ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="লিঙ্গ">{meta?.genders[f.gender] ?? f.gender}</Descriptions.Item>
                  <Descriptions.Item label="জন্মতারিখ">{fmtDate(f.date_of_birth)}</Descriptions.Item>
                  <Descriptions.Item label="NID">{digits(f.nid) || '—'}</Descriptions.Item>
                  <Descriptions.Item label="জন্ম নিবন্ধন">{digits(f.birth_reg_no) || '—'}</Descriptions.Item>
                  <Descriptions.Item label="মোবাইল">{digits(f.mobile) || '—'}</Descriptions.Item>
                  <Descriptions.Item label="বিকল্প মোবাইল">{digits(f.alt_mobile) || '—'}</Descriptions.Item>
                  <Descriptions.Item label="ঠিকানা">{f.address}</Descriptions.Item>
                  <Descriptions.Item label="ডাকঘর">{f.post_office ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="মৌজা">{f.mouza ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="পেশা">{f.occupation ? meta?.occupations[f.occupation] : '—'}</Descriptions.Item>
                  <Descriptions.Item label="মন্তব্য" span="filled">
                    {f.remarks ?? '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="নিবন্ধন" span="filled">{fmtDateTime(f.created_at)}</Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'membership',
              label: 'সদস্যপদ',
              children: m ? (
                <>
                  <Descriptions bordered size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 16 }}>
                    <Descriptions.Item label="সদস্য নং">{digits(m.member_no)}</Descriptions.Item>
                    <Descriptions.Item label="ভর্তির তারিখ">{fmtDate(m.admitted_on)}</Descriptions.Item>
                    <Descriptions.Item label="অবস্থা">
                      <Tag color={MEMBER_STATUS[m.status].color}>{MEMBER_STATUS[m.status].label}</Tag>
                      {m.is_legacy && <Tag>পুরোনো খাতা</Tag>}
                    </Descriptions.Item>
                    <Descriptions.Item label="নমিনি" span="filled">
                      {m.nominees.length ? m.nominees.map((n) => `${n.name} (${n.relation}, ${digits(Number(n.share_percent))}%)`).join(', ') : '—'}
                    </Descriptions.Item>
                  </Descriptions>
                  <Typography.Title level={5}>সদস্যপদের ইতিহাস</Typography.Title>
                  <Timeline
                    items={m.history.map((h) => ({
                      color: h.to_status === 'active' ? 'green' : h.to_status === 'cancelled' ? 'red' : 'orange',
                      content: (
                        <>
                          <strong>{ACTION[h.action] ?? h.action}</strong> · কার্যকর {fmtDate(h.effective_date)}
                          {h.reason && <div>কারণ: {h.reason}</div>}
                          {h.resolution_no && <div>সভার সিদ্ধান্ত: {h.resolution_no}</div>}
                          {h.fee && Number(h.fee) > 0 && <div>ফি: ৳ {digits(Number(h.fee))}</div>}
                          {h.creator && <Typography.Text type="secondary">{h.creator.name_bn}</Typography.Text>}
                        </>
                      ),
                    }))}
                  />
                </>
              ) : (
                <>
                  <Empty description="সদস্য নন" />
                  {f.applications.length > 0 && (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={f.applications}
                      columns={[
                        { title: 'আবেদন নং', dataIndex: 'application_no', render: (v, a) => <Link to={`/membership/applications/${a.id}`}>{v}</Link> },
                        { title: 'তারিখ', dataIndex: 'applied_on', render: fmtDate },
                        { title: 'অবস্থা', dataIndex: 'status', render: (s) => <Tag color={APPLICATION_STATUS[s]?.color}>{APPLICATION_STATUS[s]?.label}</Tag> },
                      ]}
                    />
                  )}
                </>
              ),
            },
            { key: 'documents', label: 'ডকুমেন্ট', children: <DocumentsTab farmerId={f.id} /> },
            {
              key: 'household',
              label: 'খানা',
              children: f.household ? (
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="খানা">
                    <Link to={`/households?open=${f.household.id}`}>{f.household.code}</Link>
                  </Descriptions.Item>
                  <Descriptions.Item label="খানাপ্রধান">{f.household.head?.name_bn ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="সম্পর্ক">{f.household_relation ? meta?.relations[f.household_relation] : '—'}</Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty description="কোনো খানার সাথে যুক্ত নয়" />
              ),
            },
            { key: 'land', label: 'জমি', children: <Empty description="জমির তথ্য ফেজ ৩-এ যুক্ত হবে" /> },
            { key: 'finance', label: 'আর্থিক তথ্য', children: <Empty description="সেচ, সঞ্চয়, শেয়ার ও ঋণের তথ্য ফেজ ৫–৭-এ যুক্ত হবে" /> },
            ...(can('farmer.view') ? [{ key: 'history', label: 'ইতিহাস', children: <HistoryTab farmerId={f.id} /> }] : []),
          ]}
        />
      </Card>
    </>
  )
}
