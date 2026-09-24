import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { money } from './accounting'
import { digits, fmtDate, fmtDateTime } from './format'
import { t as tx } from './i18n'

export type ReportColumn = { key: string; label: string; type: 'text' | 'money' | 'number' | 'decimal' | 'date'; sum: boolean }
export type ReportFilter = {
  name: string
  type: 'period' | 'date' | 'text' | 'select'
  label: string
  required?: boolean
  default?: string
  options?: { value: string | number; label: string }[]
}
export type ReportSummary = { label: string; value: number | string; type?: string }
export type ReportRow = Record<string, string | number | null>
export type ReportResult = {
  key: string
  title: string
  subtitle: string
  filters: ReportFilter[]
  values: Record<string, string | number | null>
  columns: ReportColumn[]
  rows: ReportRow[]
  totals: Record<string, number>
  summary: ReportSummary[]
  truncated: boolean
  notice: string | null
  generated_at: string
}
export type ReportCatalog = { categories: Record<string, string>; reports: { key: string; title: string; categories: string[] }[] }

/** On-screen text of one cell. */
export function cellText(col: Pick<ReportColumn, 'type'>, v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  switch (col.type) {
    case 'money':
      return money(v as number)
    case 'decimal':
      return digits(Number(v).toFixed(2))
    case 'number':
      return digits(Number(v).toLocaleString('en-IN'))
    case 'date':
      return String(v).length > 10 ? fmtDateTime(String(v)) : fmtDate(String(v))
    default:
      return digits(String(v))
  }
}

export const summaryText = (s: ReportSummary) => (s.type === 'money' ? money(s.value as number) : typeof s.value === 'number' ? digits(s.value) : digits(String(s.value)))

/** Record an export in the export audit (fire and forget — the file is already made). */
export function logExport(r: ReportResult, format: 'xlsx' | 'csv' | 'print') {
  const filters = Object.fromEntries(Object.entries(r.values).filter(([k, v]) => !k.startsWith('_') && v !== null && v !== ''))
  api.post(`/reports/${r.key}/export-log`, { format, filters, rows: r.rows.length }).catch(() => {})
}

// ------------------------------------------------------------------ print → PDF

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** A printable A4 page in a hidden frame; the browser's print dialog saves it as PDF. */
export function printReport(r: ReportResult, society: string) {
  const num = (c: ReportColumn) => c.type !== 'text' && c.type !== 'date'
  const head = r.columns.map((c) => `<th class="${num(c) ? 'n' : ''}">${esc(c.label)}</th>`).join('')
  const body = r.rows
    .map((row) => `<tr>${r.columns.map((c) => `<td class="${num(c) ? 'n' : ''}">${esc(cellText(c, row[c.key]))}</td>`).join('')}</tr>`)
    .join('')
  const hasTotals = r.columns.some((c) => c.sum)
  const foot = hasTotals
    ? `<tr>${r.columns.map((c, i) => `<th class="${num(c) ? 'n' : ''}">${c.sum ? esc(cellText(c, r.totals[c.key])) : i === 0 ? esc(tx('মোট')) : ''}</th>`).join('')}</tr>`
    : ''
  const summary = r.summary.length
    ? `<table class="sum">${r.summary.map((s) => `<tr><td>${esc(s.label)}</td><td class="n">${esc(summaryText(s))}</td></tr>`).join('')}</table>`
    : ''
  const landscape = r.columns.length > 7
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
body { font-family: 'SolaimanLipi', 'Kalpurush', 'Noto Sans Bengali', 'Nirmala UI', sans-serif; font-size: 11px; color: #000; }
h1 { font-size: 16px; margin: 0; text-align: center; } h2 { font-size: 13px; margin: 4px 0 0; text-align: center; }
.sub { text-align: center; color: #444; margin: 2px 0 10px; }
table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 3px 5px; vertical-align: top; }
thead th { background: #eee; } tfoot th { background: #f6f6f6; } .n { text-align: right; white-space: nowrap; }
thead { display: table-header-group; } tr { page-break-inside: avoid; }
.sum { width: auto; margin-top: 10px; } .foot { margin-top: 8px; color: #666; font-size: 10px; display: flex; justify-content: space-between; }
</style></head><body>
<h1>${esc(society)}</h1><h2>${esc(r.title)}</h2><div class="sub">${esc(digits(r.subtitle))}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${r.columns.length}" style="text-align:center">${esc(tx('কোনো তথ্য নেই'))}</td></tr>`}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table>
${summary}
<div class="foot"><span>${esc(tx('মোট সারি: {{n}}', { n: digits(r.rows.length) }))}</span><span>${esc(tx('প্রস্তুত: {{d}}', { d: fmtDateTime(r.generated_at) }))}</span></div>
</body></html>`

  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow!.document
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    frame.contentWindow!.focus()
    frame.contentWindow!.print()
    setTimeout(() => frame.remove(), 60_000)
  }, 300)
  logExport(r, 'print')
}

// ------------------------------------------------------------------ Excel (.xlsx)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A stored (uncompressed) zip — all an .xlsx needs to open in Excel/LibreOffice. */
function zip(files: { name: string; data: string }[]): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = enc.encode(f.data)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, 0, true)
    local.setUint16(12, 0x21, true) // 1980-01-01
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    chunks.push(new Uint8Array(local.buffer), name, data)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint16(14, 0x21, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, data.length, true)
    cd.setUint32(24, data.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + data.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const xml = (s: unknown) =>
  String(s ?? '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    // characters XML 1.0 forbids
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

function colName(i: number): string {
  let s = ''
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

/** Styles: 0 plain, 1 bold, 2 #,##0.00, 3 bold #,##0.00, 4 title. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`

export type Cell = { v: unknown; kind: 'text' | 'number'; style?: number }

function sheetXml(rows: Cell[][], widths: number[]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          const ref = `${colName(i)}${r + 1}`
          const s = c.style ? ` s="${c.style}"` : ''
          if (c.v === null || c.v === undefined || c.v === '') return c.style ? `<c r="${ref}"${s}/>` : ''
          if (c.kind === 'number' && Number.isFinite(Number(c.v))) return `<c r="${ref}"${s}><v>${Number(c.v)}</v></c>`
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
}

export function buildXlsx(sheetName: string, rows: Cell[][], widths: number[]): Blob {
  const safe = xml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  return zip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safe}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows, widths) },
  ])
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const fileStamp = () => new Date().toISOString().slice(0, 10)

/** Excel file with real numbers (sums work), a title block, totals and the summary. */
export function exportXlsx(r: ReportResult, society: string) {
  const isNum = (c: ReportColumn) => c.type === 'money' || c.type === 'number' || c.type === 'decimal'
  const money2 = (c: ReportColumn) => c.type === 'money' || c.type === 'decimal'
  const rows: Cell[][] = [
    [{ v: society, kind: 'text', style: 4 }],
    [{ v: r.title, kind: 'text', style: 1 }],
    [{ v: r.subtitle, kind: 'text' }],
    [],
    r.columns.map((c) => ({ v: c.label, kind: 'text', style: 1 })),
    ...r.rows.map((row) =>
      r.columns.map((c): Cell => (isNum(c) ? { v: row[c.key], kind: 'number', style: money2(c) ? 2 : 0 } : { v: c.type === 'date' ? cellText(c, row[c.key]) : row[c.key], kind: 'text' })),
    ),
  ]
  if (r.columns.some((c) => c.sum)) {
    rows.push(r.columns.map((c, i): Cell => (c.sum ? { v: r.totals[c.key], kind: 'number', style: 3 } : { v: i === 0 ? tx('মোট') : '', kind: 'text', style: 1 })))
  }
  if (r.summary.length) {
    rows.push([])
    for (const s of r.summary) rows.push([{ v: s.label, kind: 'text', style: 1 }, s.type === 'money' ? { v: s.value, kind: 'number', style: 2 } : { v: s.value, kind: 'text' }])
  }
  const widths = r.columns.map((c) => {
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 300).map((row) => String(row[c.key] ?? '').length))
    return Math.min(60, Math.max(isNum(c) ? 14 : 10, longest + 2))
  })
  download(buildXlsx(r.title, rows, widths), `${r.key}-${fileStamp()}.xlsx`)
  logExport(r, 'xlsx')
}

/** CSV (UTF-8 with BOM so Excel shows Bangla). */
export function exportCsv(r: ReportResult) {
  const q = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [r.columns.map((c) => q(c.label)).join(','), ...r.rows.map((row) => r.columns.map((c) => q(c.type === 'date' ? row[c.key] ?? '' : row[c.key])).join(','))]
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${r.key}-${fileStamp()}.csv`)
  logExport(r, 'csv')
}

export function useReportCatalog() {
  return useQuery({
    queryKey: ['report-catalog'],
    queryFn: async () => (await api.get<ReportCatalog>('/reports')).data,
    staleTime: 5 * 60_000,
  })
}
