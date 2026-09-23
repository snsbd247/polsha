import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Col, Row, Statistic, Typography } from 'antd'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { digits } from '../lib/format'
import { nameOf, t as tx } from '../lib/i18n'

/** Placeholder until Phase 9 builds the KPI dashboard. */
export default function DashboardPage() {
  const { user } = useAuth()
  const { data: pending = 0 } = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: async () => (await api.get<{ count: number }>('/approvals/pending-count')).data.count,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('স্বাগতম,')}{' '}{nameOf(user)}</h2>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/approvals">
            <Card hoverable>
              <Statistic title={tx('আমার অনুমোদনের অপেক্ষায়')} value={digits(pending)} />
            </Card>
          </Link>
        </Col>
      </Row>
      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        title={tx('পূর্ণাঙ্গ ড্যাশবোর্ড (KPI, দৈনিক আদায়ের চার্ট, সতর্কতা) ফেজ ৯-এ যুক্ত হবে।')}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        {tx('আপনার রোল:')}{' '}{user?.roles.map((r) => r.label ?? r.name).join(', ')}
      </Typography.Paragraph>
    </>
  )
}
