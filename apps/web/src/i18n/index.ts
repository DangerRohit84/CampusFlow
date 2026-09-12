// i18n/index.ts — #12 locale registry + translate() with en fallback.
// WHY: adding a locale must never break existing keys — unknown locales and
// missing keys fall back to English; totally unknown keys return the key
// itself (no throw, no blank UI). New locales: add '<locale>.ts' exporting
// the same shape as en, then register below in LOCALES.

import { en } from './en'

export type SupportedLocale = 'en'
export const DEFAULT_LOCALE: SupportedLocale = 'en'
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['en'] as const

type Dict = Record<string, unknown>
const LOCALES: Record<SupportedLocale, Dict> = { en: en as unknown as Dict }

function lookup(dict: Dict | undefined, key: string): string | undefined {
  if (!dict) return undefined
  const out = key.split('.').reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== 'object') return undefined
    return (acc as Dict)[part]
  }, dict)
  return typeof out === 'string' ? out : undefined
}

/** Translate a dot-path key. Falls back to en, then to the key itself. */
export function translate(locale: string, key: string): string {
  const primary = (LOCALES as Record<string, Dict>)[locale]
  return lookup(primary, key) ?? lookup(LOCALES.en, key) ?? key
}

/** Register an additional locale at runtime (structure for additions). */
export function registerLocale(locale: string, dict: Dict): void {
  ;(LOCALES as Record<string, Dict>)[locale] = dict
}

export { en }
export type { EnShape, LanguageKey } from './en'
