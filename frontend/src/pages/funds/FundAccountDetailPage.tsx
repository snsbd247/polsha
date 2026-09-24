import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Dropdown, Row, Segmented, Space, Spin, Statistic, Table, Tag } from 'antd'
import { DownloadOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { IN_TYPE, KIND_LABEL, TXN_STATUS_COLOR, useFundMeta, type FundKind, type FundTxn, type MemberBrief, type Person } from '../../lib/funds'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import FundTxnModal from './FundTxnModal'

type Detail = {
  id: number
  kind: FundKind
  account_no: string
  member_id: number
  opened_on: string
  status: string
  balance: string
  remarks: string | null
  member: (MemberBrief & { admitted_on: string | null; farmer: MemberBrief['farmer'] & { father_name: string; mobile: string | null } }) | null
  creator: Person
  held: number
  available: number
  other_account: { id: number; kind: FundKind; account_no: string; balance: string } | null
  pending: FundTxn[]
}
type TxnRow = { id: number; txn_no: string; date: string; type: string; type_label: string; in: number; out: number; balance: number; reference: string | null; remarks: string | null; status: string }
type GroupRow = { period: string; opening: number; in: number; out: number; balance: number; count: number }
type Statement = { opening: number; rows: (TxnRow | GroupRow)[]; total_in: number; total_out: number; closing: number; group: string }
type Filter = { from?: string; to?: string; group: 'none' | 'day' | 'month' | 'year' }

const ACTIONS: Record<FundKind, string[]> = { savings: ['deposit', 'withdrawal', 'opening', 'adjustment'], share: ['purchase', 'transfer', 'opening', 'adjustment'] }

export default function FundAccountDetailPage({ kind }: { kind: FundKind }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useFundMeta(kind)
  const [filter, setFilter] = useState<Filter>({ group: 'none' })
  const [action, setAction] = useState<string | null>(null)

  const { data: a, isLoading } = useQuery({ queryKey: ['fund-account', kind, id], queryFn: async () => (await api.get<Detail>(`/funds/${kind}/accounts/${id}`)).data })
  const st = useQuery({
    queryKey: ['fund-statement', kind, id, filter],
    queryFn: async () => (await api.get<Statement>(`/funds/${kind}/accounts/${id}/statement`, { params: filter })).data,
  })
  if (isLoading || !a) return <Spin />

  const types: Record<string, string> = { ...meta.data?.types, transfer: tx('শেয়ার হস্তান্তর') }
  const grouped = filter.group !== 'none'
  const active = a.status === 'active' && a.member?.status === 'active'
  const done = (res: { id: number; status: string }) => {
    setAction(null)
    queryClient.invalidateQueries({ queryKey: ['fund-account', kind, id] })
    queryClient.invalidateQueries({ queryKey: ['fund-statement', kind, id] })
    queryClient.invalidateQueries({ queryKey: ['fund-accounts', kind] })
    if (res.status === 'posted') navigate(`/funds/${kind}/transactions/${res.id}`)
  }

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('{{p0}} হিসাব {{p1}}', { p0: KIND_LABEL[kind], p1: digits(a.account_no) })}{' '}
          <Tag color={a.status === 'active' ? 'green' : 'default'}>{meta.data?.account_statuses[a.status] ?? a.status}</Tag>
        </h2>
        <Space wrap>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => downloadExport(`/funds/${kind}/accounts/${a.id}/statement`, { ...filter, export: 'csv' }, `${kind}-statement-${a.account_no}.csv`).catch((e) => message.error(errorMessage(e)))}
          >
            Excel
          </Button>
          {can(`${kind}.create`) && (
            <>
              <Button type="primary" icon={<PlusOutlined />} disabled={!active} onClick={() => setAction(IN_TYPE[kind])}>
                {types[IN_TYPE[kind]] ?? IN_TYPE[kind]}
              </Button>
              <Dropdown
                disabled={!active}
                menu={{ items: ACTIONS[kind].slice(1).map((k) => ({ key: k, label: types[k] ?? k })), onClick: ({ key }) => setAction(key) }}
              >
                <Button disabled={!active}>{tx('অন্যান্য লেনদেন')}</Button>
              </Dropdown>
            </>
          )}
        </Space>
      </div>

      {!active && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('হিসাব বা সদস্যপদ সক্রিয় নয় — নতুন লেনদেন করা যাবে না।')} />}

      <div className="print-only receipt-title" style={{ textAlign: 'center' }}>
        {tx('সদস্য বিবরণী — {{p0}} হিসাব {{p1}}', { p0: KIND_LABEL[kind], p1: digits(a.account_no) })}
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card size="small">
            <Descriptions column={{ xs: 1, md: 2 }} size="small">
              <Descriptions.Item label={tx('সদস্যের নাম')}>
                {a.member?.farmer && (
                  <Link to={`/farmers/${a.member.farmer.id}`}>
                    {nameOf(a.member.farmer)} ({tx('সদস্য নং')} {digits(a.member.member_no)})
                  </Link>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={tx('পিতার নাম')}>{a.member?.farmer?.father_name}</Descriptions.Item>
              <Descriptions.Item label={tx('মোবাইল')}>{digits(a.member?.farmer?.mobile)}</Descriptions.Item>
              <Descriptions.Item label={tx('খোলার তারিখ')}>{fmtDate(a.opened_on)}</Descriptions.Item>
              {a.other_account && (
                <Descriptions.Item label={KIND_LABEL[a.other_account.kind]} className="no-print">
                  <Link to={`/funds/${a.other_account.kind}/accounts/${a.other_account.id}`}>{digits(a.other_account.account_no)}</Link> — ৳{money(a.other_account.balance)}
                </Descriptions.Item>
              )}
              {a.remarks && <Descriptions.Item label={tx('মন্তব্য')}>{a.remarks}</Descriptions.Item>}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={12} lg={5}>
          <Card size="small">
            <Statistic title={tx('জের')} value={money(a.balance)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} lg={5}>
          <Card size="small">
            <Statistic title={kind === 'savings' ? tx('উত্তোলনযোগ্য') : tx('হস্তান্তরযোগ্য')} value={money(a.available)} prefix="৳" />
          </Card>
        </Col>
      </Row>

      {a.pending.length > 0 && (
        <Card size="small" className="no-print" title={tx('অনুমোদনের অপেক্ষায়')} style={{ marginBottom: 16 }}>
          <Table<FundTxn>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={a.pending}
            columns={[
              { title: tx('লেনদেন নং'), dataIndex: 'txn_no', render: (v: string, r) => <Link to={`/funds/${kind}/transactions/${r.id}`}>{digits(v)}</Link> },
              { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
              { title: tx('ধরন'), dataIndex: 'type', render: (v: string) => types[v] ?? v },
              { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: (v, r) => `${r.direction === 'out' ? '−' : '+'}${money(v)}` },
              { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag color={TXN_STATUS_COLOR[s]}>{meta.data?.statuses[s] ?? s}</Tag> },
            ]}
          />
        </Card>
      )}

      <Card
        title={tx('সদস্য বিবরণী')}
        extra={
          <Space wrap className="no-print">
            <DatePicker.RangePicker
              format="DD/MM/YYYY"
              onChange={(r) => setFilter((f) => ({ ...f, from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') }))}
            />
            <Segmented
              value={filter.group}
              onChange={(group) => setFilter((f) => ({ ...f, group: group as Filter['group'] }))}
              options={[
                { value: 'none', label: tx('প্রতিটি লেনদেন') },
                { value: 'day', label: tx('দৈনিক') },
                { value: 'month', label: tx('মাসিক') },
                { value: 'year', label: tx('বার্ষিক') },
              ]}
            />
          </Space>
        }
      >
        <Table<TxnRow | GroupRow>
          rowKey={(r) => ('id' in r ? r.id : r.period)}
          size="small"
          loading={st.isFetching}
          dataSource={st.data?.rows}
          pagination={false}
          scroll={{ x: 800 }}
          columns={
            grouped
              ? [
                  { title: tx('সময়কাল'), dataIndex: 'period', render: (v: string) => digits(v) },
                  { title: tx('প্রারম্ভিক জের'), dataIndex: 'opening', align: 'right', render: money },
                  { title: tx('জমা'), dataIndex: 'in', align: 'right', render: money },
                  { title: tx('খরচ'), dataIndex: 'out', align: 'right', render: money },
                  { title: tx('সমাপনী জের'), dataIndex: 'balance', align: 'right', render: money },
                  { title: tx('লেনদেন'), dataIndex: 'count', align: 'right', render: (v: number) => digits(v) },
                ]
              : [
                  { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
                  { title: tx('লেনদেন নং'), dataIndex: 'txn_no', width: 150, render: (v: string, r) => <Link to={`/funds/${kind}/transactions/${(r as TxnRow).id}`}>{digits(v)}</Link> },
                  {
                    title: tx('বিবরণ'),
                    render: (_, r) => {
                      const t = r as TxnRow
                      return (
                        <>
                          {t.type_label}
                          {t.status === 'cancel_pending' && (
                            <Tag color="orange" style={{ marginLeft: 6 }}>
                              {meta.data?.statuses[t.status]}
                            </Tag>
                          )}
                          {(t.reference || t.remarks) && <div style={{ fontSize: 12, color: '#888' }}>{[t.reference && digits(t.reference), t.remarks].filter(Boolean).join(' · ')}</div>}
                        </>
                      )
                    },
                  },
                  { title: tx('জমা'), dataIndex: 'in', width: 120, align: 'right', render: (v: number) => (v ? money(v) : '') },
                  { title: tx('খরচ'), dataIndex: 'out', width: 120, align: 'right', render: (v: number) => (v ? money(v) : '') },
                  { title: tx('জের'), dataIndex: 'balance', width: 130, align: 'right', render: money },
                ]
          }
          summary={() =>
            st.data && (
              <>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={grouped ? 2 : 3}>
                    <strong>{tx('প্রারম্ভিক জের')}: ৳{money(st.data.opening)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>{money(st.data.total_in)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <strong>{money(st.data.total_out)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <strong>{money(st.data.closing)}</strong>
                  </Table.Summary.Cell>
                  {grouped && <Table.Summary.Cell index={4} />}
                </Table.Summary.Row>
              </>
            )
          }
        />
      </Card>

      <FundTxnModal
        kind={kind}
        account={{ id: a.id, account_no: a.account_no, member_id: a.member_id, available: a.available }}
        type={action}
        typeLabel={action ? types[action] : undefined}
        onClose={() => setAction(null)}
        onDone={done}
      />
    </>
  )
}
