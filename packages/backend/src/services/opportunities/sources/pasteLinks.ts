// opportunities/sources/pasteLinks.ts — superadmin paste-links source (manual-only).
// WHY: superadmin pastes 1..N arbitrary public URLs + picks HACKATHON vs
// INTERNSHIP. Separate staging via distinct sources (PASTE_LINK_HACKATHON vs
// PASTE_LINK_INTERNSHIP) + type field. Manual-only: NOT in registry (registry
// stays 12 — solid-all.test locks it), excluded from Fetch All/cron.
// SSRF: validatePublicUrl (no platform allowlist) + redirect:manual +
// TOCTOU re-validate + 2MB cap + 15s timeout + 6k strip + 5-min cache.
// Fail-open per-URL: one bad link never kills the batch.

import { validatePublicUrl } from '../../../utils/secureUrl';
import { logger } from '../../../utils/logger';
import { scrapeCache } from '../cache';
import { extractDeadlineFromContent } from '../../../utils/search';
import type { NormalizedOpportunity } from '../types';

export const PASTE_LINK_HACKATHON_SOURCE = 'PASTE_LINK_HACKATHON';
export const PASTE_LINK_INTERNSHIP_SOURCE = 'PASTE_LINK_INTERNSHIP';
export const PASTE_LINKS_MAX_URLS = 20;
export const PASTE_LINK_FETCH_TIMEOUT_MS = 15_000;
export const PASTE_LINK_MAX_BYTES = 2 * 1024 * 1024;
export const PASTE_LINK_CACHE_TTL_SEC = 300;

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Dedup key: trim + strip fragment + strip single trailing slash + lowercase. */
export function normalizePasteUrlForDedup(raw: string): string {
  let s = String(raw || '').trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) s = s.slice(0, hashIdx).trim();
  if (s.length > 8 && s.endsWith('/')) s = s.slice(0, -1);
  return s.toLowerCase();
}

/** First-seen wins, order preserved (original trimmed form kept for fetch). */
export function dedupPasteUrls(urls: string[]): string[] {
  const seen = new Map<string, string>();
  for (const u of urls || []) {
    const t = String(u || '').trim();
    if (!t) continue;
    const k = normalizePasteUrlForDedup(t);
    if (!seen.has(k)) seen.set(k, t);
  }
  return [...seen.values()];
}

/**
 * Split single URL or bulk (one per line, comma/space separated).
 * Accepts string or string[] (array elements may themselves contain separators).
 */
export function parsePasteLinksInput(raw: string | string[]): string[] {
  const joined = Array.isArray(raw) ? raw.join('\n') : String(raw || '');
  const parts = joined
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return dedupPasteUrls(parts);
}

export type PasteLinkType = 'HACKATHON' | 'INTERNSHIP';

function normalizePasteType(input: unknown): PasteLinkType {
  const t = String(input || '').trim().toUpperCase();
  if (t === 'HACKATHON' || t === 'HACKATHONS') return 'HACKATHON';
  if (t === 'INTERNSHIP' || t === 'INTERNSHIPS') return 'INTERNSHIP';
  throw new Error('type must be HACKATHON or INTERNSHIP');
}

export interface ValidatePasteLinksInput {
  type?: unknown;
  urls?: unknown;
  raw?: unknown;
}

export function validatePasteLinksPayload(input: ValidatePasteLinksInput): {
  type: PasteLinkType;
  urls: string[];
} {
  const type = normalizePasteType((input as { type?: unknown })?.type);
  const combined: string[] = [];
  const raw = (input as { raw?: unknown })?.raw;
  const urls = (input as { urls?: unknown })?.urls;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    combined.push(...parsePasteLinksInput(String(raw)));
  } else if (typeof raw === 'string' && raw.trim() === '') {
    // empty raw contributes nothing (falls through to urls check)
  }
  if (urls !== undefined && urls !== null) {
    if (typeof urls === 'string') {
      combined.push(...parsePasteLinksInput(urls as string));
    } else if (Array.isArray(urls)) {
      combined.push(...parsePasteLinksInput(urls as string[]));
    } else {
      throw new Error('urls array required (1-20)');
    }
  }
  const deduped = dedupPasteUrls(combined);
  if (deduped.length === 0) throw new Error('urls array required (1-20)');
  if (deduped.length > PASTE_LINKS_MAX_URLS) {
    throw new Error(`Up to ${PASTE_LINKS_MAX_URLS} URLs only (max 20)`);
  }
  return { type, urls: deduped };
}

function slugTitleFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const segs = String(u.pathname || '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    let slug = segs.length > 0 ? segs[segs.length - 1] : '';
    try {
      slug = decodeURIComponent(slug);
    } catch {}
    slug = slug.replace(/[-_+.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (slug && slug.length >= 3) return slug;
    const host = u.hostname.replace(/^www\./i, '').split('.')[0] || '';
    const hostTitle = host.replace(/[-_]+/g, ' ').trim().slice(0, 80);
    if (hostTitle && hostTitle.length >= 3) return hostTitle;
  } catch {}
  const fallback = String(urlStr || '')
    .split('/')
    .pop()
    ?.replace(/[-_+.]+/g, ' ')
    .trim()
    .slice(0, 80);
  return fallback && fallback.length >= 3 ? fallback : 'Custom Opportunity';
}

function companyFromTitleOrUrl(title: string, urlStr: string): string {
  if (title.includes(' at ')) {
    const c = title.split(' at ').pop()?.trim();
    if (c && c.length >= 2) return c.slice(0, 120);
  }
  if (title.includes(' @ ')) {
    const c = title.split(' @ ').pop()?.trim();
    if (c && c.length >= 2) return c.slice(0, 120);
  }
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./i, '').split('.')[0] || '';
    if (host && host.length > 2) return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {}
  return 'Unknown';
}

/**
 * Pure normalizer: URL + stripped 6k text (+ optional pre-extracted hints)
 * → NormalizedOpportunity with type-aware source. No network/DB.
 */
export function buildPasteLinkOpportunity(
  urlStr: string,
  stripped: string,
  type: PasteLinkType | string,
  hints?: { title?: string; description?: string; deadline?: string; prize?: string; organizer?: string },
): NormalizedOpportunity {
  const normType: PasteLinkType =
    String(type || '').toUpperCase() === 'INTERNSHIP' ? 'INTERNSHIP' : 'HACKATHON';
  const url = String(urlStr || '').trim();
  const text = String(stripped || '');
  let title = String(hints?.title || '').trim().slice(0, 150);
  if (!title || title.length < 3) title = slugTitleFromUrl(url);
  if (!title || title.length < 3) {
    title = `Custom ${normType === 'HACKATHON' ? 'hackathon' : 'internship'}`;
  }
  let description = String(hints?.description || '').trim();
  if (!description) description = text.substring(0, 400).trim() || title;
  let deadline = String(hints?.deadline || '').trim();
  if (!deadline && text.length >= 10) {
    try {
      deadline = extractDeadlineFromContent(text) || '';
    } catch {
      deadline = '';
    }
  }
  if (normType === 'HACKATHON') {
    let prize = String(hints?.prize || '').trim().slice(0, 120);
    if (!prize) {
      const m = text.match(/(?:prize|reward|cash)\s*[:\-]?\s*₹?\s*[\d,]+(?:\s*(?:lakh|k|crore))?/i);
      if (m) prize = m[0].trim().slice(0, 120);
    }
    const organizer = String(hints?.organizer || '').trim().slice(0, 120);
    return {
      type: 'HACKATHON',
      title,
      description,
      url,
      source: PASTE_LINK_HACKATHON_SOURCE,
      organizer: organizer || '',
      deadline: deadline || '',
      startDate: '',
      duration: '',
      location: /india/i.test(text) ? 'India' : 'Online',
      mode: 'ONLINE',
      prizePool: prize || '',
      stipend: '',
      company: '',
      role: '',
      themes: [],
      website: '',
      discord: '',
      participantsCount: 0,
      inviteOnly: false,
    };
  }
  const company = companyFromTitleOrUrl(title, url);
  return {
    type: 'INTERNSHIP',
    title,
    description,
    url,
    source: PASTE_LINK_INTERNSHIP_SOURCE,
    organizer: company,
    deadline: deadline || '',
    startDate: '',
    duration: '',
    location: '',
    mode: 'REMOTE',
    prizePool: '',
    stipend: '',
    company,
    role: title,
    themes: [],
    website: '',
    discord: '',
    participantsCount: 0,
    inviteOnly: false,
  };
}

function stripTo6k(html: string): { title: string; stripped: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let title = titleMatch ? titleMatch[1].trim().slice(0, 150) : '';
  if (!title) {
    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1) title = h1[1].trim().slice(0, 150);
  }
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 6000);
  return { title, stripped };
}

/**
 * Fetch one paste-link page → 6k stripped + title.
 * SSRF: validatePublicUrl (no allowlist) + redirect:manual + TOCTOU
 * re-validate single hop + 2MB cap + 15s timeout. Fail-open: throws on
 * validation/fetch failure (caller records per-URL error, never kills batch).
 * Short cache: 5-min paste-link prefix (not the 12h scrape cache default).
 */
export async function fetchPasteLink6k(
  urlStr: string,
): Promise<{ title: string; stripped: string }> {
  const cacheKey = `pastelink:${urlStr}`;
  try {
    const cached = scrapeCache.get<{ title: string; stripped: string }>(cacheKey);
    if (cached && cached.stripped) return cached;
  } catch {}
  await validatePublicUrl(urlStr);
  const doFetch = async (target: string): Promise<Response> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), PASTE_LINK_FETCH_TIMEOUT_MS);
    try {
      return await fetch(target, {
        headers: { 'User-Agent': UA },
        signal: controller.signal,
        redirect: 'manual' as unknown as string,
      } as unknown as RequestInit);
    } finally {
      clearTimeout(t);
    }
  };
  const readCapped = async (res: Response): Promise<string> => {
    const len = Number(res.headers.get('content-length') || '0');
    if (len && len > PASTE_LINK_MAX_BYTES) throw new Error('Page too large');
    const html = await res.text();
    if (html.length > PASTE_LINK_MAX_BYTES) throw new Error('Page too large');
    return html;
  };
  let res = await doFetch(urlStr);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (!loc) throw new Error('Redirect without location');
    const nextUrl = new URL(loc, urlStr).toString();
    await validatePublicUrl(nextUrl);
    const r2 = await doFetch(nextUrl);
    if (r2.status >= 300 && r2.status < 400) throw new Error('Too many redirects');
    if (!r2.ok) throw new Error(`Fetch failed: ${r2.status}`);
    const html = await readCapped(r2);
    const out = stripTo6k(html);
    try {
      scrapeCache.set(cacheKey, out, PASTE_LINK_CACHE_TTL_SEC);
    } catch {}
    return out;
  }
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await readCapped(res);
  const out = stripTo6k(html);
  try {
    scrapeCache.set(cacheKey, out, PASTE_LINK_CACHE_TTL_SEC);
  } catch {}
  return out;
}

export interface PasteLinkPerUrl {
  url: string;
  ok: boolean;
  title?: string;
  error?: string;
}

/**
 * Fail-open batch: every URL isolated (validate + fetch + normalize in
 * try/catch). One bad link → perUrl error, siblings still succeed.
 */
export async function fetchPasteLinks(
  urls: string[],
  type: PasteLinkType,
  fetchFn: (url: string) => Promise<{ title: string; stripped: string }> = fetchPasteLink6k,
): Promise<{ items: NormalizedOpportunity[]; perUrl: PasteLinkPerUrl[] }> {
  const items: NormalizedOpportunity[] = [];
  const perUrl: PasteLinkPerUrl[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url) continue;
    const dk = normalizePasteUrlForDedup(url);
    if (seen.has(dk)) continue;
    seen.add(dk);
    try {
      const { title, stripped } = await fetchFn(url);
      const opp = buildPasteLinkOpportunity(url, stripped, type, { title });
      // Skip empties that would fail saveItems (no title/url) — count as error, not throw.
      if (!opp.title || !opp.url) {
        perUrl.push({ url, ok: false, error: 'Empty title after fetch' });
        continue;
      }
      items.push(opp);
      perUrl.push({ url, ok: true, title: opp.title });
    } catch (e: unknown) {
      const msg = String((e as Error)?.message || e || 'Fetch failed').slice(0, 300);
      logger.debug({ err: msg, url }, '[pasteLinks] per-URL fail-open (skipped):');
      perUrl.push({ url, ok: false, error: msg });
    }
  }
  // In-memory URL+title dedup (normalizeSource parity: source already distinct per type).
  const out: NormalizedOpportunity[] = [];
  const keys = new Set<string>();
  for (const o of items) {
    const k = `${String(o.url || '').toLowerCase()}::${String(o.title || '').trim().toLowerCase()}`;
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(o);
  }
  return { items: out, perUrl };
}
