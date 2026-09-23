import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import { DownloadOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can, useAuth } from '../../auth/AuthContext'
import FarmerPicker from '../../components/FarmerPicker'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import { downloadExport, MEMBER_STATUS, toOptions, useFarmerMeta, type MemberStatus } from '../../lib/phase2'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'

type Row = {
  id: number
  member_no: number
  admitted_on: string
  status: MemberStatus
  is_legacy: boolean
  farmer: { id: number; farmer_code: string; name_bn: string; father_name: string; mobile: string | null; village: { name_bn: string } | null; mouza: { name_bn: string } | null }
}

type Action = 'deactivate' | 'activate' | 'cancel' | 'reactivate'
const ACTIONS: Record<Action, { label: string; from: MemberStatus[] }> = {
  deactivate: { label: 'নিষ্ক্রিয় করুন', from: ['active'] },
  activate: { label: 'সক্রিয় করুন', from: ['inactive'] },
  cancel: { label: 'সদস্যপদ বাতিল', from: ['active', 'inactive'] },
  reactivate: { label: 'পুনর্বহাল', from: ['cancelled'] },
}

type Params = { page: number; per_page: number; search?: string; status?: string; mouza_id?: number }

export default function MemberListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const [change, setChange] = useState<{ member: Row; action: Action } | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [statusForm] = Form.useForm()
  const [legacyForm] = Form.useForm()
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['members', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/members', { params })).data,
    placeholderData: keepPreviousData,
  })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const openChange = (member: Row, action: Action) => {
    setChange({ member, action })
    statusForm.resetFields()
    statusForm.setFieldsValue({ effective_date: dayjs() })
  }

  const submitChange = async () => {
    const v = await statusForm.validateFields()
    try {
      const r = await api.post(`/members/${change!.member.id}/status`, {
        ...v,
        action: change!.action,
        effective_date: (v.effective_date as Dayjs).format('YYYY-MM-DD'),
      })
      message.success(r.data.message)
      setChange(null)
      queryClient.invalidateQueries({ queryKey: ['members'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
    } catch (e) {
      if (!applyFormErrors(statusForm, e)) message.error(errorMessage(e))
    }
  }

  const submitLegacy = async () => {
    const v = await legacyForm.validateFields()
    try {
      await api.post('/members/legacy', { ...v, member_no: toEnDigits(String(v.member_no)), admitted_on: (v.admitted_on as Dayjs).format('YYYY-MM-DD') })
      message.success('পুরোনো সদস্য এন্ট্রি হয়েছে।')
      setLegacyOpen(false)
      legacyForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['members'] })
    } catch (e) {
      if (!applyFormErrors(legacyForm, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>সদস্য</h2>
        <Space wrap>
          <Can perm="member.export">
            <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/members/export', { ...params, page: undefined }, 'members.csv').catch((e) => message.error(errorMessage(e)))}>
              Excel
            </Button>
          </Can>
          <Can perm="member.admin">
            <Button onClick={() => setLegacyOpen(true)}>পুরোনো খাতার সদস্য এন্ট্রি</Button>
          </Can>
          <Can perm="membership.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/membership/applications/new')}>
              নতুন আবেদন
            </Button>
          </Can>
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder="সদস্য নং, নাম, পিতা বা মোবাইল" allowClear style={{ width: 280 }} onSearch={(search) => set({ search })} />
        <Select placeholder="অবস্থা" allowClear style={{ width: 140 }} options={Object.entries(MEMBER_STATUS).map(([value, s]) => ({ value, label: s.label }))} onChange={(status) => set({ status })} />
        <Select
          placeholder="মৌজা"
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          style={{ width: 180 }}
          options={mouzas.data?.map((m) => ({ value: m.id, label: m.name_bn }))}
          onChange={(mouza_id) => set({ mouza_id })}
        />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 900 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => `মোট ${digits(t)} জন`,
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: 'সদস্য নং', dataIndex: 'member_no', width: 100, render: digits },
          { title: 'নাম', render: (_, m) => <Link to={`/farmers/${m.farmer.id}`}>{m.farmer.name_bn}</Link> },
          { title: 'পিতা', render: (_, m) => m.farmer.father_name },
          { title: 'মোবাইল', render: (_, m) => digits(m.farmer.mobile) || '—' },
          { title: 'গ্রাম', render: (_, m) => m.farmer.village?.name_bn },
          { title: 'মৌজা', render: (_, m) => m.farmer.mouza?.name_bn },
          { title: 'ভর্তি', dataIndex: 'admitted_on', render: fmtDate },
          {
            title: 'অবস্থা',
            dataIndex: 'status',
            render: (s: MemberStatus, m) => (
              <>
                <Tag color={MEMBER_STATUS[s].color}>{MEMBER_STATUS[s].label}</Tag>
                {m.is_legacy && <Tag>পুরোনো</Tag>}
              </>
            ),
          },
          {
            title: '',
            width: 48,
            render: (_, m) => {
              if (!can('member.edit')) return null
              const items = (Object.entries(ACTIONS) as [Action, (typeof ACTIONS)[Action]][])
                .filter(([, a]) => a.from.includes(m.status))
                .map(([key, a]) => ({ key, label: a.label, danger: key === 'cancel', onClick: () => openChange(m, key) }))
              return (
                <Dropdown menu={{ items }} trigger={['click']}>
                  <Button type="text" icon={<MoreOutlined />} aria-label="আরও" />
                </Dropdown>
              )
            },
          },
        ]}
      />

      <Modal
        open={!!change}
        title={change ? `${ACTIONS[change.action].label} — ${change.member.farmer.name_bn} (নং ${digits(change.member.member_no)})` : ''}
        onCancel={() => setChange(null)}
        onOk={submitChange}
        okText="অনুমোদনের জন্য পাঠান"
        cancelText="বাতিল"
        okButtonProps={{ danger: change?.action === 'cancel' }}
        forceRender
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title="ম্যানেজার ও সভাপতি/বোর্ডের অনুমোদনের পর কার্যকর হবে।" />
        <Form form={statusForm} layout="vertical">
          <Form.Item name="effective_date" label="কার্যকর তারিখ" rules={[required('তারিখ দিন')]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          {change?.action === 'cancel' && (
            <>
              <Form.Item name="reason_type" label="বাতিলের কারণ" rules={[required('কারণ বাছাই করুন')]}>
                <Select options={toOptions(meta?.cancel_reasons)} />
              </Form.Item>
              <Form.Item name="resolution_no" label="সভার সিদ্ধান্ত নম্বর" rules={[required('সিদ্ধান্ত নম্বর দিন')]}>
                <Input />
              </Form.Item>
            </>
          )}
          <Form.Item name="reason" label="বিস্তারিত কারণ" rules={[required('কারণ লিখুন')]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {change?.action === 'reactivate' && (
            <Form.Item name="fee" label="পুনর্ভর্তি ফি">
              <InputNumber min={0} prefix="৳" style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal open={legacyOpen} title="পুরোনো খাতার সদস্য এন্ট্রি" onCancel={() => setLegacyOpen(false)} onOk={submitLegacy} okText="সংরক্ষণ" cancelText="বাতিল" forceRender>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title="খাতার সদস্য নম্বর হুবহু বসবে। নতুন সদস্যের নম্বর স্বয়ংক্রিয়ভাবে সবচেয়ে বড় পুরোনো নম্বরের পর থেকে চলবে।" />
        <Form form={legacyForm} layout="vertical">
          <Form.Item name="farmer_id" label="কৃষক" rules={[required('কৃষক বাছাই করুন')]}>
            <FarmerPicker type="non_member" />
          </Form.Item>
          <Form.Item name="member_no" label="খাতার সদস্য নম্বর" rules={[required('সদস্য নম্বর দিন')]}>
            <Input inputMode="numeric" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="admitted_on" label="ভর্তির তারিখ" rules={[required('তারিখ দিন')]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remarks" label="মন্তব্য">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
