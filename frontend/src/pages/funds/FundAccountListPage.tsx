import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tag } from 'antd'
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import FundMemberPicker from '../../components/FundMemberPicker'
import RelatedLinks from '../../components/RelatedLinks'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { ACCOUNTS_TITLE, KIND_LABEL, toOptions, useFundMeta, type FundKind, type MemberBrief } from '../../lib/funds'
import { MEMBER_STATUS, downloadExport, type MemberStatus } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type Row = {
  id: number
  account_no: string
  opened_on: string
  status: string
  balance: string
  held: string | null
  member: (MemberBrief & { farmer: MemberBrief['farmer'] & { father_name: string; mobile: string | null } }) | null
}
type Resp = Paginated<Row> & { totals: { accounts: number; balance: number }; ledger_balance: number; book_balance: number }
type Params = { page: number; per_page: number; search?: string; status?: string; member_status?: string }

export default function FundAccountListPage({ kind }: { kind: FundKind }) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const meta = useFundMeta(kind)
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const [opening, setOpening] = useState(false)
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['fund-accounts', kind, params],
    queryFn: async () => (await api.get<Resp>(`/funds/${kind}/accounts`, { params })).data,
    placeholderData: keepPreviousData,
  })
  const diff = data ? Math.round((data.ledger_balance - data.book_balance) * 100) / 100 : 0

  const open = async () => {
    const v = await form.validateFields()
    try {
      const res = await api.post<{ id: number }>(`/funds/${kind}/accounts`, { ...v, opened_on: (v.opened_on as Dayjs).format('YYYY-MM-DD') })
      message.success(tx('হিসাব খোলা হয়েছে।'))
      setOpening(false)
      queryClient.invalidateQueries({ queryKey: ['fund-accounts', kind] })
      navigate(`/funds/${kind}/accounts/${res.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{ACCOUNTS_TITLE[kind]}</h2>
        <Space wrap>
          <RelatedLinks links={[{ to: `/funds/${kind}/transactions`, label: tx('লেনদেন') }, { to: `/funds/${kind}/audit`, label: kind === 'share' ? tx('শেয়ার মূলধন মিলকরণ') : tx('সঞ্চয় অডিট') }, { to: '/funds/distributions', label: tx('মুনাফা ও লভ্যাংশ') }]} />
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport(`/funds/${kind}/accounts`, { ...params, page: undefined, export: 'csv' }, `${kind}-accounts.csv`).catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
          <Can perm={`${kind}.create`}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => (form.resetFields(), setOpening(true))}>
              {tx('নতুন {{p0}} হিসাব', { p0: KIND_LABEL[kind] })}
            </Button>
          </Can>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('হিসাব অনুযায়ী মোট জের')} value={money(data?.book_balance)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('লেজারে জের')} value={money(data?.ledger_balance)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('পার্থক্য')} value={money(diff)} prefix="৳" styles={{ content: { color: diff ? '#cf1322' : '#389e0d' } }} />
          </Card>
        </Col>
      </Row>

      <div className="toolbar">
        <Input.Search placeholder={tx('হিসাব নং, সদস্য নং, নাম বা মোবাইল')} allowClear style={{ width: 260 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('হিসাবের অবস্থা')} allowClear style={{ width: 160 }} options={toOptions(meta.data?.account_statuses)} onChange={(status) => set({ status })} />
        <Select placeholder={tx('সদস্যের অবস্থা')} allowClear style={{ width: 170 }} options={Object.entries(MEMBER_STATUS).map(([value, v]) => ({ value, label: v.label }))} onChange={(member_status) => set({ member_status })} />
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
          showTotal: () => tx('মোট {{p0}}টি হিসাব, জের ৳{{p1}}', { p0: digits(data?.totals.accounts ?? 0), p1: money(data?.totals.balance) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('হিসাব নং'), dataIndex: 'account_no', width: 130, render: (v: string, r) => <Link to={`/funds/${kind}/accounts/${r.id}`}>{digits(v)}</Link> },
          { title: tx('সদস্য নং'), width: 90, render: (_, r) => digits(r.member?.member_no) },
          {
            title: tx('নাম'),
            render: (_, r) =>
              r.member?.farmer ? (
                <Space orientation="vertical" size={0}>
                  <Link to={`/farmers/${r.member.farmer.id}`}>{nameOf(r.member.farmer)}</Link>
                  <small>{tx('পিতা: {{p0}}', { p0: r.member.farmer.father_name })}</small>
                </Space>
              ) : null,
          },
          { title: tx('মোবাইল'), width: 130, render: (_, r) => digits(r.member?.farmer?.mobile) },
          { title: tx('খোলার তারিখ'), dataIndex: 'opened_on', width: 110, render: fmtDate },
          { title: tx('জের'), dataIndex: 'balance', width: 130, align: 'right', render: money },
          { title: tx('অনুমোদনের অপেক্ষায়'), dataIndex: 'held', width: 130, align: 'right', render: (v) => (Number(v) ? money(v) : '') },
          {
            title: tx('অবস্থা'),
            width: 150,
            render: (_, r) => (
              <Space size={4} wrap>
                <Tag color={r.status === 'active' ? 'green' : 'default'}>{meta.data?.account_statuses[r.status] ?? r.status}</Tag>
                {r.member?.status && r.member.status !== 'active' && <Tag color={MEMBER_STATUS[r.member.status as MemberStatus]?.color}>{MEMBER_STATUS[r.member.status as MemberStatus]?.label ?? r.member.status}</Tag>}
              </Space>
            ),
          },
        ]}
      />

      <Modal open={opening} forceRender title={tx('নতুন {{p0}} হিসাব', { p0: KIND_LABEL[kind] })} onCancel={() => setOpening(false)} onOk={open} okText={tx('হিসাব খুলুন')} cancelText={tx('ফিরে যান')}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('প্রতি সদস্যের একটি করে হিসাব থাকে; শুধু সক্রিয় সদস্যের হিসাব খোলা যায়।')} />
        <Form form={form} layout="vertical" initialValues={{ opened_on: dayjs() }}>
          <Form.Item name="member_id" label={tx('সদস্যের নাম')} rules={[required(tx('সদস্য বাছাই করুন'))]}>
            <FundMemberPicker kind={kind} filter="without" />
          </Form.Item>
          <Form.Item name="opened_on" label={tx('খোলার তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
          <Form.Item name="remarks" label={tx('মন্তব্য')}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
