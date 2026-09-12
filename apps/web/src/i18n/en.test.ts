// i18n/en.test.ts — #12 i18n infra (pure, no DOM).
// WHY: language context + en strings must cover nav + auth + common first;
// remaining 55 pages stay English fallback until translated (documented).
import { describe, it, expect } from 'vitest'
import { en, type LanguageKey } from './en'
import { translate } from './index'

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: any, k) => (acc == null ? undefined : acc[k]), obj)
}

describe('i18n en coverage (nav + auth + common)', () => {
  const required: LanguageKey[] = [
    'nav.overview', 'nav.timetable', 'nav.assignments', 'nav.settings',
    'auth.login', 'auth.register', 'auth.email', 'auth.password',
    'common.save', 'common.cancel', 'common.delete', 'common.loading',
  ]
  it.each(required)('en has %s', (key) => {
    expect(get(en, key)).toBeTruthy()
  })
  it('translate falls back to en for missing locale keys', () => {
    expect(translate('en', 'nav.overview')).toBe(get(en, 'nav.overview'))
    expect(translate('xx' as any, 'common.save')).toBe(get(en, 'common.save'))
  })
  it('translate returns key when missing everywhere (no throw)', () => {
    expect(translate('en', 'nope.missing' as any)).toBe('nope.missing')
  })
})
