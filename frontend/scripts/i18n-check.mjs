// Lists tx('…') keys that have no English entry in src/locales/en.json.
//   node scripts/i18n-check.mjs            → report (exit 1 if any missing)
//   node scripts/i18n-check.mjs --unused   → also list en.json keys no longer used
//   node scripts/i18n-check.mjs --dump FILE → write missing keys as a JSON object to FILE
// Extra keys that come from the API (e.g. approval payload labels) live in
// src/locales/api-keys.json so they are checked too.
import ts from 'typescript'
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const EN = JSON.parse(readFileSync(join(SRC, 'locales', 'en.json'), 'utf8'))
const apiKeysFile = join(SRC, 'locales', 'api-keys.json')
const keys = new Set(existsSync(apiKeysFile) ? JSON.parse(readFileSync(apiKeysFile, 'utf8')) : [])

;(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(f)) {
      const sf = ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      ;(function visit(n) {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tx') {
          const a = n.arguments[0]
          if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) keys.add(a.text)
        }
        ts.forEachChild(n, visit)
      })(sf)
    }
  }
})(SRC)

const missing = [...keys].filter((k) => !(k in EN))
const unused = Object.keys(EN).filter((k) => !keys.has(k))
console.log(`keys: ${keys.size}, translated: ${keys.size - missing.length}, missing: ${missing.length}`)
if (process.argv.includes('--dump')) {
  const out = process.argv[process.argv.indexOf('--dump') + 1]
  writeFileSync(out, JSON.stringify(Object.fromEntries(missing.map((k) => [k, ''])), null, 2))
  console.log(`missing keys written to ${out}`)
} else if (missing.length) {
  missing.slice(0, 50).forEach((k) => console.log('  missing:', k))
}
if (process.argv.includes('--unused')) unused.forEach((k) => console.log('  unused:', k))
process.exit(missing.length ? 1 : 0)
