import { Link } from 'react-router-dom'
import { Button, Result, Space } from 'antd'
import { ClockCircleOutlined } from '@ant-design/icons'
import type { SoonPage } from '../lib/comingSoon'
import { digits } from '../lib/format'
import { t as tx } from '../lib/i18n'

/** Placeholder for a menu item whose screen arrives in a later phase. */
export default function ComingSoonPage({ page }: { page: SoonPage }) {
  return (
    <Result
      icon={<ClockCircleOutlined style={{ color: '#1677ff' }} />}
      title={page.title}
      subTitle={
        <>
          <div style={{ marginBottom: 8 }}>{page.about}</div>
          <strong>{tx('শীঘ্রই আসছে (ফেজ {{p0}})', { p0: digits(page.phase) })}</strong>
        </>
      }
      extra={
        page.links?.length ? (
          <Space wrap>
            <span>{tx('এখন ব্যবহার করুন:')}</span>
            {page.links.map((l) => (
              <Link key={l.to} to={l.to}>
                <Button>{l.label}</Button>
              </Link>
            ))}
          </Space>
        ) : null
      }
    />
  )
}
