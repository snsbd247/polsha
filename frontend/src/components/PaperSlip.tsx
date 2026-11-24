import type { ReactNode } from 'react'
import { QRCode } from 'antd'
import { logoUrl } from '../lib/settings'
import type { Society } from '../lib/settings'
import { digits, fmtDate } from '../lib/format'
import { nameOf, t as tx } from '../lib/i18n'
import './paper-slip.css'

/**
 * The society's own receipt slips (সেচ চার্জ, পানির বিল, শেয়ার-সঞ্চয়) as
 * printed on its paper books: the logo beside the name, the registration
 * line, the address on a dark band, the phones, the title in a dark pill,
 * then dotted lines filled in, a small table where the paper has one, and
 * the signatures at the foot. Used inside ReceiptPaper (copies, seal, reprint mark).
 */
export function SlipHead({ society, title, qr, serial, date }: { society: Society & { registration_date?: string | null; phone_alt?: string | null }; title: string; qr?: string; serial?: ReactNode; date?: ReactNode }) {
  const phones = [society.phone, society.phone_alt].filter(Boolean).map((p) => digits(p!))
  return (
    <>
      <div className="ps-head">
        {society.logo && <img className="ps-logo" src={logoUrl()} alt="" />}
        <div className="ps-brand">
          <div className="ps-name">{nameOf(society)}</div>
          {(society.registration_no || society.registration_date) && (
            <div className="ps-reg">
              {society.registration_no && `${tx('রেজিঃ নং')}- ${digits(society.registration_no)}`}
              {society.registration_date && `, ${tx('তারিখ')} : ${fmtDate(society.registration_date)} ${tx('খ্রিঃ')}`}
            </div>
          )}
          {society.address && <div className="ps-band">{society.address}</div>}
          {phones.length > 0 && <div className="ps-phones">{tx('ফোন')} : {phones.join(', ')}</div>}
        </div>
        {qr && society.show_qr !== false && (
          <div className="ps-qr">
            <QRCode value={qr} size={58} bordered={false} />
          </div>
        )}
      </div>
      <div className="ps-title">
        <span>{title}</span>
      </div>
      {(serial || date) && (
        <div className="ps-serial">
          <span>
            {tx('ক্রমিক নং')}- <b>{serial}</b>
          </span>
          {date && (
            <span>
              {tx('তারিখ')} : <u>{date}</u>
            </span>
          )}
        </div>
      )}
    </>
  )
}

/** "label : value" on a dotted line, as written on the paper slip; an empty value leaves the dots for handwriting. */
export function SlipLine({ label, value, strong }: { label: string; value?: ReactNode; strong?: boolean }) {
  return (
    <div className="ps-line">
      <span className="ps-l">{label} :</span>
      <span className={`ps-v${strong ? ' ps-strong' : ''}`}>{value}</span>
    </div>
  )
}

/** Several dotted fields side by side on one line. */
export function SlipRow({ children }: { children: ReactNode }) {
  return <div className="ps-row">{children}</div>
}

/** The signature lines at the foot of the slip. */
export function SlipSigns({ labels }: { labels: string[] }) {
  return (
    <div className="ps-signs">
      {labels.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  )
}

/** Whole taka like the paper ("৯৫০০"), with paisa only when there is some. */
export const slipTaka = (v: number | null | undefined) => {
  const n = Number(v ?? 0)
  if (!n) return ''
  return digits(Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n).toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
}
