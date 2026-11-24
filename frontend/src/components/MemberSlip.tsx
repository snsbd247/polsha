import type { ReactNode } from 'react'
import { digits, fmtDate } from '../lib/format'
import { amountInWords } from '../lib/irrigation'
import type { Society } from '../lib/settings'
import { t as tx } from '../lib/i18n'
import { SlipHead, SlipLine, SlipSigns, slipTaka } from './PaperSlip'

export type MemberSlipAmounts = {
  admission?: number
  share?: number
  savings?: number
  loanPrincipal?: number
  loanProfit?: number
  loanForm?: number
  irrigation?: number
  water?: number
  misc?: number
  miscNote?: string
}

/**
 * "শেয়ার সঞ্চয় আদায়ের রসিদ" — the society's one member slip for whatever a
 * member pays at the counter: admission fee, shares, savings, a loan's
 * principal and profit (interest and penalty), the loan form and anything
 * else, with the total in words. Irrigation and water lines appear only when
 * a combined payment carries them. Goes inside ReceiptPaper.
 */
export default function MemberSlip({ society, serial, date, name, memberNo, father, village, amounts, qr, extra }: {
  society: Society
  serial: string
  date: string
  name: string
  memberNo?: string | number | null
  father?: string | null
  village?: string | null
  amounts: MemberSlipAmounts
  qr?: string
  extra?: ReactNode
}) {
  const a = amounts
  const total = [a.admission, a.share, a.savings, a.loanPrincipal, a.loanProfit, a.loanForm, a.irrigation, a.water, a.misc].reduce<number>((n, v) => n + Number(v ?? 0), 0)
  return (
    <>
      <SlipHead society={society} title={tx('শেয়ার সঞ্চয় আদায়ের রসিদ')} qr={qr} serial={digits(serial)} date={fmtDate(date)} />
      <SlipLine label={tx('সদস্য/সদস্যার নাম')} value={name} />
      <SlipLine label={tx('সদস্য নং')} value={memberNo ? digits(String(memberNo)) : ''} />
      <SlipLine label={tx('পিতা/স্বামীর নাম')} value={father ?? ''} />
      <SlipLine label={tx('গ্রাম')} value={village ?? ''} />
      <SlipLine label={tx('ভর্তি ফি')} value={slipTaka(a.admission)} />
      <SlipLine label={tx('শেয়ার আদায়')} value={slipTaka(a.share)} />
      <SlipLine label={tx('সঞ্চয় আদায়')} value={slipTaka(a.savings)} />
      <SlipLine label={tx('ঋণ আসল আদায়')} value={slipTaka(a.loanPrincipal)} />
      <SlipLine label={tx('ঋণ লাভ আদায়')} value={slipTaka(a.loanProfit)} />
      <SlipLine label={tx('ঋণ ফরম')} value={slipTaka(a.loanForm)} />
      {!!a.irrigation && <SlipLine label={tx('সেচ চার্জ আদায়')} value={slipTaka(a.irrigation)} />}
      {!!a.water && <SlipLine label={tx('পানির বিল আদায়')} value={slipTaka(a.water)} />}
      <SlipLine label={tx('বিবিধ আদায়')} value={`${slipTaka(a.misc)}${a.miscNote ? ` (${a.miscNote})` : ''}`} />
      <SlipLine label={tx('মোট আদায়')} value={slipTaka(total)} strong />
      <SlipLine label={tx('কথায়')} value={total ? amountInWords(total) : ''} />
      {extra}
      <SlipSigns labels={[tx('হিসাব রক্ষকের স্বাক্ষর'), tx('আদায়কারীর স্বাক্ষর')]} />
    </>
  )
}
