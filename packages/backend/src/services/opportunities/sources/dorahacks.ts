// opportunities/sources/dorahacks.ts — DoraHacks platform fetcher (Track 4 C-3 split).
// WHY: GraphQL API (global Web3/AI), one home.
// Moved verbatim from opportunityAgent.ts; AbortSignal timeouts preserved.
import prisma from '../../../config/db'
import { searchDetails, parseSearchDate, extractDeadlineFromContent, hasRegistrationClosedIndicator } from '../../../utils/search'
import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache } from '../cache'
import type { NormalizedOpportunity } from '../types'
import { hasValue } from '../types'
import { stripHtml, isGenericTitle } from '../text'
import { extractPastYearFromTitle, isTitlePastYear, inferDeadlineFromTitle, isEnded } from '../dates'
import { isCompanyStartupCollegeOrganizer, getHackathonReputationScore, applyHighOrganizerTrustBoost, DYNAMIC_COMPANY_COLLEGE_INDICATORS } from '../reputation'
import { UA, MAX_PAGES, PER_PAGE, fetchPage6k } from './context'
import { decodeDuckDuckGoHref } from './searchFetch'
import { cleanDescription, extractPrizeTiers } from './details'

// ─── DoraHacks detail timeline (MEDIUM 2026-09-09 REPORT-dorahacks.md wart 1) ───
// Detail pages carry 3-4 milestone timelines (Pre-registration/Submission/Deadline/
// Extended) but the HTML-path fetcher emitted deadline '' + duration '' (list HTML/
// JSON-paths carry no dates — honest at list level, miss vs detail).
// Evidence (B.webfetch-detail-*.md, webfetch authoritative, runner plain-fetch 405 artifact):
// - Event Contracts: Pre-reg 2026/08/18, Submission 2026/08/25, Deadline 2026/09/08 18:00,
//   Extended 2026/09/11 18:00 (authoritative deadline = 2026-09-11 extended).
// - BUIDL CTC 2026 Fall: Submission 2026/08/13, Deadline 2026/09/06, Extended 2026/09/14
//   (authoritative = 2026-09-14).
// Pure, no network/DB — hermetic unit-testable. Omit absent (never invent).
export function parseDoraHacksTimeline(text: unknown): {
  stages: Array<{ title: string; date?: string }>
  dates: Array<{ label: string; date: string }>
  deadline: string
} {
  const s = String(text ?? '');
  if (!s.trim()) return { stages: [], dates: [], deadline: '' };
  const stages: Array<{ title: string; date?: string }> = [];
  const dates: Array<{ label: string; date: string }> = [];
  const seen = new Set<string>();
  // Labels + YYYY/MM/DD (or YYYY-MM-DD) + optional HH:mm. Handles both webfetch markdown
  // newlines and fetchPage6k single-line stripped ("Pre-registration 2026/08/18 00:00 ...").
  const re =
    /(pre[\s\-]*registration|submission|deadline|extended)(?:\s*deadline)?\s*[:\n\r]*\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null && stages.length < 10) {
    const raw = m[1].toLowerCase().replace(/[\s\-]+/g, '');
    let label = '';
    if (/^preregistration$/.test(raw)) label = 'pre_registration';
    else if (raw === 'submission') label = 'submission';
    else if (raw === 'deadline') label = 'deadline';
    else if (raw === 'extended') label = 'extended';
    else continue;
    if (seen.has(label)) continue;
    seen.add(label);
    const ymd = m[2].replace(/\//g, '-');
    const parts = ymd.split('-');
    if (parts.length !== 3) continue;
    const iso = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) continue;
    const titleMap: Record<string, string> = {
      pre_registration: 'Pre-registration',
      submission: 'Submission',
      deadline: 'Deadline',
      extended: 'Extended',
    };
    const title = titleMap[label] || label;
    stages.push({ title, date: iso });
    dates.push({ label, date: iso });
    if (m[0].length === 0) re.lastIndex++;
  }
  let deadline = '';
  const ext = dates.find((x) => x.label === 'extended');
  if (ext) deadline = ext.date;
  else if (dates.length) {
    const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
    deadline = sorted[sorted.length - 1].date;
  }
  return { stages, dates, deadline };
}

/**
 * Organizer from detail/window text (MEDIUM 2026-09-10 org-constant wart, safe part).
 * WHY: non-GQL pushes hardcode `DoraHacks` although detail proves `Somnia` /
 * `BUIDL CTC` event orgs. Strict `Organized/Hosted/Presented/Powered by X` only
 * (never bare college mentions — same bleed guard as H2S organizer).
 * Returns '' when absent (caller keeps 'DoraHacks' platform fallback, never invents).
 * Pure, no network/DB.
 */
export function extractDoraHacksOrganizer(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  try {
    const m = s.match(/(?:organized\s+by|organised\s+by|hosted\s+by|presented\s+by|powered\s+by|sponsored\s+by)\s+([A-Z][A-Za-z0-9 &.'\-–]{2,80})/i);
    if (m) {
      const cand = m[1].replace(/\s+/g, ' ').trim().split(/[.;|]/)[0].trim().slice(0, 80);
      if (cand.length >= 3 && !isGenericTitle(cand)) return cand;
    }
    return '';
  } catch {
    return '';
  }
}

// --- DoraHacks: Global Web3 + AI hackathons (dorahacks.io) ---
// FIX: dorahacks.io/graphql returns 404 or WAF Human Verification, and HTML is Next.js minimal (banners only 6) + WAF on sub-assets.
// Use API-first -> HTML (with improved banner/title fallback) -> DuckDuckGo degraded fallback for WAF case.
export async function fetchDoraHacksPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  // 1) Try GraphQL on page 1 only (may be WAF'd)
  if (page === 1) {
    const gqlUrl = 'https://dorahacks.io/graphql'
    try {
      await validateExternalUrl(gqlUrl)
      const gqlRes = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          query: `query Hackathons($page:Int,$pageSize:Int){ hackathonList(page:$page,pageSize:$pageSize){ list{ id title shortDescription description prize prizePool startTime endTime deadline url slug organization organizer } totalCount } }`,
          variables: { page, pageSize: PER_PAGE },
        }),
      })
      const bodyText = await gqlRes.text()
      const lowerBody = bodyText.toLowerCase()
      if (lowerBody.includes('human verification') || lowerBody.includes('awswaf') || lowerBody.includes('captcha')) {
        try { scrapeCache.set('dorahacks:waf', true, 600) } catch {}
        // don't return immediately - fall through to HTML/DDG but mark WAF
      } else if (gqlRes.ok) {
        try {
          const data = JSON.parse(bodyText) as any
          const list: any[] = data.data?.hackathonList?.list || data.data?.hackathons?.list || data.data?.list || []
          if (Array.isArray(list) && list.length > 0) {
            const opps: NormalizedOpportunity[] = []
            for (const h of list) {
              const title: string = (h.title || h.name || '').toString().trim()
              if (!title || isGenericTitle(title) || seen.has(title)) continue
              seen.add(title)
              const slug: string = h.slug || h.id || ''
              const url: string = h.url || (slug ? `https://dorahacks.io/hackathon/${String(slug).replace(/^\/+/, '')}` : 'https://dorahacks.io/hackathon')
              try { await validateExternalUrl(url) } catch { continue }
              let deadline = ''
              const rawDeadline: string = h.deadline || h.endTime || h.endDate || ''
              if (rawDeadline) {
                const d = new Date(rawDeadline)
                deadline = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : parseSearchDate(String(rawDeadline)) || ''
              }
              let gqlDetail = ''
              if (!deadline) {
                try {
                  const stripped = await fetchPage6k(url)
                  if (stripped && stripped.length > 100) {
                    gqlDetail = stripped
                    const ext = extractDeadlineFromContent(stripped)
                    if (ext) deadline = ext
                  }
                } catch {}
              }
              // Detail timeline enrichment when detail was already fetched (no extra fetch):
              // milestones → stages/dates + authoritative Extended/last deadline.
              let gqlStages: Array<{ title: string; date?: string }> | undefined
              let gqlDates: Array<{ label: string; date: string }> | undefined
              try {
                if (gqlDetail) {
                  const tl = parseDoraHacksTimeline(gqlDetail)
                  if (tl.stages.length) {
                    gqlStages = tl.stages
                    gqlDates = tl.dates
                  }
                  if (tl.deadline) deadline = tl.deadline
                }
              } catch {}
              if (!deadline) deadline = inferDeadlineFromTitle(title, url)
              if (isEnded(deadline, title)) continue
              const rawPrize: string = (h.prizePool || h.prize || '').toString().trim()
              // Omit absent; never invent zero-amount. Keep full tier text (not 80-truncated
              // when it carries multi-tier info — cap at 300 to preserve tiers+perks).
              const prizePool = rawPrize.slice(0, 300)
              const textPrizes = extractPrizeTiers(`${title} ${rawPrize} ${stripHtml(h.shortDescription || h.description || '')}`)
              const prizeTiers = textPrizes.tiers.length ? textPrizes.tiers : undefined
              const perks = textPrizes.perks.length ? textPrizes.perks : undefined
              const description = cleanDescription(h.shortDescription || h.description || '', { title, source: 'DORAHACKS' })
              const oppGql: NormalizedOpportunity = {
                type: 'HACKATHON',
                title: title.slice(0, 150),
                description,
                url,
                source: 'DORAHACKS',
                organizer: (h.organizer || h.organization || 'DoraHacks').toString().slice(0, 80) || 'DoraHacks',
                deadline,
                startDate: h.startTime ? String(h.startTime).split('T')[0] : '',
                duration: '',
                location: 'Online',
                mode: 'ONLINE',
                prizePool,
                stipend: '',
                company: '',
                role: '',
                themes: Array.isArray(h.themes) ? h.themes : [],
                website: h.website || '',
                discord: h.discord || '',
                participantsCount: h.participantsCount || 0,
                inviteOnly: !!h.inviteOnly,
                ...(prizeTiers ? { prizeTiers } : {}),
                ...(perks ? { perks } : {}),
              }
              if (gqlStages?.length) oppGql.stages = gqlStages
              if (gqlDates?.length) oppGql.dates = gqlDates
              opps.push(oppGql)
            }
            if (opps.length > 0) return opps
          }
        } catch {}
      }
    } catch {}
  }

  // 2) HTML scrape (works for page 1 even under WAF-lite; later pages may be WAF'd)
  const url = page === 1 ? 'https://dorahacks.io/hackathon' : `https://dorahacks.io/hackathon?page=${page}`
  const cacheKey = `dorahacks:html:${page}`
  let html: string | undefined = scrapeCache.get<string>(cacheKey)
  let htmlFetchedOk = false
  if (!html) {
    try { await validateExternalUrl(url) } catch { /* fall through to DDG */ }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const txt = await res.text()
        const lower = txt.toLowerCase()
        // Strict WAF detection: challenge page has <title>Human Verification</title> and gokuProps; normal page also contains awswaf/captcha scripts but not the challenge title
        const isWafChallenge = lower.includes('<title>human verification</title>') || (lower.includes('human verification') && lower.includes('gokuprops') && txt.length < 10000)
        if (isWafChallenge) {
          try { scrapeCache.set('dorahacks:waf', true, 600) } catch {}
          try { scrapeCache.set(cacheKey, '', 600) } catch {}
        } else {
          html = txt
          htmlFetchedOk = true
          try { scrapeCache.set(cacheKey, html, 12 * 60 * 60) } catch {} // P0-D: 12h aligns to 12h cron (was 6h)
        }
      }
    } catch { /* ignore, fallback to DDG */ }
  } else if (html && html.length > 0) {
    htmlFetchedOk = true
    const lowerHtml = html.toLowerCase()
    const isWafChallenge = lowerHtml.includes('<title>human verification</title>') || (lowerHtml.includes('human verification') && lowerHtml.includes('gokuprops') && html.length < 10000)
    if (isWafChallenge) {
      try { scrapeCache.set('dorahacks:waf', true, 600) } catch {}
      htmlFetchedOk = false
      html = undefined
    }
  }

  if (htmlFetchedOk && html) {
    const opportunities: NormalizedOpportunity[] = []
    // Use anchorRegex but with slug fallback for empty inner (common for banner images)
    const anchorRegex = /<a[^>]+href="([^"]*(?:\/hackathon\/|\/hackathon|\/buidl\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    let match: RegExpExecArray | null
    while ((match = anchorRegex.exec(html)) !== null && opportunities.length < 20) {
      let href = match[1]?.trim() || ''
      const inner = match[2] || ''
      if (!href) continue
      if (href.startsWith('/')) href = `https://dorahacks.io${href}`
      if (!href.includes('dorahacks.io')) continue
      try { await validateExternalUrl(href) } catch { continue }
      // Skip nav self-link /hackathon (bare list page) which yields generic title Hackathons
      try {
        const u = new URL(href)
        const p = u.pathname.replace(/\/+$/, '')
        if (p === '/hackathon') continue
      } catch {}
      if (href.toLowerCase() === 'https://dorahacks.io/hackathon' || href.toLowerCase() === 'https://dorahacks.io/hackathon/') continue
      let titleRaw = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
      // Fallback: if inner empty (banner image), derive from slug
      let title = titleRaw.split('\n')[0]?.trim() || ''
      if (!title || title.length < 5) {
        try {
          const slugPart = href.split('/hackathon/')[1] || href.split('/buidl/')[1] || ''
          const slug = slugPart.split('/')[0].split('?')[0].split('#')[0].trim()
          if (slug && slug.length >= 3) {
            title = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim().slice(0, 150)
            // Append Hackathon if not present
            if (!title.toLowerCase().includes('hack')) title = `${title} Hackathon`
          }
        } catch {}
      }
      // Filter generic nav title
      if (title.toLowerCase() === 'hackathons' || title.toLowerCase() === 'hackathon') continue
      if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) continue
      seen.add(title)
      const windowStart = Math.max(0, (match.index || 0) - 800)
      const windowEnd = Math.min(html.length, (match.index || 0) + 1500)
      const windowText = html.substring(windowStart, windowEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      let deadline = extractDeadlineFromContent(windowText) || ''
      let detailStripped = ''
      if (!deadline) {
        try {
          const stripped = await fetchPage6k(href)
          if (stripped && stripped.length > 100) {
            detailStripped = stripped
            const ext = extractDeadlineFromContent(stripped)
            if (ext) deadline = ext
          }
        } catch {}
      }
      // Detail timeline enrichment: milestones → stages/dates + authoritative Extended/last deadline.
      // Detail pages carry Pre-reg/Submission/Deadline/Extended (B.webfetch-detail-*.md);
      // list window has no dates so deadline is '' without this (wart 1 MEDIUM).
      let dhStages: Array<{ title: string; date?: string }> = []
      let dhDates: Array<{ label: string; date: string }> | undefined
      try {
        if (!detailStripped) {
          const ds = await fetchPage6k(href)
          if (ds && ds.length > 100) detailStripped = ds
        }
        if (detailStripped) {
          const tl = parseDoraHacksTimeline(detailStripped)
          if (tl.stages.length) {
            dhStages = tl.stages
            dhDates = tl.dates
          }
          if (tl.deadline) deadline = tl.deadline
        }
      } catch {}
      if (!deadline) deadline = inferDeadlineFromTitle(title, href)
      if (isEnded(deadline, title)) continue
      // MEDIUM prize fix (safe part): keep full tier text (cap 300, not 80 which
      // cut tiers) + tiers/perks via shared extractor (GQL path already does —
      // anchor path lagged with single 80-char match, no tiers).
      let prizePool = ''
      const prizeMatch = windowText.match(/(?:prize|reward|cash|pool)\s*[:\-]?\s*[?$]?\s*[\d,]+(?:\s*(?:lakh|crore|k|USD|INR))?/i)
      if (prizeMatch) prizePool = prizeMatch[0].trim().slice(0, 300)
      const anchorPrizes = extractPrizeTiers(`${title} ${windowText} ${detailStripped || ''}`)
      if (!prizePool && anchorPrizes.prizePool) prizePool = anchorPrizes.prizePool.slice(0, 300)
      else if (anchorPrizes.prizePool && prizePool && !prizePool.includes(anchorPrizes.prizePool.slice(0, 20))) {
        // Prefer richer tiers text when window single-match is a fragment.
        if (anchorPrizes.tiers.length) prizePool = anchorPrizes.prizePool.slice(0, 300)
      }
      // MEDIUM org fix (safe part): strict Organized-by mining on window+detail,
      // else platform fallback (never invent).
      const anchorOrg = extractDoraHacksOrganizer(`${windowText} ${detailStripped || ''}`) || 'DoraHacks'
      const oppAnchor: NormalizedOpportunity = {
        type: 'HACKATHON',
        title: title.slice(0, 150),
        description: '',
        url: href,
        source: 'DORAHACKS',
        organizer: anchorOrg.slice(0, 80),
        deadline,
        startDate: '',
        duration: '',
        location: 'Online',
        mode: 'ONLINE',
        prizePool,
        stipend: '',
        company: '',
        role: '',
        themes: [],
        website: '',
        discord: '',
        participantsCount: 0,
        inviteOnly: false,
        ...(anchorPrizes.tiers.length ? { prizeTiers: anchorPrizes.tiers } : {}),
        ...(anchorPrizes.perks.length ? { perks: anchorPrizes.perks } : {}),
      }
      if (dhStages.length) oppAnchor.stages = dhStages
      if (dhDates?.length) oppAnchor.dates = dhDates
      opportunities.push(oppAnchor)
    }
    // h2/h3 fallback if anchor yielded 0 (e.g., JS-rendered list not in anchor)
    if (opportunities.length === 0) {
      const hRegex = /<h[2-3][^>]*>([^<]{5,120})<\/h[2-3]>/gi
      while ((match = hRegex.exec(html)) !== null && opportunities.length < 10) {
        const title = match[1].trim()
        if (!title || isGenericTitle(title) || seen.has(title)) continue
        if (!title.toLowerCase().includes('hack') && !title.toLowerCase().includes('buidl')) continue
        seen.add(title)
        const windowStart = Math.max(0, (match.index || 0) - 800)
        const windowEnd = Math.min(html.length, (match.index || 0) + 1500)
        const windowText = html.substring(windowStart, windowEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        let deadline = extractDeadlineFromContent(windowText) || ''
        if (!deadline) {
          try {
            const stripped = await fetchPage6k(url)
            if (stripped && stripped.length > 100) {
              const ext = extractDeadlineFromContent(stripped)
              if (ext) deadline = ext
            }
          } catch {}
        }
        if (!deadline) deadline = inferDeadlineFromTitle(title, url)
        if (isEnded(deadline, title)) continue
        opportunities.push({
          type: 'HACKATHON',
          title: title.slice(0, 150),
          description: '',
          url,
          source: 'DORAHACKS',
          organizer: 'DoraHacks',
          deadline,
          startDate: '',
          duration: '',
          location: 'Online',
          mode: 'ONLINE',
          prizePool: '',
          stipend: '',
          company: '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: 0,
          inviteOnly: false,
        })
      }
    }
    // Also try to harvest any bare dorahacks hackathon URLs via href scan (for banners where title derived from slug)
    if (opportunities.length === 0) {
      const hrefRegex = /href="(\/hackathon\/[^"?#\/\s"]+)[\/?#"]?/gi
      let m: RegExpExecArray | null
      while ((m = hrefRegex.exec(html)) !== null && opportunities.length < 15) {
        let href = m[1]?.trim() || ''
        if (!href) continue
        href = `https://dorahacks.io${href}`
        try { await validateExternalUrl(href) } catch { continue }
        const slugPart = href.split('/hackathon/')[1]?.split('/')[0] || ''
        if (!slugPart || slugPart.length < 3) continue
        let title = slugPart.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
        if (!title.toLowerCase().includes('hack')) title = `${title} Hackathon`
        if (isGenericTitle(title) || seen.has(title)) continue
        seen.add(title)
        let deadline = inferDeadlineFromTitle(title, href)
        // Detail timeline enrichment (same as anchor path — list hrefs carry no dates).
        let hrefStages: Array<{ title: string; date?: string }> = []
        let hrefDates: Array<{ label: string; date: string }> | undefined
        let hrefDetail = ''
        try {
          const ds = await fetchPage6k(href)
          if (ds && ds.length > 100) {
            hrefDetail = ds
            const tl = parseDoraHacksTimeline(ds)
            if (tl.stages.length) {
              hrefStages = tl.stages
              hrefDates = tl.dates
            }
            if (tl.deadline) deadline = tl.deadline
          }
        } catch {}
        if (isEnded(deadline, title)) continue
        // MEDIUM org/prize (safe): mine detail text already fetched for timeline.
        const hrefPrizes = hrefDetail ? extractPrizeTiers(`${title} ${hrefDetail}`) : { prizePool: '', tiers: [] as string[], perks: [] as string[] }
        const hrefOrg = (hrefDetail ? extractDoraHacksOrganizer(hrefDetail) : '') || 'DoraHacks'
        const oppHref: NormalizedOpportunity = {
          type: 'HACKATHON',
          title: title.slice(0, 150),
          description: '',
          url: href,
          source: 'DORAHACKS',
          organizer: hrefOrg.slice(0, 80),
          deadline,
          startDate: '',
          duration: '',
          location: 'Online',
          mode: 'ONLINE',
          prizePool: (hrefPrizes.prizePool || '').slice(0, 300),
          stipend: '',
          company: '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: 0,
          inviteOnly: false,
          ...(hrefPrizes.tiers.length ? { prizeTiers: hrefPrizes.tiers } : {}),
          ...(hrefPrizes.perks.length ? { perks: hrefPrizes.perks } : {}),
        }
        if (hrefStages.length) oppHref.stages = hrefStages
        if (hrefDates?.length) oppHref.dates = hrefDates
        opportunities.push(oppHref)
      }
    }
    // JSON-embedded paths from __NUXT_DATA__ (banners are JSON "path": "/hackathon/...", not href attribute)
    if (opportunities.length === 0) {
      const jsonPathRegex = /"(\/hackathon\/[^"]+?)"/g
      let jm: RegExpExecArray | null
      while ((jm = jsonPathRegex.exec(html)) !== null && opportunities.length < 15) {
        let href = jm[1]?.trim() || ''
        if (!href) continue
        href = href.split('?')[0].split('#')[0]
        if (!href.startsWith('/')) href = `/${href}`
        // Filter bare "/hackathon" or "/hackathon/" without slug
        const slugPart = href.split('/hackathon/')[1]?.split('/')[0]?.replace(/[^a-zA-Z0-9\-_]/g, '') || ''
        if (!slugPart || slugPart.length < 2) continue
        href = `https://dorahacks.io${href}`
        // Normalize trailing slash
        if (!href.endsWith('/')) href = `${href}/`
        try { await validateExternalUrl(href) } catch { continue }
        let title = slugPart.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
        if (!title.toLowerCase().includes('hack')) title = `${title} Hackathon`
        if (isGenericTitle(title) || seen.has(title)) continue
        seen.add(title)
        let deadline = inferDeadlineFromTitle(title, href)
        // Detail timeline enrichment (same as anchor path — JSON-path slugs carry no dates).
        let jsonStages: Array<{ title: string; date?: string }> = []
        let jsonDates: Array<{ label: string; date: string }> | undefined
        let jsonDetail = ''
        try {
          const ds = await fetchPage6k(href)
          if (ds && ds.length > 100) {
            jsonDetail = ds
            const tl = parseDoraHacksTimeline(ds)
            if (tl.stages.length) {
              jsonStages = tl.stages
              jsonDates = tl.dates
            }
            if (tl.deadline) deadline = tl.deadline
          }
        } catch {}
        if (isEnded(deadline, title)) continue
        // MEDIUM org/prize (safe): mine detail text already fetched for timeline.
        const jsonPrizes = jsonDetail ? extractPrizeTiers(`${title} ${jsonDetail}`) : { prizePool: '', tiers: [] as string[], perks: [] as string[] }
        const jsonOrg = (jsonDetail ? extractDoraHacksOrganizer(jsonDetail) : '') || 'DoraHacks'
        const oppJson: NormalizedOpportunity = {
          type: 'HACKATHON',
          title: title.slice(0, 150),
          description: '',
          url: href,
          source: 'DORAHACKS',
          organizer: jsonOrg.slice(0, 80),
          deadline,
          startDate: '',
          duration: '',
          location: 'Online',
          mode: 'ONLINE',
          prizePool: (jsonPrizes.prizePool || '').slice(0, 300),
          stipend: '',
          company: '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: 0,
          inviteOnly: false,
          ...(jsonPrizes.tiers.length ? { prizeTiers: jsonPrizes.tiers } : {}),
          ...(jsonPrizes.perks.length ? { perks: jsonPrizes.perks } : {}),
        }
        if (jsonStages.length) oppJson.stages = jsonStages
        if (jsonDates?.length) oppJson.dates = jsonDates
        opportunities.push(oppJson)
      }
    }
    if (opportunities.length > 0) return opportunities
  }

  // 3) Degraded fallback: DuckDuckGo search for DoraHacks hackathons when WAF or empty (task requirement)
  // Note: site: queries often trigger DDG anomaly-modal bot check; detect and retry with generic query
  try {
    let ddgQuery = page === 1 ? 'site:dorahacks.io hackathon' : `site:dorahacks.io hackathon 2026 page ${page}`
    let searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(ddgQuery)}&p=${page}`
    let cacheKey = `dorahacks:ddg:${page}`
    let ddgHtml: string | undefined = scrapeCache.get<string>(cacheKey)
    if (!ddgHtml) {
      try { await validateExternalUrl(searchUrl) } catch { /* ddg allowlisted */ }
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' },
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        ddgHtml = await res.text()
        // Detect DDG bot challenge (anomaly-modal) - retry with generic query without site:
        if (ddgHtml && ddgHtml.toLowerCase().includes('anomaly-modal')) {
          const altQuery = page === 1 ? 'DoraHacks hackathon' : `DoraHacks hackathon 2026 page ${page}`
          const altUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(altQuery)}&p=${page}`
          try {
            const altRes = await fetch(altUrl, {
              headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' },
              signal: AbortSignal.timeout(10000),
            })
            if (altRes.ok) {
              const altHtml = await altRes.text()
              if (altHtml && !altHtml.toLowerCase().includes('anomaly-modal') && altHtml.length > 1000) {
                ddgHtml = altHtml
                // also cache alt as fallback
                try { scrapeCache.set(`${cacheKey}:alt`, altHtml, 600) } catch {}
              } else if (altHtml && altHtml.length > 1000) {
                // keep original but anomaly still - will be filtered later
              }
            }
          } catch {}
        }
        if (ddgHtml && ddgHtml.length > 1000 && !ddgHtml.toLowerCase().includes('anomaly-modal')) try { scrapeCache.set(cacheKey, ddgHtml, 600) } catch {}
        else if (ddgHtml && ddgHtml.toLowerCase().includes('anomaly-modal')) ddgHtml = undefined
      }
    } else if (ddgHtml && ddgHtml.toLowerCase().includes('anomaly-modal')) {
      ddgHtml = undefined
    }
    if (ddgHtml) {
      const opportunities: NormalizedOpportunity[] = []
      const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
      const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      const snippets: string[] = []
      let sMatch: RegExpExecArray | null
      while ((sMatch = snippetRegex.exec(ddgHtml)) !== null) {
        const txt = sMatch[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
        if (txt.length > 20) snippets.push(txt)
      }
      let idx = 0
      let match: RegExpExecArray | null
      while ((match = linkRegex.exec(ddgHtml)) !== null && opportunities.length < 15) {
        let href = match[1] || ''
        const titleHtml = match[2] || ''
        href = decodeDuckDuckGoHref(href)
        if (!href || href.includes('duckduckgo.com')) { idx++; continue }
        if (!href.includes('dorahacks.io')) { idx++; continue }
        try { await validateExternalUrl(href) } catch { idx++; continue }
        const title = titleHtml.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
        if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) { idx++; continue }
        if (!title.toLowerCase().includes('hack') && !href.toLowerCase().includes('hackathon') && !href.toLowerCase().includes('buidl')) { idx++; continue }
        seen.add(title)
        const snippet = snippets[idx] || ''
        let deadline = extractDeadlineFromContent(`${title} ${snippet}`) || ''
        if (!deadline) {
          try {
            const stripped = await fetchPage6k(href)
            if (stripped && stripped.length > 100) {
              const ext = extractDeadlineFromContent(stripped)
              if (ext) deadline = ext
            }
          } catch {}
        }
        if (!deadline) deadline = inferDeadlineFromTitle(title, href)
        if (isEnded(deadline, title)) { idx++; continue }
        opportunities.push({
          type: 'HACKATHON',
          title: title.slice(0, 150),
          description: cleanDescription(snippet, { title, source: 'DORAHACKS' }),
          url: href,
          source: 'DORAHACKS',
          organizer: 'DoraHacks',
          deadline,
          startDate: '',
          duration: '',
          location: 'Online',
          mode: 'ONLINE',
          prizePool: '',
          stipend: '',
          company: '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: 0,
          inviteOnly: false,
        })
        idx++
      }
      if (opportunities.length > 0) return opportunities
    }
  } catch {}

  return []
}


export async function fetchDoraHacks(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : 30
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const results = await fetchDoraHacksPage(page, seen)
    if (results.length === 0) {
      // For Dora, don't break immediately on WAF page 1 zero if DDG could supply later pages: try next page once
      if (page === 1) continue
      break
    }
    const titles = results.map(r => r.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.hackathonStaging.findMany({
          where: { title: { in: titles }, source: 'DORAHACKS' },
          select: { title: true },
        })
        existing.forEach(e => existingTitles.add(e.title))
      } catch {}
    }
    for (const item of results) {
      if (newItems.length >= target) break
      if (!item.title || isGenericTitle(item.title)) continue
      if (existingTitles.has(item.title)) continue
      if (isEnded(item.deadline, item.title)) continue
      newItems.push(item)
    }
    if (newItems.length >= target) break
  }
  const sliced = newItems.slice(0, target)
  logger.info(`[DoraHacks] Fetched ${sliced.length} hackathons (target ${limit || 30}) capped at ${MAX_PAGES} pages 10 fetches max`)
  return sliced
}
