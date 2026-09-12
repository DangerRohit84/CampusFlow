// services/resumeDepth.ts — Resume depth helpers (task #10, SRP extract from resume routes).
// WHY: resume.ts was already 1400+ lines (latex/pdf/parse/convert/ai-upgrade/ats).
// JD scrape + cover letter + GitHub import get their own home so resume.ts stays
// a thin router. All helpers are pure/testable except the two fetchers, which
// are grounded (verbatim stripped text, no hallucination) and SSRF-guarded.

import dns from 'dns/promises'
import net from 'net'
import { isPrivateIPAddress } from '../utils/secureUrl'
import { isValidGithubUsername } from './githubActivity'
import { logger } from '../utils/logger'

export const JD_SCRAPE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
export const JD_SCRAPE_MAX_CHARS = 6000
const FETCH_TIMEOUT_MS = 15000
const MAX_BODY_BYTES = 2 * 1024 * 1024

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.google',
])

/**
 * Strip HTML to single-line text — verbatim reuse of the fetchPage6k pattern
 * (opportunities/sources/context.ts): script/style removal, dash/rupee entity
 * decode, tag strip, entity collapse, whitespace collapse, 6k cap applied by
 * caller. Grounded: no summarization, only verbatim extraction.
 */
export function stripHtmlToText(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&#8377;|&#x20B9;|&#X20B9;/g, '₹')
    .replace(/&#8211;|&#8212;|&#45;/g, '-')
    .replace(/&(ndash|mdash|minus|hyphen);/gi, '-')
    .replace(/&(rupee|Rs);/gi, '₹')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * SSRF guard for arbitrary JD URLs. Mirrors utils/secureUrl but WITHOUT the
 * platform allowlist: JD links live on any host (LinkedIn, Naukri, company
 * sites), so an allowlist would break the feature. Private-IP/DNS-rebinding
 * checks are kept identical to validateExternalUrl.
 */
export async function validatePublicUrl(raw: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(String(raw || '').trim())
  } catch {
    throw new Error('Invalid URL format')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https protocols are allowed')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URL are not allowed')
  }
  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) throw new Error('Missing hostname')
  if (BLOCKED_HOSTS.has(hostname)) throw new Error('Private host blocked')
  if (hostname.endsWith('.internal') || hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    throw new Error('Private host blocked')
  }
  if (net.isIP(hostname) !== 0) {
    if (isPrivateIPAddress(hostname)) throw new Error('Private IP blocked')
  } else {
    try {
      const lookups = await dns.lookup(hostname, { all: true })
      for (const entry of lookups) {
        if (isPrivateIPAddress(entry.address)) throw new Error('Private IP blocked (DNS)')
        if (entry.address === '169.254.169.254') throw new Error('Private IP blocked (DNS)')
      }
    } catch (e: any) {
      if (e?.message && String(e.message).includes('Private IP blocked')) throw e
      if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') throw new Error('Unable to resolve host')
    }
  }
  return parsed
}

async function fetchWithSingleHop(urlStr: string): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(urlStr, {
      headers: { 'User-Agent': JD_SCRAPE_UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: controller.signal,
      redirect: 'manual' as any,
    } as any)
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location')
      if (!loc) return { ok: false, status: resp.status, body: '' }
      let nextUrl: string
      try {
        nextUrl = new URL(loc, urlStr).toString()
      } catch {
        return { ok: false, status: resp.status, body: '' }
      }
      await validatePublicUrl(nextUrl) // TOCTOU: re-validate redirect hop
      const c2 = new AbortController()
      const t2 = setTimeout(() => c2.abort(), FETCH_TIMEOUT_MS)
      try {
        const r2 = await fetch(nextUrl, {
          headers: { 'User-Agent': JD_SCRAPE_UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
          signal: c2.signal,
          redirect: 'manual' as any,
        } as any)
        if (!r2.ok) return { ok: false, status: r2.status, body: '' }
        const len = Number(r2.headers.get('content-length') || '0')
        if (len && len > MAX_BODY_BYTES) throw new Error('Page too large (max 2MB)')
        const raw = await r2.text()
        if (raw.length > MAX_BODY_BYTES) throw new Error('Page too large (max 2MB)')
        return { ok: true, status: r2.status, body: raw }
      } finally {
        clearTimeout(t2)
      }
    }
    if (!resp.ok) return { ok: false, status: resp.status, body: '' }
    const len = Number(resp.headers.get('content-length') || '0')
    if (len && len > MAX_BODY_BYTES) throw new Error('Page too large (max 2MB)')
    const raw = await resp.text()
    if (raw.length > MAX_BODY_BYTES) throw new Error('Page too large (max 2MB)')
    return { ok: true, status: resp.status, body: raw }
  } finally {
    clearTimeout(timeout)
  }
}

export type JdScrapeResult = {
  text: string
  length: number
  truncated: boolean
  sourceUrl: string
}

/** Fetch a JD posting URL and return verbatim stripped text (max 6k chars). Never throws for fetch failures — returns '' text. */
export async function scrapeJdUrl(url: string): Promise<JdScrapeResult> {
  const parsed = await validatePublicUrl(url) // throws on SSRF/private (caller maps to 400)
  const sourceUrl = parsed.toString()
  try {
    const { ok, body } = await fetchWithSingleHop(sourceUrl)
    if (!ok) return { text: '', length: 0, truncated: false, sourceUrl }
    const stripped = stripHtmlToText(body)
    if (stripped.length < 20) return { text: '', length: 0, truncated: false, sourceUrl }
    const truncated = stripped.length > JD_SCRAPE_MAX_CHARS
    const text = stripped.substring(0, JD_SCRAPE_MAX_CHARS)
    return { text, length: stripped.length, truncated, sourceUrl }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { text: '', length: 0, truncated: false, sourceUrl }
    if (String(err?.message || '').includes('too large')) throw err
    logger.debug({ err, url: sourceUrl }, '[resumeDepth] JD scrape failed (treated as empty)')
    return { text: '', length: 0, truncated: false, sourceUrl }
  }
}

// ===================== COVER LETTER (heuristic fallback) =====================

export type CoverLetterTone = 'professional' | 'enthusiastic' | 'concise'

type MinimalResume = {
  personalInfo?: { fullName?: string; email?: string; phone?: string; location?: string; headline?: string; summary?: string }
  skills?: string[]
  projects?: { title?: string; tech?: string[] }[]
  experience?: { role?: string; company?: string; bullets?: string[] }[]
  education?: { degree?: string; school?: string }[]
}

function firstName(full: string): string {
  const t = String(full || '').trim()
  if (!t) return 'Hiring Manager'
  return t.split(/\s+/)[0] || 'Hiring Manager'
}

/**
 * Grounded heuristic cover letter — only uses resume facts + JD keywords.
 * No invented employers/dates/metrics. Used when no user Groq key (offline-safe).
 */
export function heuristicCoverLetter(data: MinimalResume, jd: string, tone: CoverLetterTone = 'professional'): string {
  const p = data?.personalInfo || {}
  const name = String(p.fullName || 'Applicant').trim() || 'Applicant'
  const headline = String(p.headline || '').trim()
  const skills = (data?.skills || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
  const topProject = (data?.projects || []).find((x) => x?.title?.trim())
  const topExp = (data?.experience || []).find((x) => x?.role?.trim() || x?.company?.trim())
  const edu = (data?.education || []).find((x) => x?.degree?.trim() || x?.school?.trim())

  const jdTokens = String(jd || '').toLowerCase().match(/[a-z0-9+#.]{3,}/g) || []
  const stop = new Set(['and', 'the', 'for', 'with', 'you', 'are', 'will', 'have', 'this', 'that', 'from', 'role', 'work', 'team', 'experience', 'required', 'preferred', 'about', 'into'])
  const jdKeywords = Array.from(new Set(jdTokens.filter((t) => t.length > 3 && !stop.has(t)))).slice(0, 6)
  const jdLine = jdKeywords.length ? ` I noted the emphasis on ${jdKeywords.slice(0, 4).join(', ')} and have applied these in my work.` : ''

  const opener =
    tone === 'enthusiastic'
      ? `I am excited to apply for this role${headline ? ` as a ${headline}` : ''}.${jdLine}`
      : tone === 'concise'
        ? `I am applying for this role${headline ? ` (${headline})` : ''}.${jdLine}`
        : `I am writing to apply for this position${headline ? ` — ${headline}` : ''}.${jdLine}`

  const proofBits: string[] = []
  if (topExp) proofBits.push(`${String(topExp.role || 'contributor').trim()}${topExp.company ? ` at ${String(topExp.company).trim()}` : ''}`)
  if (topProject) {
    const tech = (topProject.tech || []).slice(0, 4).join(', ')
    proofBits.push(`built ${String(topProject.title).trim()}${tech ? ` (${tech})` : ''}`)
  }
  if (skills.length) proofBits.push(`hands-on skills in ${skills.slice(0, 5).join(', ')}`)
  const proof = proofBits.length ? ` Relevant background includes: ${proofBits.join('; ')}.` : ''
  const eduLine = edu ? ` ${String(edu.degree || '').trim()}${edu.school ? `, ${String(edu.school).trim()}` : ''}.` : ''
  const contact = [p.email, p.phone, p.location].map((s) => String(s || '').trim()).filter(Boolean).join(' | ')

  return [
    `Dear ${firstName(String(jd.match(/hiring manager|recruiter/i)?.[0] || '')) === 'Hiring Manager' ? 'Hiring Manager' : 'Hiring Manager'},`,
    '',
    opener.trim(),
    '',
    `${String(p.summary || '').trim() || `I focus on shipping reliable, well-tested work and collaborating closely with teams.`}${proof}${eduLine}`,
    '',
    tone === 'concise'
      ? 'I would welcome the chance to discuss how I can contribute. Thank you for your consideration.'
      : 'I would welcome the opportunity to discuss how my experience aligns with your goals. Thank you for your time and consideration.',
    '',
    `Sincerely,`,
    name,
    contact,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 4000)
}

// ===================== GITHUB REPOS =====================

export type GithubRepoBrief = {
  name: string
  description: string
  language: string
  stars: number
  forks: number
  url: string
  homepage: string
  updatedAt: string
  topics: string[]
}

/** Fetch public repos for a username via api.github.com (no token, no secrets). Throws on validation/rate-limit for caller mapping. */
export async function fetchGithubRepos(username: string, limit = 12): Promise<GithubRepoBrief[]> {
  const raw = String(username || '').trim()
  if (!isValidGithubUsername(raw)) {
    throw new Error('Invalid GitHub username. Must be 1-39 chars, alphanumeric or hyphen, cannot start/end with hyphen.')
  }
  const n = Math.min(20, Math.max(1, Number.isFinite(limit) ? limit : 12))
  const url = `https://api.github.com/users/${encodeURIComponent(raw)}/repos?sort=updated&per_page=${n}&type=owner`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'CampusFlow/1.0 (+https://campusflow.app)',
        Accept: 'application/vnd.github+json',
      },
      signal: controller.signal,
    })
    if (resp.status === 404) {
      const err: any = new Error(`GitHub user "${raw}" not found`)
      err.status = 404
      throw err
    }
    if (resp.status === 403) {
      const err: any = new Error('GitHub API rate limit reached — try again in a minute')
      err.status = 502
      throw err
    }
    if (!resp.ok) {
      const err: any = new Error('Failed to fetch GitHub repos')
      err.status = 502
      throw err
    }
    const json = (await resp.json()) as any[]
    if (!Array.isArray(json)) return []
    return json.slice(0, n).map((r: any) => ({
      name: String(r?.name || '').slice(0, 80),
      description: String(r?.description || '').slice(0, 300),
      language: String(r?.language || '').slice(0, 30),
      stars: Number.isFinite(r?.stargazers_count) ? r.stargazers_count : 0,
      forks: Number.isFinite(r?.forks_count) ? r.forks_count : 0,
      url: String(r?.html_url || '').slice(0, 300),
      homepage: String(r?.homepage || '').slice(0, 300),
      updatedAt: String(r?.updated_at || '').slice(0, 30),
      topics: Array.isArray(r?.topics) ? r.topics.map((t: any) => String(t)).slice(0, 8) : [],
    }))
  } finally {
    clearTimeout(timeout)
  }
}
