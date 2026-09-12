// i18n/LanguageContext.tsx — #12 language provider (no deps, localStorage).
// WHY: React context + translate() fallback keeps every page rendering even
// before its strings are translated (bounded scope: nav + auth + common
// first). Persist in localStorage 'campusflow-lang' so choice survives reload.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, translate } from './index'

const STORAGE_KEY = 'campusflow-lang'

interface LanguageContextValue {
  locale: string
  setLocale: (locale: string) => void
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key: string) => translate(DEFAULT_LOCALE, key),
})

function readStoredLocale(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)) return raw
  } catch {}
  return DEFAULT_LOCALE
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => readStoredLocale())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {}
    try {
      document.documentElement.lang = locale
    } catch {}
  }, [locale])

  const setLocale = useCallback((next: string) => {
    setLocaleState((SUPPORTED_LOCALES as readonly string[]).includes(next) ? next : DEFAULT_LOCALE)
  }, [])

  const t = useCallback((key: string) => translate(locale, key), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}
