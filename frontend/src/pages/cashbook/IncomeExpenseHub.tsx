import SubTabs, { useView } from '../../components/SubTabs'
import { t as tx } from '../../lib/i18n'
import CashBookSheetPage from './CashBookSheetPage'
import IncomeExpenseBookPage from './IncomeExpenseBookPage'

/**
 * The income-expense cash book menu item: the society's book, the
 * irrigation book (both laid out like the paper book), and the plain list of
 * every income and expense line.
 */
export default function IncomeExpenseHub() {
  const view = useView('society')
  const tabs = (
    <SubTabs
      items={[
        { key: 'society', label: tx('সমিতির আয়-ব্যয় নগদ বই') },
        { key: 'irrigation', label: tx('সেচের আয়-ব্যয় নগদ বই') },
        { key: 'water', label: tx('পানির আয়-ব্যয় নগদ বই') },
        { key: 'list', label: tx('সব আয়-ব্যয় এন্ট্রি') },
      ]}
    />
  )
  if (view === 'list') return <IncomeExpenseBookPage tabs={tabs} />
  return <CashBookSheetPage key={view} stream={view === 'irrigation' || view === 'water' ? view : 'society'} tabs={tabs} />
}
