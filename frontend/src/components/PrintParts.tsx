import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCode } from 'antd'
import { api } from '../lib/api'
import { digits } from '../lib/format'
import { nameOf, t as tx } from '../lib/i18n'
import { logoUrl, settingImagePath, type Society } from '../lib/settings'
import './receipt.css'

/** Signature/seal images come from an authenticated endpoint, so fetch them as blobs. */
export function useSettingImage(slot: 'signature' | 'seal', enabled = true) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    if (!enabled) return
    let url: string | undefined
    let cancelled = false
    api
      .get(settingImagePath(slot), { baseURL: '', responseType: 'blob' })
      .then((r) => {
        if (cancelled) return
        url = URL.createObjectURL(r.data)
        setSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [slot, enabled])
  return enabled ? src : undefined
}

export type PrintDoc = { type: 'receipt' | 'combined_payment' | 'loan_payment' | 'member_transaction'; id: number }

/**
 * Counts earlier prints of a receipt and records each new one (the print
 * button, ?print=1 and Ctrl+P all fire "beforeprint"). Returns how many
 * prints came before, so a reprint can say so on the paper.
 */
function usePrintLog(doc?: PrintDoc) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['print-logs', doc?.type, doc?.id],
    queryFn: async () => (await api.get<{ count: number }>('/print-logs', { params: { document_type: doc!.type, document_id: doc!.id } })).data.count,
    enabled: !!doc,
    staleTime: Infinity,
  })
  useEffect(() => {
    if (!doc) return
    const log = () => {
      api
        .post('/print-logs', { document_type: doc.type, document_id: doc.id })
        .then(() => queryClient.invalidateQueries({ queryKey: ['print-logs', doc.type, doc.id] }))
        .catch(() => undefined)
    }
    window.addEventListener('beforeprint', log)
    return () => window.removeEventListener('beforeprint', log)
  }, [doc?.type, doc?.id, queryClient]) // eslint-disable-line react-hooks/exhaustive-deps
  return data ?? 0
}

/**
 * The printed sheet, once or twice on the paper size set in Receipt Settings:
 * with two copies the payer's copy comes first and the office copy below a
 * cut line, both on one A4 sheet. The society's name runs faintly across
 * each copy, and the seal is stamped once per copy.
 */
export function ReceiptPaper({ society, children, doc, payerCopy }: { society: Society; children: ReactNode; doc?: PrintDoc; payerCopy?: string }) {
  const seal = useSettingImage('seal', !!society.seal)
  const printed = usePrintLog(doc)
  const copies = society.copies === 2 ? [payerCopy ?? tx('গ্রাহক কপি'), tx('অফিস কপি')] : [null]
  return (
    <div className={`rc-sheet rc-copies-${copies.length}`}>
      {copies.map((label, i) => (
        <div key={i} className={`receipt-paper rc-paper paper-${society.paper ?? 'a4'}`}>
          {(label || printed > 0) && (
            <div className="rc-copy">
              {label}
              {printed > 0 && <span className="rc-dup">{tx('প্রতিলিপি — কপি {{p0}}', { p0: digits(printed + 1) })}</span>}
            </div>
          )}
          <div className="rc-watermark" aria-hidden>
            {society.name_en || society.name_bn}
          </div>
          <div className="rc-body">{children}</div>
          {seal && <img src={seal} alt="" className="receipt-seal" />}
        </div>
      ))}
    </div>
  )
}

/** The head of a receipt: the society's logo and name on the left, the receipt's title in the middle, the QR to check it on the right. */
export function ReceiptTop({ society, title, qr }: { society: Society; title: string; qr?: string }) {
  return (
    <div className="rc-top">
      <div className="rc-brand">
        {society.logo && <img src={logoUrl()} alt="" />}
        <div>
          <div className="rc-name">{nameOf(society)}</div>
          <Letterhead society={society} />
          {society.address && <div className="rc-addr">{society.address}</div>}
          {(society.registration_no || society.phone) && (
            <div className="rc-addr">
              {society.registration_no && tx('নিবন্ধন নং: {{p0}}', { p0: digits(society.registration_no) })}
              {society.registration_no && society.phone && ' · '}
              {society.phone && tx('ফোন: {{p0}}', { p0: digits(society.phone) })}
            </div>
          )}
        </div>
      </div>
      <div className="rc-title">{title}</div>
      <div className="rc-qr">
        {qr && society.show_qr !== false && (
          <>
            <QRCode value={qr} size={64} bordered={false} />
            <small>{tx('যাচাই করুন')}</small>
          </>
        )}
      </div>
    </div>
  )
}

/** The receipt's number and what it was for on the left, the date on the right. */
export function ReceiptMeta({ lines, date }: { lines: ReactNode[]; date: ReactNode }) {
  return (
    <div className="rc-meta">
      <div>
        {lines.filter(Boolean).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="rc-date">{date}</div>
    </div>
  )
}

/** The boxed facts of the receipt, one "label : value" per line; empty values are left out. */
export function ReceiptFacts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="rc-facts">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
        .map(([label, value]) => (
          <div key={label} className="rc-fact">
            <span>{label}</span>
            <b>:</b>
            <span>{value}</span>
          </div>
        ))}
    </div>
  )
}

/** Left: payer's signature line; right: collector's name and (optional) authorised signature image. */
export function ReceiptSign({ society, collector, left, right }: { society: Society; collector?: string; left?: string; right?: string }) {
  const signature = useSettingImage('signature', !!society.signature)
  return (
    <div className="rc-sign">
      <div>
        <i />
        {left ?? tx(society.sign_left || 'প্রদানকারীর স্বাক্ষর')}
      </div>
      <div>
        {signature && <img src={signature} alt="" className="rc-sign-img" />}
        <i />
        <b>{right ?? tx(society.sign_right || 'আদায়কারীর স্বাক্ষর')}</b>
        {collector && <small>{collector}</small>}
      </div>
    </div>
  )
}

/** Footer note from Receipt Settings (falls back to the page's own text) plus the common document footer. */
export function ReceiptFoot({ society, fallback }: { society: Society; fallback: string }) {
  const lines = [society.footer_note || fallback, society.document_footer].filter(Boolean)
  return (
    <div className="rc-foot">
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {l}
        </Fragment>
      ))}
    </div>
  )
}

/** Optional extra line under the society name (e.g. "স্থাপিত ১৯৯০"). */
export function Letterhead({ society }: { society: Society }) {
  return society.letterhead_text ? <div className="receipt-letterhead">{society.letterhead_text}</div> : null
}
