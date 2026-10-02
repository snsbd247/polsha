import { useAuth } from '../../auth/AuthContext'
import SubTabs, { useView } from '../../components/SubTabs'
import { t as tx } from '../../lib/i18n'
import IrrigationTypesPage from '../settings/IrrigationTypesPage'
import BulkInvoicePage from './BulkInvoicePage'
import CategoryRatesPage from './CategoryRatesPage'
import InvoiceFormPage from './InvoiceFormPage'
import RateAuditPage from './RateAuditPage'
import RatesPage from './RatesPage'

/** "সেচের রেট": the list, the source × land-type grid, the change history, and (for admins) the irrigation sources. */
export function RatesHubPage() {
  const { can } = useAuth()
  const view = useView('list')
  const tabs = (
    <SubTabs
      items={[{ key: 'list', label: tx('রেটের তালিকা') }, { key: 'grid', label: tx('উৎস × জমির ধরন ছক') }, { key: 'history', label: tx('রেট বদলের ইতিহাস') }, ...(can('settings.admin') ? [{ key: 'sources', label: tx('সেচের উৎস') }] : [])]}
    />
  )
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
