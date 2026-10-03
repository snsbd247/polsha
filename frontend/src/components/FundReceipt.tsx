import { accountLabel, money } from '../lib/accounting'
import { digits, fmtDate } from '../lib/format'
import { KIND_LABEL, type FundKind, type FundTxn, type MemberBrief, type Person } from '../lib/funds'
import { METHOD_LABEL, amountInWords } from '../lib/irrigation'
import { type Society } from '../lib/settings'
import { nameOf, t as tx } from '../lib/i18n'
import { ReceiptFacts, ReceiptFoot, ReceiptMeta, ReceiptPaper, ReceiptSign, ReceiptTop } from './PrintParts'

type Acc = { code: string; name_bn: string; name_en: string | null } | null
export type FundTxnDetail = FundTxn & {
  approval_request_id: number | null
  cancelled_at: string | null
  posted_at: string | null
  type_label: string
  can_cancel: boolean
  account: { id: number; account_no: string; member_id: number; balance: string; member: (MemberBrief & { farmer: MemberBrief['farmer'] & { father_name: string; mobile: string | null } }) | null }
  fund: Acc
  counter_account: Acc
  journal: { id: number; voucher_no: string; status: string; reversed_by: { id: number; voucher_no: string } | null } | null
  creator: Person
  pair: { id: number; txn_no: string; account: { id: number; account_no: string; member: MemberBrief | null } | null } | null
  run: { id: number; run_no: string; title: string } | null
  society: Society
  timeline: { id: number; event: string | null; event_label: string; at: string; by: Person; reason: string | null }[]
}

/** The printable deposit / withdrawal slip of one savings or share transaction. */
export default function FundReceipt({ t, kind }: { t: FundTxnDetail; kind: FundKind }) {
  const amount = Number(t.amount)
  const farmer = t.account.member?.farmer
  const title = t.direction === 'in' ? tx('{{p0}} জমার রশিদ', { p0: KIND_LABEL[kind] }) : tx('{{p0}} খরচের রশিদ', { p0: KIND_LABEL[kind] })

  return (
    <ReceiptPaper society={t.society} doc={{ type: 'member_transaction', id: t.id }} payerCopy={tx('সদস্য কপি')}>
      {t.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
      {t.status === 'pending' && <div className="receipt-stamp">{tx('অনুমোদনের অপেক্ষায়')}</div>}
      <ReceiptTop society={t.society} title={title} />
      <ReceiptMeta
        lines={[
          <>
            {tx('লেনদেন নং')}: {digits(t.txn_no)}
          </>,
          <>
            {tx('{{p0}} হিসাব নং', { p0: KIND_LABEL[kind] })}: {digits(t.account.account_no)}
          </>,
        ]}
        date={
          <>
            {tx('তারিখ')}: {fmtDate(t.date)} {tx('ইং')}
          </>
        }
      />
      <ReceiptFacts
        rows={[
          [tx('সদস্যের নাম ও সদস্য নং'), `${nameOf(farmer)}-${digits(t.account.member?.member_no)}`],
          [tx('পিতা/স্বামীর নাম'), farmer?.father_name || '—'],
          [tx('মোবাইল নং'), farmer?.mobile ? digits(farmer.mobile) : tx('নেই')],
          [
            tx('বিবরণ'),
            <>
              {t.type_label}
              {t.pair?.account && ` — ${nameOf(t.pair.account.member?.farmer)} (${digits(t.pair.account.account_no)})`}
              {t.run && ` — ${t.run.title}`}
            </>,
          ],
          [t.direction === 'in' ? tx('জমার পরিমাণ') : tx('উত্তোলনের পরিমাণ'), <strong key="a">{money(amount)}৳</strong>],
          [tx('কথায়'), amountInWords(amount)],
          [tx('লেনদেনের পর জের'), t.balance_after === null ? null : `${money(t.balance_after)}৳`],
          [tx('মাধ্যম'), t.method ? `${METHOD_LABEL[t.method] ?? t.method}${t.method !== 'cash' && t.fund ? ` — ${accountLabel(t.fund)}` : ''}${t.reference ? `, ${tx('রেফারেন্স')}: ${digits(t.reference)}` : ''}` : null],
          [tx('মন্তব্য'), t.remarks],
        ]}
      />
      <ReceiptSign society={t.society} collector={nameOf(t.creator)} left={tx('সদস্যের স্বাক্ষর')} right={tx('দায়িত্বপ্রাপ্ত কর্মকর্তার স্বাক্ষর')} />
      <ReceiptFoot society={t.society} fallback={tx('এটি সিস্টেম-জেনারেটেড রশিদ। অনুগ্রহ করে আপনার রেকর্ডের জন্য সংরক্ষণ করুন।')} />
    </ReceiptPaper>
  )
}
