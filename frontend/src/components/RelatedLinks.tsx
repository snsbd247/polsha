import { Link } from 'react-router-dom'
import { Button } from 'antd'
import { useAuth } from '../auth/AuthContext'

export type RelatedLink = { to: string; label: string; perm?: string | string[]; superOnly?: boolean }

/** Header buttons for related screens that are not in the sidebar. */
export default function RelatedLinks({ links }: { links: RelatedLink[] }) {
  const { user, can } = useAuth()
  return (
    <>
      {links
        .filter((l) => (l.superOnly ? !!user?.is_super_admin : !l.perm || can(l.perm)))
        .map((l) => (
          <Link key={l.to} to={l.to}>
            <Button>{l.label}</Button>
          </Link>
        ))}
    </>
  )
}
