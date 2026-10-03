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
]

/** The tabs of the group the current page belongs to; nothing on any other page. */
export default function PageTabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { can } = useAuth()
  const here = pathname.replace(/\/+$/, '') || '/'
  const group = GROUPS.find((g) => g.some((t) => t.path === here))
  const tabs = group?.filter((t) => !t.perm || (Array.isArray(t.perm) ? t.perm.some((p) => can(p)) : can(t.perm))) ?? []
  if (tabs.length < 2) return null
  return (
    <div className="lk-tabs ap-tabs sub-tabs page-tabs no-print">
      {tabs.map((t) => (
        <button key={t.path} type="button" className={t.path === here ? 'on' : ''} onClick={() => t.path !== here && navigate(t.path)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
