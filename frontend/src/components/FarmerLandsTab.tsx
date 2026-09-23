import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Space, Spin, Table, Tag, Typography } from 'antd'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { digits, fmtDate } from '../lib/format'
import { CULTIVATION_COLOR, fmtArea, useLandMeta } from '../lib/land'

type LandRef = { id: number; land_code: string; dag_no: string; khatian_no: string; area_decimal: string; mouza: { name_bn: string } | null; land_type: { name_bn: string } | null; deleted_at: string | null }
type Owned = { id: number; share_percent: string; start_date: string; end_date: string | null; land: LandRef }
type Cultivated = { id: number; type: string; terms: string | null; start_date: string; end_date: string | null; land: LandRef & { owners: { farmer: { name_bn: string } }[] } }

/** Lands the farmer owns (with share) and farms, current first. */
export default function FarmerLandsTab({ farmerId }: { farmerId: number }) {
  const { can } = useAuth()
  const { data: meta } = useLandMeta()
  const { data, isLoading } = useQuery({
    queryKey: ['farmers', farmerId, 'lands'],
    queryFn: async () => (await api.get<{ owned: Owned[]; cultivated: Cultivated[] }>(`/farmers/${farmerId}/lands`)).data,
    enabled: can('land.view'),
  })

  if (!can('land.view')) return <Typography.Text type="secondary">জমির তথ্য দেখার অনুমতি নেই।</Typography.Text>
  if (isLoading || !data) return <Spin />

  const current = data.owned.filter((o) => !o.end_date)
  const ownedArea = current.reduce((s, o) => s + (Number(o.land.area_decimal) * Number(o.share_percent)) / 100, 0)
  const landCell = (l: LandRef) => (
    <>
      <Link to={`/lands/${l.id}`}>{l.land_code}</Link> — {l.mouza?.name_bn}, দাগ {digits(l.dag_no)}
      {l.deleted_at && <Tag color="red">মুছে ফেলা</Tag>}
    </>
  )
  const period = (p: { start_date: string; end_date: string | null }) =>
    p.end_date ? `${fmtDate(p.start_date)} — ${fmtDate(p.end_date)}` : <Tag color="green">{fmtDate(p.start_date)} থেকে বর্তমান</Tag>

  return (
    <Space orientation="vertical" size={20} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={5}>
          মালিকানাধীন জমি — বর্তমানে {digits(current.length)}টি, অংশ অনুযায়ী মোট {fmtArea(ownedArea, meta)}
        </Typography.Title>
        <Table<Owned>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data.owned}
          scroll={{ x: 640 }}
          locale={{ emptyText: 'কোনো জমির মালিক নন' }}
          columns={[
            { title: 'জমি', render: (_, o) => landCell(o.land) },
            { title: 'পরিমাণ', render: (_, o) => fmtArea(o.land.area_decimal, meta) },
            { title: 'অংশ', dataIndex: 'share_percent', render: (v) => `${digits(Number(v))}%` },
            { title: 'সময়কাল', render: (_, o) => period(o) },
          ]}
        />
      </div>
      <div>
        <Typography.Title level={5}>চাষ করা জমি (নিজ, বর্গা ও লিজ)</Typography.Title>
        <Table<Cultivated>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data.cultivated}
          scroll={{ x: 640 }}
          locale={{ emptyText: 'কোনো জমি চাষ করেন না' }}
          columns={[
            { title: 'জমি', render: (_, c) => landCell(c.land) },
            { title: 'ধরন', dataIndex: 'type', render: (t) => <Tag color={CULTIVATION_COLOR[t]}>{meta?.cultivation_types[t]}</Tag> },
            { title: 'জমির মালিক', render: (_, c) => c.land.owners.map((o) => o.farmer.name_bn).join(', ') || '—' },
            { title: 'সময়কাল', render: (_, c) => period(c) },
          ]}
        />
      </div>
    </Space>
  )
}
