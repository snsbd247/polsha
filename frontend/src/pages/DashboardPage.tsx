import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Badge, Button, Card, Col, Empty, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd'
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { money } from '../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../lib/format'
import { nameOf, t as tx } from '../lib/i18n'

type Kpi = { key: string; label: string; value: number; type: 'money' | 'number'; link: string; hint: string | null; tone: string | null }
type Day = { date: string; total: number } & Record<string, number | string>
type Recent = { id: number; no: string; date: string; payer: string; amount: number; module_label: string; status: string; by: string | null; link: string; kind: string }
type Dashboard = {
  kpis: Kpi[]
  pending: { key: string; label: string; count: number; link: string }[]
  alerts: { type: 'error' | 'warning' | 'info'; message: string; link: string }[]
  collection?: { days: Day[]; modules: { key: string; label: string }[]; today: number; month: number }
  recent?: Recent[]
  generated_at: string
}

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#13c2c2', '#eb2f96', '#fa541c']

/** Stacked daily bars (CSS only): one column per day, one colour per module. */
function CollectionChart({ days, modules }: { days: Day[]; modules: { key: string; label: string }[] }) {
  const max = Math.max(1, ...days.map((d) => d.total))
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 180, borderBottom: '1px solid #ddd', paddingTop: 8 }}>
        {days.map((d) => (
          <Tooltip
            key={d.date}
            title={
              <>
                <div>{fmtDate(d.date)}</div>
                {modules.map((m) => (Number(d[m.key]) ? <div key={m.key}>{m.label}: ৳{money(Number(d[m.key]))}</div> : null))}
                <b>{tx('মোট')}: ৳{money(d.total)}</b>
              </>
            }
          >
            <div style={{ flex: 1, height: `${(d.total / max) * 100}%`, minHeight: d.total ? 2 : 0, display: 'flex', flexDirection: 'column-reverse', cursor: 'default' }}>
              {modules.map((m, i) =>
                Number(d[m.key]) ? <div key={m.key} style={{ height: `${(Number(d[m.key]) / d.total) * 100}%`, background: COLORS[i % COLORS.length] }} /> : null,
              )}
            </div>
          </Tooltip>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginTop: 4 }}>
        <span>{fmtDate(days[0]?.date)}</span>
        <span>{fmtDate(days[days.length - 1]?.date)}</span>
      </div>
      <Space wrap size={12} style={{ marginTop: 8 }}>
        {modules.map((m, i) => (
          <span key={m.key} style={{ fontSize: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: COLORS[i % COLORS.length], marginInlineEnd: 4 }} />
            {m.label}
          </span>
        ))}
      </Space>
    </>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<Dashboard>('/dashboard')).data,
    refetchInterval: 5 * 60_000,
  })
  const refresh = async () => {
    const fresh = (await api.get<Dashboard>('/dashboard', { params: { refresh: 1 } })).data
    queryClient.setQueryData(['dashboard'], fresh)
  }

  return (
    <>
      <div className="page-header">
        <h2>
          {tx('স্বাগতম,')} {nameOf(user)}
        </h2>
        <Space>
          <Link to="/reports">
            <Button icon={<BarChartOutlined />}>{tx('রিপোর্ট কেন্দ্র')}</Button>
          </Link>
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={refresh}>
            {tx('হালনাগাদ')}
          </Button>
        </Space>
      </div>

      {data?.alerts.map((a) => (
        <Alert
          key={a.message}
          type={a.type}
          showIcon
          style={{ marginBottom: 8 }}
          title={digits(a.message)}
          action={
            <Link to={a.link}>
              <Button size="small">{tx('দেখুন')}</Button>
            </Link>
          }
        />
      ))}

      <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
        {data?.pending.map((p) => (
          <Col key={p.key} xs={24} sm={12} lg={8}>
            <Link to={p.link}>
              <Card hoverable size="small">
                <Space>
                  <Badge count={p.count} showZero color={p.count ? '#faad14' : '#d9d9d9'} overflowCount={999} />
                  <span>{p.label}</span>
                </Space>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {data?.kpis.map((k) => (
          <Col key={k.key} xs={12} md={8} xl={6}>
            <Link to={k.link}>
              <Card hoverable size="small" style={k.tone === 'warning' && k.value > 0 ? { borderColor: '#faad14' } : undefined}>
                <Statistic
                  title={k.label}
                  value={k.type === 'money' ? money(k.value) : digits(k.value)}
                  prefix={k.type === 'money' ? '৳' : undefined}
                  styles={{ content: { fontSize: 20, color: k.tone === 'warning' && k.value > 0 ? '#d46b08' : undefined } }}
                />
                {k.hint && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{digits(k.hint)}</Typography.Text>}
              </Card>
            </Link>
          </Col>
        ))}
      </Row>

      {data?.collection && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} xl={16}>
            <Card
              size="small"
              title={tx('গত ৩০ দিনের আদায়')}
              extra={
                <Link to="/reports/collections">
                  {tx('আদায়ের রিপোর্ট')}
                </Link>
              }
            >
              <Row gutter={16} style={{ marginBottom: 8 }}>
                <Col span={12}>
                  <Statistic title={tx('আজ')} value={money(data.collection.today)} prefix="৳" />
                </Col>
                <Col span={12}>
                  <Statistic title={tx('এই মাসে')} value={money(data.collection.month)} prefix="৳" />
                </Col>
              </Row>
              {data.collection.days.some((d) => d.total > 0) ? (
                <CollectionChart days={data.collection.days} modules={data.collection.modules} />
              ) : (
                <Empty description={tx('গত ৩০ দিনে কোনো আদায় নেই')} />
              )}
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <Card size="small" title={tx('সাম্প্রতিক রশিদ')}>
              <Table<Recent>
                rowKey={(r) => `${r.kind}-${r.id}`}
                size="small"
                pagination={false}
                dataSource={data.recent}
                columns={[
                  {
                    title: tx('রশিদ'),
                    render: (_, r) => (
                      <>
                        <Link to={r.link}>{digits(r.no)}</Link>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          {r.payer} · {r.module_label}
                        </div>
                      </>
                    ),
                  },
                  {
                    title: tx('টাকা'),
                    align: 'right',
                    render: (_, r) => (
                      <>
                        {r.status === 'cancelled' ? <Tag color="red">{tx('বাতিল')}</Tag> : null}৳{money(r.amount)}
                        <div style={{ fontSize: 12, color: '#888' }}>{dayjs(r.date).isSame(dayjs(), 'day') ? tx('আজ') : fmtDate(r.date)}</div>
                      </>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
        {tx('আপনার রোল:')} {user?.roles.map((r) => r.label ?? r.name).join(', ')}
        {data && ` · ${tx('হালনাগাদ: {{d}}', { d: fmtDateTime(data.generated_at) })}`}
      </Typography.Paragraph>
    </>
  )
}
