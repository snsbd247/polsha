import { useAuth } from '../../auth/AuthContext'
import SubTabs, { useView } from '../../components/SubTabs'
import { t as tx } from '../../lib/i18n'
import IrrigationTypesPage from '../settings/IrrigationTypesPage'
import BulkInvoicePage from './BulkInvoicePage'
import CategoryRatesPage from './CategoryRatesPage'
import InvoiceFormPage from './InvoiceFormPage'
import LiftRatesPage from './LiftRatesPage'
import LiftsPage from './LiftsPage'
import RateAuditPage from './RateAuditPage'
import RatesPage from './RatesPage'

/** "সেচের রেট": the list, the source × lift grid, the source × land-type grid, the change history, the lifts and (for admins) the irrigation sources. */
export function RatesHubPage() {
  const { can } = useAuth()
  const view = useView('list')
  const tabs = (
    <SubTabs
      items={[
        { key: 'list', label: tx('রেটের তালিকা') },
        { key: 'lift', label: tx('লিফট অনুযায়ী রেট') },
        { key: 'grid', label: tx('উৎস × জমির ধরন ছক') },
        { key: 'history', label: tx('রেট বদলের ইতিহাস') },
        { key: 'lifts', label: tx('লিফট') },
        ...(can('settings.admin') ? [{ key: 'sources', label: tx('সেচের উৎস') }] : []),
      ]}
    />
  )
  if (view === 'lift') return <LiftRatesPage tabs={tabs} />
  if (view === 'lifts') return <LiftsPage tabs={tabs} />
  if (view === 'grid') return <CategoryRatesPage tabs={tabs} />
  if (view === 'history') return <RateAuditPage tabs={tabs} />
  if (view === 'sources' && can('settings.admin')) return <IrrigationTypesPage tabs={tabs} />
  return <RatesPage tabs={tabs} />
}

/** "বিল তৈরি": bill many plots of a mouza at once, or one plot. */
export function BillingHubPage() {
  const tabs = (
    <SubTabs
      items={[
        { key: 'bulk', label: tx('একসাথে অনেক জমির বিল') },
        { key: 'one', label: tx('একটি জমির বিল') },
      ]}
    />
  )
  return useView('bulk') === 'one' ? <InvoiceFormPage tabs={tabs} /> : <BulkInvoicePage tabs={tabs} />
}
