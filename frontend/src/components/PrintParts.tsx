import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { digits } from '../lib/format'
import { t as tx } from '../lib/i18n'
import { settingImagePath, type Society } from '../lib/settings'

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
 * The printed sheet, once or twice (office + customer copy) on the paper size set in Receipt Settings.
 * The seal is stamped once per copy.
 */
export function ReceiptPaper({ society, children, doc }: { society: Society; children: ReactNode; doc?: PrintDoc }) {
  const seal = useSettingImage('seal', !!society.seal)
  const printed = usePrintLog(doc)
  const copies = society.copies === 2 ? [tx('অফিস কপি'), tx('গ্রাহক কপি')] : [null]
  return (
    <>
      {copies.map((label, i) => (
        <div key={i} className={`receipt-paper paper-${society.paper ?? 'a4'}`}>
          {label && <div className="receipt-copy-label">{label}</div>}
          {printed > 0 && <div className="receipt-dup-label">{tx('প্রতিলিপি — কপি {{p0}}', { p0: digits(printed + 1) })}</div>}
          {children}
          {seal && <img src={seal} alt="" className="receipt-seal" />}
        </div>
      ))}
    </>
  )
}

/** Left: payer's signature line; right: collector's name and (optional) authorised signature image. */
export function ReceiptSign({ society, collector, left, right }: { society: Society; collector?: string; left?: string; right?: string }) {
  const signature = useSettingImage('signature', !!society.signature)
  return (
    <div className="receipt-sign">
      <div>{left ?? tx(society.sign_left || 'প্রদানকারীর স্বাক্ষর')}</div>
      <div>
        {signature && <img src={signature} alt="" className="receipt-sign-img" />}
        {collector && (
          <>
            {collector}
            <br />
          </>
        )}
        {right ?? tx(society.sign_right || 'আদায়কারীর স্বাক্ষর')}
      </div>
    </div>
  )
}

/** Footer note from Receipt Settings (falls back to the page's own text) plus the common document footer. */
export function ReceiptFoot({ society, fallback }: { society: Society; fallback: string }) {
  const lines = [society.footer_note || fallback, society.document_footer].filter(Boolean)
  return (
    <div className="receipt-foot">
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
