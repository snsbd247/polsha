import { Link } from 'react-router-dom'
import { Collapse, Empty, Result, Space, Tag } from 'antd'
import { digits } from '../lib/format'
import { t as tx } from '../lib/i18n'

export type IntegrityCheck = {
  key: string
  group: 'data' | 'ledger'
  label: string
  severity: 'error' | 'warning' | 'info'
  count: number
  samples: { no: string; detail: string; link: string }[]
}

const SEVERITY: Record<string, { color: string; label: string }> = {
  error: { color: 'red', label: tx('গুরুতর') },
  warning: { color: 'orange', label: tx('সতর্কতা') },
  info: { color: 'blue', label: tx('তথ্য') },
}

/** Checks with problems first (expandable to their first 20 records), then the passed ones as green tags. */
export default function IntegrityResults({ checks }: { checks: IntegrityCheck[] }) {
  const failed = checks.filter((c) => c.count > 0)
  const passed = checks.filter((c) => c.count === 0)
  return (
    <>
      {failed.length === 0 ? (
        <Result status="success" title={tx('কোনো অসঙ্গতি পাওয়া যায়নি')} style={{ padding: 16 }} />
      ) : (
        <Collapse
          items={failed.map((c) => ({
            key: c.key,
            label: (
              <Space wrap>
                <Tag color={SEVERITY[c.severity]?.color}>{SEVERITY[c.severity]?.label ?? c.severity}</Tag>
                {c.label}
                <b>{digits(c.count)}</b>
              </Space>
            ),
            children: c.samples.length ? (
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {c.samples.map((s, i) => (
                  <li key={i}>
                    <Link to={s.link}>{digits(s.no)}</Link> — {digits(s.detail)}
                  </li>
                ))}
                {c.count > c.samples.length && <li style={{ color: '#888' }}>{tx('আরও {{n}} টি…', { n: digits(c.count - c.samples.length) })}</li>}
              </ul>
            ) : (
              <Empty />
            ),
          }))}
        />
      )}
      {passed.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: '#888', marginBottom: 4 }}>{tx('যেগুলো ঠিক আছে:')}</div>
          <Space wrap size={[4, 4]}>
            {passed.map((c) => (
              <Tag key={c.key} color="green">
                ✓ {c.label}
              </Tag>
            ))}
          </Space>
        </div>
      )}
    </>
  )
}
