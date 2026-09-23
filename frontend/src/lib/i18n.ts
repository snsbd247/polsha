/*
 * Minimal i18n. Bangla source text is the key: t('নতুন কৃষক') returns it
 * unchanged in Bangla and looks it up in en.json in English. Switching
 * language saves the choice and reloads the page, so module-level labels
 * are re-evaluated too — no hook plumbing needed.
 * `npm run i18n:check` verifies every key has an English entry.
 */
import en from '../locales/en.json'

export type Lang = 'bn' | 'en'

const STORAGE_KEY = 'polsha.lang'
const EN = en as Record<string, string>

function readLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'bn'
  } catch {
    return 'bn'
  }
}

export const lang: Lang = readLang()

/** True once a language has been chosen on this device (otherwise adopt the user's saved one). */
export function hasStoredLang(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export function t(key: string, params?: Record<string, unknown>): string {
  let s = lang === 'en' ? (EN[key] ?? key) : key
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{{${k}}}`).join(String(v ?? ''))
  }
  return s
}

/** Persist and apply a language (reloads unless it's already active). */
export function setLang(next: Lang, reload = true) {
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* storage unavailable */
  }
  if (reload && next !== lang) window.location.reload()
}

/** Prefer the English name in English mode when one exists. */
export function nameOf(o?: { name_bn?: string | null; name_en?: string | null } | null): string {
  if (!o) return ''
  return (lang === 'en' && o.name_en) || o.name_bn || o.name_en || ''
}
