import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Drawer, Grid, Popover } from 'antd'
import { BellOutlined, CheckCircleFilled, ExclamationCircleFilled, RightOutlined, WarningFilled } from '@ant-design/icons'
import { digits } from '../lib/format'
import { t as tx } from '../lib/i18n'

export type BellAlert = { key: string; level: 'warning' | 'danger'; title: string; detail: string; link: string }

/**
 * The top-bar bell: money left unattended (cash days not closed, cash with
 * field collectors, approvals waiting too long) and the approvals waiting
 * for this user. Alerts clear themselves once the cause is dealt with.
 */
export default function AlertBell({ alerts, pending }: { alerts: BellAlert[]; pending: number }) {
  const [open, setOpen] = useState(false)
  const phone = !Grid.useBreakpoint().md
  const close = () => setOpen(false)
  const content = (
    <div className="bell-pop">
      <h4>{tx('সতর্কবার্তা')}</h4>
      {alerts.length ? (
        <ul>
          {alerts.map((a) => (
            <li key={a.key} className={`bell-${a.level}`}>
              <Link to={a.link} onClick={close}>
                {a.level === 'danger' ? <ExclamationCircleFilled /> : <WarningFilled />}
                <div className="bell-text">
                  <b>{digits(a.title)}</b>
                  <small>{digits(a.detail)}</small>
                </div>
                <RightOutlined className="bell-go" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bell-ok">
          <CheckCircleFilled /> {tx('সব ঠিক আছে — কোনো সতর্কবার্তা নেই।')}
        </p>
      )}
      <Link to="/approvals" className="bell-approvals" onClick={close}>
        {pending ? tx('আপনার অনুমোদনের অপেক্ষায় {{p0}}টি অনুরোধ', { p0: digits(pending) }) : tx('অনুমোদনের তালিকা')}
        <RightOutlined />
      </Link>
    </div>
  )
  const count = alerts.length + pending
  const bell = (
    <button type="button" className="top-bell" aria-label={tx('সতর্কবার্তা ও অনুমোদন')} onClick={phone ? () => setOpen(true) : undefined}>
      <Badge count={count ? digits(count) : 0} size="small" offset={[-2, 3]} color={alerts.some((a) => a.level === 'danger') ? '#e5383b' : alerts.length ? '#f08c00' : undefined}>
        <BellOutlined />
      </Badge>
    </button>
  )
  // a phone has no room for a dropdown beside the bell: the list slides in from the side
  if (phone)
    return (
      <>
        {bell}
        <Drawer open={open} onClose={close} placement="right" size={Math.min(360, window.innerWidth - 24)} title={tx('সতর্কবার্তা ও অনুমোদন')} styles={{ body: { padding: 14 } }}>
          {content}
        </Drawer>
      </>
    )
  return (
    <Popover content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} arrow={false}>
      {bell}
    </Popover>
  )
}
