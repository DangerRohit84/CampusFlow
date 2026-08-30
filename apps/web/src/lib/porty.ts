import type { ResumeData } from '../types/resume'

export const PORTY_BASE = 'https://porty-eight.vercel.app'
export const PORTY_ALLOWED_ORIGINS = [PORTY_BASE, 'http://localhost:3000', 'http://localhost:5173']

export function isValidPortyOrigin(origin: string): boolean {
  return PORTY_ALLOWED_ORIGINS.includes(origin) || origin === PORTY_BASE
}

function trimPayloadForUrl(payload: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(payload)
  if (json.length <= 4000) return payload
  const trimmed = JSON.parse(JSON.stringify(payload)) as Record<string, unknown> & {
    personalInfo?: { summary?: string }
    projects?: { description?: string }[]
    experience?: { bullets?: string[] }[]
  }
  if (trimmed.personalInfo?.summary && trimmed.personalInfo.summary.length > 200) {
    trimmed.personalInfo.summary = trimmed.personalInfo.summary.slice(0, 200) + '...'
  }
  if (Array.isArray(trimmed.projects)) {
    for (const p of trimmed.projects) {
      if (typeof p.description === 'string' && p.description.length > 300) {
        p.description = p.description.slice(0, 300) + '...'
      }
    }
  }
  if (Array.isArray(trimmed.experience)) {
    for (const e of trimmed.experience) {
      if (Array.isArray(e.bullets)) {
        e.bullets = e.bullets.map((b: string) => (b.length > 120 ? b.slice(0, 120) + '...' : b))
      }
    }
  }
  return trimmed
}

export function encodePortyPayload(payload: Record<string, unknown>): string {
  const json = JSON.stringify(trimPayloadForUrl(payload))
  try {
    return btoa(unescape(encodeURIComponent(json)))
  } catch {
    return btoa(json)
  }
}

export function buildPortyImportUrl(data: ResumeData, themeId?: string): string {
  const payload: Record<string, unknown> = { ...data }
  if (themeId) payload.theme = themeId
  const b64 = encodePortyPayload(payload)
  return `${PORTY_BASE}?import=${encodeURIComponent(b64)}`
}

export function parsePortyMessage(
  event: MessageEvent
): { slug: string } | null {
  if (!isValidPortyOrigin(event.origin)) return null
  const d = event.data
  if (!d || typeof d !== 'object') return null
  if ((d as { type?: string }).type === 'porty:published' && typeof (d as { slug?: string }).slug === 'string') {
    const slug = (d as { slug: string }).slug.trim()
    if (slug) return { slug }
  }
  if (typeof (d as { slug?: string }).slug === 'string' && (d as { type?: string }).type?.includes('publish')) {
    const slug = (d as { slug: string }).slug.trim()
    if (slug) return { slug }
  }
  return null
}

export function buildPortyPublicUrl(slug: string): string {
  // Porty public portfolios live at /p/<slug> — e.g. https://porty-eight.vercel.app/p/chakradhar-chowdary-gunnam-ms9sqtd2
  // Normalize: strip leading "/" and optional "p/" prefix so both "p/xyz" and "xyz" work, then force /p/<slug>
  const clean = slug.replace(/^\/+/, '').replace(/^p\/+/, '').split('?')[0].split('#')[0].trim()
  return `${PORTY_BASE}/p/${clean}`
}
