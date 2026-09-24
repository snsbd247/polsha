import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Col, Progress, Row, Space, Spin, Statistic, Table, Tag } from 'antd'
import { PlusOutlined, ScanOutlined } from '@ant-design/icons'
import { Can } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { ASSET_STATUS_COLOR, CONDITION_COLOR } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'

type Money = { count: number; cost: number; book_value: number }
type AssetRef = { id: number; asset_code: string; name_bn: string; name_en: string | null }
type Dash = {
  totals: Money & { accumulated: number }
  by_status: (Money & { status: string })[]
  by_category: (Money & { category: { id: number; code: string; name_bn: string; name_en: string | null } | null })[]
  by_condition: Record<string, number>
  maintenance: { overdue: number; due_30: number; upcoming: { id: number; title: string; due_on: string; asset: AssetRef }[] }
  last_depreciation: string | null
  movements: { id: number; type: string; date: string; to_location: string | null; asset: AssetRef }[]
  statuses: Record<string, string>
  conditions: Record<string, string>
  movement_types: Record<string, string>
}

const STATUS_PATH: Record<string, string> = { in_stock: '/assets/stock', disposal_pending: '/assets/sales', sold: '/assets/sales', disposed: '/assets/sales' }

export default function AssetDashboardPage() {
  const { data: d, isLoading } = useQuery({ queryKey: ['asset-dashboard'], queryFn: async () => (await api.get<Dash>('/assets/dashboard')).data })
  if (isLoading || !d) return <Spin style={{ display: 'block', marginTop: 64 }} />
  const liveCount = Object.values(d.by_condition).reduce((s, n) => s + Number(n), 0)
  const thisMonth = new Date().toISOString().slice(0, 7)

  return (
    <>
      <div className="page-header">
        <h2>{tx('সম্পদ ড্যাশবোর্ড')}</h2>
        <Space wrap>
          <Link to="/qr/scan">
            <Button icon={<ScanOutlined />}>{tx('QR স্ক্যানার')}</Button>
          </Link>
          <Can perm="asset.create">
            <Link to="/assets/new">
              <Button type="primary" icon={<PlusOutlined />}>
                {tx('নতুন সম্পদ')}
              </Button>
            </Link>
          </Can>
        </Space>
      </div>
      {d.last_depreciation !== thisMonth && d.totals.count > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={tx('সর্বশেষ অবচয়: {{p0}}।', { p0: d.last_depreciation ? digits(d.last_depreciation) : tx('এখনও চালানো হয়নি') })}
          action={
            <Link to="/assets/depreciation">
              <Button size="small">{tx('অবচয় চালান')}</Button>
            </Link>
          }
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('চালু সম্পদ')} value={digits(d.totals.count)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('ক্রয়মূল্য')} value={money(d.totals.cost)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('পুঞ্জীভূত অবচয়')} value={money(d.totals.accumulated)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বর্তমান মূল্য')} value={money(d.totals.book_value)} prefix="৳" styles={{ content: { color: '#1677ff' } }} />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={tx('স্ট্যাটাস অনুযায়ী')} size="small">
            <Table
              rowKey="status"
              size="small"
              pagination={false}
              dataSource={d.by_status}
              columns={[
                {
                  title: tx('স্ট্যাটাস'),
                  dataIndex: 'status',
                  render: (s: string) => (
                    <Link to={STATUS_PATH[s] ?? '/assets'}>
                      <Tag color={ASSET_STATUS_COLOR[s]}>{d.statuses[s] ?? s}</Tag>
                    </Link>
                  ),
                },
                { title: tx('সংখ্যা'), dataIndex: 'count', render: digits },
                { title: tx('ক্রয়মূল্য'), dataIndex: 'cost', align: 'right', render: money },
                { title: tx('বর্তমান মূল্য'), dataIndex: 'book_value', align: 'right', render: money },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={tx('শ্রেণি অনুযায়ী (চালু)')} size="small">
            <Table
              rowKey={(r) => r.category?.id ?? 0}
              size="small"
              pagination={false}
              dataSource={d.by_category}
              columns={[
                { title: tx('শ্রেণি'), render: (_, r) => nameOf(r.category) },
                { title: tx('সংখ্যা'), dataIndex: 'count', render: digits },
                { title: tx('ক্রয়মূল্য'), dataIndex: 'cost', align: 'right', render: money },
                { title: tx('বর্তমান মূল্য'), dataIndex: 'book_value', align: 'right', render: money },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={tx('অবস্থা (চালু সম্পদ)')} size="small">
            {Object.entries(d.conditions).map(([k, label]) => {
              const n = Number(d.by_condition[k] ?? 0)
              return (
                <div key={k} style={{ marginBottom: 8 }}>
                  <Tag color={CONDITION_COLOR[k]}>{label}</Tag> {digits(n)}
                  <Progress percent={liveCount ? Math.round((n / liveCount) * 100) : 0} size="small" showInfo={false} />
                </div>
              )
            })}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card
            title={tx('সার্ভিস/মেরামত')}
            size="small"
            extra={
              <Link to="/assets/maintenances">
                {tx('সূচি')}
              </Link>
            }
          >
            <Space size="large" style={{ marginBottom: 12 }}>
              <Statistic title={tx('মেয়াদোত্তীর্ণ')} value={digits(d.maintenance.overdue)} styles={{ content: { color: d.maintenance.overdue ? '#cf1322' : undefined } }} />
              <Statistic title={tx('৩০ দিনের মধ্যে')} value={digits(d.maintenance.due_30)} />
            </Space>
            {d.maintenance.upcoming.map((m) => (
              <div key={m.id} style={{ marginBottom: 4 }}>
                {fmtDate(m.due_on)} — <Link to={`/assets/${m.asset.id}`}>{nameOf(m.asset)}</Link>: {m.title}
              </div>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={tx('সাম্প্রতিক চলাচল')} size="small">
            {d.movements.map((m) => (
              <div key={m.id} style={{ marginBottom: 4 }}>
                {fmtDate(m.date)} — <Link to={`/assets/${m.asset.id}`}>{nameOf(m.asset)}</Link>: {d.movement_types[m.type] ?? m.type}
                {m.to_location ? ` → ${m.to_location}` : ''}
              </div>
            ))}
          </Card>
        </Col>
      </Row>
    </>
  )
}
