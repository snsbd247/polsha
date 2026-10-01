import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Progress, Space, Table, Tag, Typography } from 'antd'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { MATCH_LABEL, type DuplicateMatch } from '../../lib/phase2'
import { t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

type Pair = { a: DuplicateMatch; b: DuplicateMatch; reasons: string[]; score: number }

function Person({ f }: { f: DuplicateMatch }) {
  return (
    <div>
      <Link to={`/farmers/${f.id}`}>{f.name_bn}</Link> <Tag>{f.farmer_code}</Tag>
      {f.member_no && (
        <Tag color="green">
          {tx('সদস্য নং')} {digits(f.member_no)}
        </Tag>
      )}
      <div>
        <Typography.Text type="secondary">
          {tx('পিতা:')} {f.father_name} · {f.village ?? '—'} · {digits(f.mobile) || tx('মোবাইল নেই')}
          {f.nid && ` · NID ${digits(f.nid)}`}
        </Typography.Text>
      </div>
    </div>
  )
}

export default function DuplicatesPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isFetching } = useQuery({
    queryKey: ['farmer-duplicates', page],
    queryFn: async () => (await api.get<Paginated<Pair>>('/farmers/duplicates', { params: { page } })).data,
    placeholderData: keepPreviousData,
  })

  const dismiss = async (p: Pair) => {
    try {
      await api.post('/farmers-duplicates/dismiss', { a: p.a.id, b: p.b.id })
      message.success(tx('এই জোড়া আর দেখাবে না।'))
      queryClient.invalidateQueries({ queryKey: ['farmer-duplicates'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <PageFrame className="ml pl" crumbs={[{ label: tx('কৃষক ও সদস্য'), to: '/farmers' }, { label: tx('ডুপ্লিকেট পর্যালোচনা') }]} title={tx('ডুপ্লিকেট পর্যালোচনা')}>
      <Typography.Paragraph type="secondary">{tx('একই NID, একই মোবাইল, অথবা একই গ্রামে একই নাম ও পিতার নাম (মোঃ/মোহাম্মদ, মোছাঃ/মোসাম্মৎ ইত্যাদি বানান-পার্থক্য উপেক্ষা করে) — এমন জোড়া দেখানো হচ্ছে।')}</Typography.Paragraph>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<Pair>
          rowKey={(p) => `${p.a.id}-${p.b.id}`}
          loading={isFetching}
          dataSource={data?.data}
          scroll={{ x: 900 }}
          locale={{ emptyText: tx('কোনো সম্ভাব্য ডুপ্লিকেট নেই') }}
          pagination={{ current: page, pageSize: data?.per_page, total: data?.total, onChange: setPage, showSizeChanger: false, showTotal: (t) => tx('মোট {{p0}} জোড়া', { p0: digits(t) }) }}
          columns={[
            { title: tx('মিল'), dataIndex: 'score', width: 90, render: (s) => <Progress type="circle" size={44} percent={s} format={(p) => digits(p ?? 0)} /> },
            { title: tx('রেকর্ড ১'), render: (_, p) => <Person f={p.a} /> },
            { title: tx('রেকর্ড ২'), render: (_, p) => <Person f={p.b} /> },
            {
              title: tx('যেখানে মিলেছে'),
              dataIndex: 'reasons',
              render: (r: string[]) =>
                r.map((k) => (
                  <Tag key={k} color="orange">
                    {MATCH_LABEL[k] ?? k}
                  </Tag>
                )),
            },
            {
              title: '',
              width: 220,
              render: (_, p) =>
                can('farmer.edit') && (
                  <Space orientation="vertical" size={4}>
                    <Button size="small" type="primary" onClick={() => navigate(`/farmers/merge/new?a=${p.a.id}&b=${p.b.id}`)}>
                      {tx('পাশাপাশি তুলনা ও মার্জ')}
                    </Button>
                    <Button size="small" onClick={() => dismiss(p)}>
                      {tx('ডুপ্লিকেট নয়')}
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      </Card>
    </PageFrame>
  )
}
