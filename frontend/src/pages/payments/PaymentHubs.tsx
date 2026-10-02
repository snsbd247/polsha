import SubTabs, { useView } from '../../components/SubTabs'
import { t as tx } from '../../lib/i18n'
import CombinedPaymentListPage from './CombinedPaymentListPage'
import CombinedPaymentPage from './CombinedPaymentPage'
import IrrigationCollectPage from './IrrigationCollectPage'
import ReceiptListPage from './ReceiptListPage'

/** "টাকা আদায়": one farmer's every due on one receipt, or many farmers' irrigation bills at once. */
export function CollectHubPage() {
  const tabs = (
    <SubTabs
      items={[
        { key: 'one', label: tx('একজন কৃষক — সব বকেয়া') },
        { key: 'bulk', label: tx('একসাথে অনেক কৃষকের সেচ বিল') },
      ]}
    />
  )
  return useView('one') === 'bulk' ? <IrrigationCollectPage tabs={tabs} /> : <CombinedPaymentPage tabs={tabs} />
}

/** "রশিদ": every receipt in one place — combined receipts and irrigation receipts. */
export function ReceiptsHubPage() {
  const tabs = (
    <SubTabs
      items={[
        { key: 'combined', label: tx('সমন্বিত রশিদ') },
        { key: 'irrigation', label: tx('সেচের রশিদ') },
      ]}
    />
  )
  return useView('combined') === 'irrigation' ? <ReceiptListPage tabs={tabs} /> : <CombinedPaymentListPage tabs={tabs} />
}
