import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { t as tx } from '../lib/i18n'
import '../pages/irrigation/rates.css'
import '../pages/approvals/approvals.css'
import './page-tabs.css'

type Tab = { path: string; label: string; perm?: string | string[] }

/**
 * Pages that belong together, each still its own menu item: a row of tabs
 * under the breadcrumb lets the user step between them without the menu.
 * The side menu itself is not changed.
 */
const GROUPS: Tab[][] = [
  [
    { path: '/farmers', label: tx('সব কৃষক'), perm: 'farmer.view' },
    { path: '/farmers/deleted', label: tx('মুছে ফেলা কৃষক'), perm: 'farmer.view' },
  ],
  [
    { path: '/members', label: tx('সদস্য তালিকা'), perm: 'member.view' },
    { path: '/members/admission-register', label: tx('ভর্তি রেজিস্টার'), perm: 'member.view' },
  ],
  [
    { path: '/members/voters', label: tx('ভোটার তালিকা'), perm: 'member.view' },
    { path: '/members/voter-history', label: tx('ভোটার ইতিহাস'), perm: 'member.view' },
    { path: '/members/voter-audit', label: tx('ভোটার অডিট'), perm: 'member.view' },
  ],
  [
    { path: '/farmers/merge', label: tx('কৃষক একীকরণ'), perm: 'farmer.edit' },
    { path: '/farmers/duplicates', label: tx('সম্ভাব্য ডুপ্লিকেট'), perm: 'farmer.view' },
  ],
  [
    { path: '/masters/patwaris', label: tx('পাটোয়ারী তালিকা'), perm: 'patwari.view' },
    { path: '/masters/mouzas', label: tx('মৌজা ব্যবস্থাপনা') },
  ],
  [
    { path: '/lands/owners', label: tx('মালিক ও চাষি'), perm: 'land.view' },
    { path: '/lands/borga', label: tx('বর্গা চাষ'), perm: 'land.view' },
  ],
  [
    { path: '/lands/transfers/new', label: tx('নতুন হস্তান্তর'), perm: 'land.edit' },
    { path: '/lands/transfers', label: tx('হস্তান্তরের তালিকা'), perm: 'land.view' },
  ],
  [
    { path: '/lands/lookup', label: tx('জমির প্রোফাইল'), perm: 'land.view' },
    { path: '/lands/lookup/history', label: tx('জমির ইতিহাস'), perm: 'land.view' },
  ],
  // accounting
  [
    { path: '/accounting/journals', label: tx('ভাউচার'), perm: 'accounting.view' },
    { path: '/accounting/journals/new', label: tx('জার্নাল এন্ট্রি'), perm: 'accounting.create' },
    { path: '/accounting/journals/new?type=opening', label: tx('প্রারম্ভিক নগদ জের'), perm: 'accounting.create' },
  ],
  [
    { path: '/accounting/bank-reconciliations', label: tx('মাসিক ব্যাংক মিলকরণ'), perm: 'bank.view' },
    { path: '/accounting/payment-reconciliation', label: tx('পেমেন্ট মিলকরণ'), perm: 'payment.view' },
    { path: '/funds/share/audit', label: tx('শেয়ার মূলধন মিলকরণ'), perm: 'share.view' },
    { path: '/accounting/source-vs-ledger', label: tx('উৎস বনাম খতিয়ান'), perm: 'accounting.view' },
    { path: '/accounting/ledger-integrity', label: tx('লেজার সঠিকতা'), perm: 'accounting.view' },
  ],
  [
    { path: '/accounting/bank-accounts', label: tx('ব্যাংক হিসাব'), perm: 'bank.view' },
    { path: '/accounting/irrigation-cash-bank', label: tx('সেচের নগদ ও ব্যাংক'), perm: ['accounting.view', 'cash.view', 'bank.view'] },
  ],
  [
    { path: '/accounting/public-payments', label: tx('অনলাইন পেমেন্ট অনুরোধ'), perm: 'payment.view' },
    { path: '/accounting/payment-reconciliation', label: tx('পেমেন্ট মিলকরণ'), perm: 'payment.view' },
  ],
  // assets
  [
    { path: '/assets', label: tx('সম্পদ রেজিস্টার'), perm: 'asset.view' },
    { path: '/assets/stock', label: tx('স্টক'), perm: 'asset.view' },
    { path: '/assets/sales', label: tx('বিক্রয়'), perm: 'asset.view' },
  ],
  [
    { path: '/assets/transfers', label: tx('সম্পদ স্থানান্তর'), perm: 'asset.view' },
    { path: '/assets/installations', label: tx('স্থাপন'), perm: 'asset.view' },
    { path: '/assets/repairs', label: tx('মেরামত'), perm: 'asset.view' },
    { path: '/assets/maintenances', label: tx('মেরামত সূচি'), perm: 'asset.view' },
  ],
  [
    { path: '/qr/scan', label: tx('QR স্ক্যানার') },
    { path: '/qr/history', label: tx('QR ইতিহাস') },
  ],
]

/** A tab's path may carry a query (?type=opening): it is the page only when those values are in the address too. */
function matches(tabPath: string, here: string, params: URLSearchParams): boolean {
  const [path, query] = tabPath.split('?')
  if (path !== here) return false
  return !query || [...new URLSearchParams(query)].every(([k, v]) => params.get(k) === v)
}

/** The tabs of the group the current page belongs to; nothing on any other page. */
export default function PageTabs() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { can } = useAuth()
  const here = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)
  const group = GROUPS.find((g) => g.some((t) => matches(t.path, here, params)))
  const tabs = group?.filter((t) => !t.perm || can(t.perm)) ?? []
  if (tabs.length < 2) return null
  // the most specific tab wins: /new?type=opening over /new
  const active = tabs.filter((t) => matches(t.path, here, params)).sort((a, b) => b.path.length - a.path.length)[0]?.path
  return (
    <div className="lk-tabs ap-tabs sub-tabs page-tabs no-print">
      {tabs.map((t) => (
        <button key={t.path} type="button" className={t.path === active ? 'on' : ''} onClick={() => t.path !== active && navigate(t.path)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
