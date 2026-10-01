import { useSearchParams } from 'react-router-dom'
import { Card, Col, Input, List, Row, Spin } from 'antd'
import { useState } from 'react'
import { t as tx } from '../../lib/i18n'
import ReportView from '../../components/ReportView'
import { useReportCatalog } from '../../lib/reports'
import PageFrame from '../../components/PageFrame'

/** Every report the user may open, grouped by category; picking one opens it on the right. */
export default function ReportCenterPage() {
  const { data, isLoading } = useReportCatalog()
  const [search, setSearch] = useSearchParams()
  const [q, setQ] = useState('')
  const key = search.get('r')
  const current = data?.reports.find((r) => r.key === key)

  if (isLoading || !data) return <Spin />
  const match = (title: string) => !q || title.toLowerCase().includes(q.toLowerCase())

  return (
    <PageFrame className="ml pl" crumbs={[{ label: tx('রিপোর্ট'), to: '/reports/collections' }, { label: current ? current.title : tx('রিপোর্ট কেন্দ্র') }]} title={current ? current.title : tx('রিপোর্ট কেন্দ্র')}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={6}>
          <Card size="small" styles={{ body: { maxHeight: '75vh', overflow: 'auto' } }}>
            <Input.Search allowClear placeholder={tx('রিপোর্ট খুঁজুন')} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
            {Object.entries(data.categories).map(([cat, label]) => {
              const items = data.reports.filter((r) => r.categories.includes(cat) && match(r.title))
              if (!items.length) return null
              return (
                <List
                  key={cat}
                  size="small"
                  header={<b>{label}</b>}
                  dataSource={items}
                  renderItem={(r) => (
                    <List.Item style={{ cursor: 'pointer', background: r.key === key ? 'rgba(22,119,255,0.08)' : undefined, paddingInline: 8 }} onClick={() => setSearch({ r: r.key })}>
                      {r.title}
                    </List.Item>
                  )}
                />
              )
            })}
          </Card>
        </Col>
        <Col xs={24} lg={18}>
          {current ? (
            <ReportView key={current.key} reportKey={current.key} />
          ) : (
            <Card>
              <p style={{ color: '#888', margin: 0 }}>{tx('বাম দিক থেকে একটি রিপোর্ট বাছাই করুন। সব রিপোর্ট প্রিন্ট (PDF) ও Excel-এ নামানো যায়।')}</p>
            </Card>
          )}
        </Col>
      </Row>
    </PageFrame>
  )
}
