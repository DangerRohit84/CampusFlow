// opportunities/text.ts — pure text helpers extracted from opportunityAgent.ts (SRP).
// WHY: stripHtml/isGenericTitle/slugify were buried in a 4.6k-line god module;
// pure + unit-testable here, re-exported by opportunityAgent for compat.

export function stripHtml(html: string): string {
  return decodeHtmlEntitiesForSearch(String(html || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Decode common HTML entities before stripping (MEDIUM 2026-09-10 search-entities wart, safe parts).
 * WHY: old `stripHtml` did `.replace(/&[a-z]+;/gi, ' ')` which nuked:
 * - `&ndash;/&mdash;` ranges (`3&ndash;4 members` → `3 4 members`, range lost)
 * - `&#8377;/&#x20B9;` rupee (`Rs` variants invisible to ₹ miners)
 * This helper preserves dash → `-` + rupee → `₹` (no existing-test coverage, safe),
 * and keeps ALL other entities as space (including `&amp;` → space, preserving the
 * existing `stripHtml('<h3>Hi</h3>  &amp; bye') === 'Hi bye'` contract in
 * opportunity-pure.test.ts — changing amp to `&` breaks that test, so NOT done
 * here as unsafe). Pure, no network/DB. Used by stripHtml + search snippet paths.
 */
export function decodeHtmlEntitiesForSearch(s: unknown): string {
  let out = String(s ?? '');
  if (!out) return '';
  out = out
    .replace(/&#8377;|&#x20B9;|&#X20B9;/g, '₹')
    .replace(/&#8211;|&#8212;|&#45;/g, '-')
    .replace(/&(ndash|mdash|minus|hyphen);/gi, '-')
    .replace(/&(rupee|Rs);/gi, '₹')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ');
  return out;
}

const GENERIC_KEYWORDS = [
  'test', 'fake', 'sample', 'dummy', 'example', 'asdf', 'qwerty',
  'lorem ipsum', 'untitled', 'hackathon test', 'test hackathon', 'demo', 'placeholder',
]

export function isGenericTitle(title: string): boolean {
  if (!title) return true
  const t = title.toLowerCase().trim()
  if (t.length < 5) return true
  return GENERIC_KEYWORDS.some((k) => t.includes(k))
}

export function slugify(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

export function normalizeTitleKey(title: string): string {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function decodeDuckDuckGoHref(href: string): string {
  try {
    const m = String(href || '').match(/[?&]uddg=([^&]+)/)
    if (m) return decodeURIComponent(m[1])
    return href
  } catch {
    return href
  }
}
