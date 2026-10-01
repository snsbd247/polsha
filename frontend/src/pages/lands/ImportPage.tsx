import { useSearchParams } from 'react-router-dom'
import ImportWizard from '../../components/ImportWizard'
import { ImportFrame } from '../imports/ImportTypePage'
import { t as tx } from '../../lib/i18n'

const TYPES = { farmers: tx('কৃষক'), lands: tx('জমি') } as const
type ImportType = keyof typeof TYPES

const HELP: Record<ImportType, string[]> = {
  farmers: [
    tx('উপজেলা, ইউনিয়ন, গ্রাম ও মৌজা (JL নম্বর) আগে "এলাকা" ও "মৌজা" পাতায় থাকতে হবে।'),
    tx('লিঙ্গ: পুরুষ / মহিলা / অন্যান্য। বাংলা অঙ্ক চলবে; মোবাইলের শুরুর ০ বাদ পড়লে সিস্টেম নিজে যোগ করবে।'),
    tx('"সদস্য নং" দিলে পুরোনো খাতার সদস্য হিসেবে সেই নম্বরেই যুক্ত হবে (সাথে "ভর্তির তারিখ" দিন/মাস/বছর)।'),
  ],
  lands: [
    tx('মালিক/চাষি: Farmer ID (F-000001), NID বা সদস্য নং দিয়ে চেনানো যাবে। একাধিক মালিক: "F-000001:50; F-000002:50"। অংশ না দিলে সমান ভাগ।'),
    tx('পরিমাণে একক লেখা যাবে: "৩৩", "১.৫ একর", "২ বিঘা"। একক না দিলে "একক" কলাম, তা-ও না থাকলে শতক।'),
    tx('চাষের ধরন: নিজ / বর্গা / লিজ। না দিলে চাষি মালিক হলে "নিজ", নইলে "বর্গা"।'),
  ],
}

/** Farmer or land import (?type=farmers|lands, one menu item each). */
export default function ImportPage() {
  const [search] = useSearchParams()
  const active: ImportType = search.get('type') === 'lands' ? 'lands' : 'farmers'
  return (
    <ImportFrame title={active === 'lands' ? tx('জমি ইমপোর্ট') : tx('কৃষক ইমপোর্ট')}>
      <ImportWizard key={active} type={active} help={HELP[active]} />
    </ImportFrame>
  )
}
