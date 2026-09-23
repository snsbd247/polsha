// Wraps user-visible Bangla text in tx('…') so it goes through lib/i18n.
// Safe to re-run: text already inside tx(...) is skipped.
//   node scripts/i18n-wrap.mjs            → rewrite src/ in place
//   node scripts/i18n-wrap.mjs --dry      → only report what would change
import ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../src', import.meta.url))
const DRY = process.argv.includes('--dry')
const BANGLA = /[ঀ-৿]/
const ONLY_DIGITS = /^[০-৯]+$/
const FN = 'tx'

const files = []
;(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|mts)$/.test(f) && !p.endsWith(join('lib', 'i18n.ts'))) files.push(p)
  }
})(ROOT)

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
const isWrapped = (node) =>
  ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === FN && node.parent.arguments[0] === node
const skipLiteral = (node) =>
  !BANGLA.test(node.text) ||
  ONLY_DIGITS.test(node.text) ||
  isWrapped(node) ||
  (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
  ts.isLiteralTypeNode(node.parent) ||
  ts.isImportDeclaration(node.parent) ||
  ts.isExportDeclaration(node.parent)

let totalEdits = 0

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!BANGLA.test(src)) continue
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

  /** Source text of `node` with every Bangla string inside it rewritten. */
  function rewrite(node) {
    const edits = []
    collect(node, edits)
    let text = src.slice(node.getStart(sf), node.getEnd())
    const base = node.getStart(sf)
    for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start - base) + e.text + text.slice(e.end - base)
    return text
  }

  function collect(node, edits) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (skipLiteral(node)) return
      const call = `${FN}(${q(node.text)})`
      const inAttr = ts.isJsxAttribute(node.parent) && node.parent.initializer === node
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: inAttr ? `{${call}}` : call })
      return
    }
    if (ts.isTemplateExpression(node)) {
      const all = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('')
      if (!BANGLA.test(all) || isWrapped(node)) {
        ts.forEachChild(node, (c) => collect(c, edits))
        return
      }
      let key = node.head.text
      const params = []
      node.templateSpans.forEach((span, i) => {
        key += `{{p${i}}}` + span.literal.text
        params.push(`p${i}: ${rewrite(span.expression)}`)
      })
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${FN}(${q(key)}, { ${params.join(', ')} })` })
      return
    }
    if (ts.isJsxText(node)) {
      const raw = node.getFullText(sf)
      if (!BANGLA.test(raw)) return
      const lead = raw.match(/^\s*/)[0]
      const trail = raw.match(/\s*$/)[0]
      const body = raw.trim().replace(/\s*\n\s*/g, ' ')
      const pre = lead ? (lead.includes('\n') ? lead : `{' '}`) : ''
      const post = trail ? (trail.includes('\n') ? trail : `{' '}`) : ''
      edits.push({ start: node.getFullStart(), end: node.getEnd(), text: `${pre}{${FN}(${q(body)})}${post}` })
      return
    }
    ts.forEachChild(node, (c) => collect(c, edits))
  }

  const edits = []
  collect(sf, edits)
  if (!edits.length) continue
  totalEdits += edits.length

  let out = src
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)

  // Add the import after the last existing import.
  if (!/import \{[^}]*\btx\b[^}]*\} from '[^']*lib\/i18n'/.test(out)) {
    let rel = relative(dirname(file), join(ROOT, 'lib', 'i18n')).split(sep).join('/')
    if (!rel.startsWith('.')) rel = './' + rel
    const imports = [...out.matchAll(/^import [^;]*?from '[^']+'\n/gms)]
    const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0
    out = out.slice(0, at) + `import { t as tx } from '${rel}'\n` + out.slice(at)
  }

  console.log(`${relative(ROOT, file)}: ${edits.length}`)
  if (!DRY) writeFileSync(file, out)
}
console.log(`total edits: ${totalEdits}${DRY ? ' (dry run)' : ''}`)
