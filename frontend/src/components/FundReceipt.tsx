import { accountLabel, money } from '../lib/accounting'
import { digits, fmtDate } from '../lib/format'
import { KIND_LABEL, type FundKind, type FundTxn, type MemberBrief, type Person } from '../lib/funds'
import { METHOD_LABEL, amountInWords } from '../lib/irrigation'
import { logoUrl, type Society } from '../lib/settings'
import { nameOf, t as tx } from '../lib/i18n'
import { Letterhead, ReceiptFoot, ReceiptPaper, ReceiptSign } from './PrintParts'

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
    <ReceiptPaper society={t.society} doc={{ type: "member_transaction", id: t.id }}>
      {t.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
      {t.status === 'pending' && <div className="receipt-stamp">{tx('অনুমোদনের অপেক্ষায়')}</div>}
      <div className="receipt-head">
        {t.society.logo && <img src={logoUrl()} alt="" className="receipt-logo" />}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="receipt-society">{nameOf(t.society)}</div>
          <Letterhead society={t.society} />
          {t.society.address && <div style={{ whiteSpace: 'pre-line' }}>{t.society.address}</div>}
          <div>
            {t.society.registration_no && tx('নিবন্ধন নং: {{p0}}', { p0: digits(t.society.registration_no) })}
            {t.society.registration_no && t.society.phone && ' · '}
            {t.society.phone && tx('ফোন: {{p0}}', { p0: digits(t.society.phone) })}
          </div>
          <div className="receipt-title">{title}</div>
        </div>
      </div>

      <table className="receipt-meta">
        <tbody>
          <tr>
            <td>
              {tx('লেনদেন নং')}: <strong>{digits(t.txn_no)}</strong>
            </td>
            <td style={{ textAlign: 'right' }}>
              {tx('তারিখ')}: <strong>{fmtDate(t.date)}</strong>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              {tx('সদস্যের নাম')}: <strong>{nameOf(farmer)}</strong> ({tx('সদস্য নং')} {digits(t.account.member?.member_no)}){farmer && `, ${tx('পিতা: {{p0}}', { p0: farmer.father_name })}`}
              {farmer?.mobile && `, ${tx('মোবাইল')}: ${digits(farmer.mobile)}`}
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              {tx('{{p0}} হিসাব নং', { p0: KIND_LABEL[kind] })}: <strong>{digits(t.account.account_no)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="receipt-items">
        <thead>
          <tr>
            <th>{tx('বিবরণ')}</th>
            <th>{tx('জমা')}</th>
            <th>{tx('খরচ')}</th>
            <th>{tx('লেনদেনের পর জের')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {t.type_label}
              {t.pair?.account && (
                <>
                  {' '}
                  — {nameOf(t.pair.account.member?.farmer)} ({digits(t.pair.account.account_no)})
                </>
              )}
              {t.run && <> — {t.run.title}</>}
            </td>
            <td className="num">{t.direction === 'in' ? money(amount) : ''}</td>
            <td className="num">{t.direction === 'out' ? money(amount) : ''}</td>
            <td className="num">{t.balance_after === null ? '' : money(t.balance_after)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ margin: '8px 0' }}>
        {tx('কথায়')}: <strong>{amountInWords(amount)}</strong>
      </div>
      {t.method && (
        <div>
          {tx('মাধ্যম')}: {METHOD_LABEL[t.method] ?? t.method}
          {t.method !== 'cash' && t.fund && ` — ${accountLabel(t.fund)}`}
          {t.reference && `, ${tx('রেফারেন্স')}: ${digits(t.reference)}`}
        </div>
      )}
      {t.remarks && (
        <div>
          {tx('মন্তব্য')}: {t.remarks}
        </div>
      )}

      <ReceiptSign society={t.society} collector={nameOf(t.creator)} left={tx('সদস্যের স্বাক্ষর')} right={tx('দায়িত্বপ্রাপ্ত কর্মকর্তার স্বাক্ষর')} />
      <ReceiptFoot society={t.society} fallback={tx('কম্পিউটারে তৈরি রশিদ।')} />
    </ReceiptPaper>
  )
}
