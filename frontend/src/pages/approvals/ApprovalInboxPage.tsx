import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Card, Select, Table, Tabs, Tag } from 'antd'
import { useAuth } from '../../auth/AuthContext'
import RelatedLinks from '../../components/RelatedLinks'
import { api, type Paginated } from '../../lib/api'
import { APPROVAL_STATUS, digits, fmtDateTime } from '../../lib/format'
import type { ApprovalRequest } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

export default function ApprovalInboxPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState('mine')
  const [status, setStatus] = useState<string>()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  const { data, isFetching } = useQuery({
    queryKey: ['approvals', tab, status, page, perPage],
    queryFn: async () =>
      (await api.get<Paginated<ApprovalRequest>>('/approvals', { params: { tab, status, page, per_page: perPage } })).data,
    placeholderData: keepPreviousData,
  })

  const tabs = [
    { key: 'mine', label: tx('আমার কাছে অপেক্ষমাণ') },
    { key: 'sent', label: tx('আমার পাঠানো') },
    ...(can('approval.admin') ? [{ key: 'all', label: tx('সব') }] : []),
  ]

  return (
    <>
      <div className="page-header">
        <h2>{tx('অনুমোদন')}</h2>
        <RelatedLinks links={[{ to: '/admin/approval-rules', label: tx('অনুমোদনের নিয়ম'), perm: 'approval.admin' }]} />
      </div>
      <Card>
        <Tabs
          activeKey={tab}
          items={tabs}
          onChange={(k) => {
            setTab(k)
            setPage(1)
          }}
          tabBarExtraContent={
            tab !== 'mine' && (
              <Select
                placeholder={tx('অবস্থা')}
                allowClear
                style={{ width: 140 }}
                value={status}
                onChange={(v) => {
                  setStatus(v)
                  setPage(1)
                }}
                options={Object.entries(APPROVAL_STATUS).map(([value, s]) => ({ value, label: s.label }))}
              />
            )
          }
        />
        <Table<ApprovalRequest>
          rowKey="id"
          loading={isFetching}
          dataSource={data?.data}
          scroll={{ x: 800 }}
          locale={{ emptyText: tab === 'mine' ? tx('আপনার অনুমোদনের অপেক্ষায় কিছু নেই।') : undefined }}
          pagination={{
            current: page,
            pageSize: perPage,
            total: data?.total,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100],
            onChange: (p, s) => {
              setPage(p)
              setPerPage(s)
            },
          }}
          columns={[
            { title: tx('বিষয়'), dataIndex: 'title', render: (v, r) => <Link to={`/approvals/${r.id}`}>{v}</Link> },
            { title: tx('পাঠিয়েছেন'), render: (_, r) => r.requester?.name_bn },
            { title: tx('সময়'), dataIndex: 'created_at', render: fmtDateTime },
            { title: tx('টাকার পরিমাণ'), dataIndex: 'amount', render: (v) => (v ? tx('৳ {{p0}}', { p0: digits(v) }) : '—') },
            {
              title: tx('ধাপ'),
              render: (_, r) => (r.total_steps ? `${digits(Math.min(r.current_step, r.total_steps))} / ${digits(r.total_steps)}` : '—'),
            },
            {
              title: tx('অবস্থা'),
              dataIndex: 'status',
              render: (s: string) => <Tag color={APPROVAL_STATUS[s]?.color}>{APPROVAL_STATUS[s]?.label ?? s}</Tag>,
            },
          ]}
        />
      </Card>
    </>
  )
}
