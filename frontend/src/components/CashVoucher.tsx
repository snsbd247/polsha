import { digits, fmtDate } from '../lib/format'
import { amountInWords } from '../lib/irrigation'
import { logoUrl, type Society } from '../lib/settings'
import { nameOf, t as tx } from '../lib/i18n'
import { ReceiptPaper } from './PrintParts'
import { SlipSigns } from './PaperSlip'
import './paper-slip.css'

type Line = { id: number; debit: number; credit: number; remarks: string | null; account: { code: string; name_bn: string; name_en: string | null } }

const TITLE: Record<string, string> = {
  payment: 'ক্যাশ ক্রেডিট ভাউচার',
  receipt: 'ক্যাশ ডেবিট ভাউচার',
  contra: 'কন্ট্রা ভাউচার',
  journal: 'জার্নাল ভাউচার',
  opening: 'প্রারম্ভিক জের ভাউচার',
}
const ROWS = 5

/**
 * The society's cash voucher (ক্যাশ ক্রেডিট ভাউচার) as on its paper pad:
 * addressed to the president/secretary, one line per head with the ledger
 * page, account code, taka and paisa, the total in words, and the
 * accountant's, secretary's and president's signatures. A payment lists the
 * heads paid; a receipt the heads received; any other voucher its debits.
 */
export default function CashVoucher({ society, voucherNo, type, date, narration, lines, cancelled }: {
  society: Society
  voucherNo: string
  type: string
  date: string
  narration: string | null
  lines: Line[]
  cancelled?: boolean
}) {
  const side = type === 'receipt' ? 'credit' : 'debit'
  const heads = lines.filter((l) => Number(l[side]) > 0)
  const total = heads.reduce((n, l) => n + Number(l[side]), 0)
  const rows = [...heads, ...Array.from({ length: Math.max(0, ROWS - heads.length - (narration ? 1 : 0)) }, () => null)]
  const taka = (v: number) => digits(Math.floor(v).toLocaleString('en-IN'))
  const paisa = (v: number) => digits(String(Math.round((v - Math.floor(v)) * 100)).padStart(2, '0'))

  return (
    <ReceiptPaper society={society} single>
      {cancelled && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
      <div className="ps-head">
        {society.logo && <img className="ps-logo" src={logoUrl()} alt="" />}
        <div className="ps-brand">
          <div className="ps-name">{nameOf(society)}</div>
          {society.address && <div className="ps-reg">{society.address}</div>}
        </div>
      </div>
      <div className="ps-serial">
        <div className="ps-to">
          {tx('বরাবর')},
          <br />
          {tx('সভাপতি/সম্পাদক')}
        </div>
        <div style={{ textAlign: 'right' }}>
          {tx('তারিখ')} : <u>{fmtDate(date)}</u>
          <br />
          {tx('ভাউচার নং')} : <b>{digits(voucherNo)}</b>
        </div>
      </div>
      <table className="ps-table ps-voucher">
        <colgroup>
          <col />
          <col style={{ width: '13%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '9%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ps-voucher-title">{tx(TITLE[type] ?? 'ভাউচার')}</th>
            <th>{tx('খতিয়ান পৃষ্ঠা')}</th>
            <th>{tx('হিসাব কোড')}</th>
            <th>{tx('টাকা')}</th>
            <th>{tx('পয়সা')}</th>
          </tr>
        </thead>
        <tbody>
          {narration && (
            <tr>
              <td>{narration}</td>
              <td />
              <td />
              <td />
              <td />
            </tr>
          )}
          {rows.map((l, i) => (
            <tr key={l?.id ?? `blank${i}`}>
              <td>
                {l && (
                  <>
                    {nameOf(l.account)}
                    {l.remarks && <small> — {l.remarks}</small>}
                  </>
                )}
              </td>
              <td />
              <td className="ps-c">{l ? digits(l.account.code) : ''}</td>
              <td className="ps-num">{l ? taka(Number(l[side])) : ''}</td>
              <td className="ps-c">{l ? paisa(Number(l[side])) : ''}</td>
            </tr>
          ))}
          <tr>
            <td>
              {tx('কথায়')} : {total ? amountInWords(total) : ''}
            </td>
            <td />
            <td />
            <td className="ps-num">
              <b>{taka(total)}</b>
            </td>
            <td className="ps-c">
              <b>{paisa(total)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <SlipSigns labels={[tx('হিসাবরক্ষক'), tx('সম্পাদক'), tx('সভাপতি')]} />
    </ReceiptPaper>
  )
}
