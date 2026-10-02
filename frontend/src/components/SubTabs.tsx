import { useSearchParams } from 'react-router-dom'
import '../pages/irrigation/rates.css'
import '../pages/approvals/approvals.css'

/**
 * A row of big tabs that switch between two views of one menu item, kept in
 * the address (?view=…) so a refresh or a shared link opens the same view.
 * The first item is the default and has no ?view.
 */
export default function SubTabs({ items }: { items: { key: string; label: string }[] }) {
  const [search, setSearch] = useSearchParams()
  const active = search.get('view') ?? items[0].key
  return (
    <div className="lk-tabs ap-tabs sub-tabs">
      {items.map((t, i) => (
        <button
          key={t.key}
          type="button"
          className={active === t.key ? 'on' : ''}
          onClick={() => {
            const next = new URLSearchParams()
            if (i > 0) next.set('view', t.key)
            setSearch(next)
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function useView(first: string): string {
  const [search] = useSearchParams()
  return search.get('view') ?? first
}
