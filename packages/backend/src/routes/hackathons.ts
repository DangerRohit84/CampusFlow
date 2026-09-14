import { Router, Response } from 'express'
import rateLimit from 'express-rate-limit'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { chatCompletion } from '../ai/client'
import ExcelJS from 'exceljs'
import { notifyUsers } from '../services/notificationService'
import { validateExternalUrl } from '../utils/secureUrl'
import { broadcastHackathonMutation } from '../services/socket'
import { deriveCollegeId, getSuperAdminTargetCollegeId, canAccessCollege, safeFilename, escapeExcelValue, contentDisposition } from '../utils/roles'
import { normalizeDepartments, normalizeThemes, normalizeYears, parseJsonArraySafe, parseJsonNumberArraySafe, coerceDeadline } from '../lib/validators'
import { parseTeamMembersInput, resolveTeamMembersDisplay } from '../utils/childTables'
import { logger } from '../utils/logger'
// Track 4 DRY: completed-detection SSOT lives in services/opportunities/dates.ts.
// Local wrappers preserved so existing call sites keep working.
import { isTitlePastYear as isTitlePastYearSSOT, isStagingEnded as isStagingEndedSSOT } from '../services/opportunities/dates'
import { parseStagingParams, buildStagingWhere, buildStagingFindArgs, buildStagingPage } from '../services/opportunities/staging'
import { normalizeSource } from '../services/opportunities/dedup'
import { resolveDecisionCollegeId, canDecideForCollege, canAccessDecisionCollege, buildOwnPublishedWhere, findDecision, upsertDecision, listDecisionsForCollege } from '../services/opportunities/decisions'
import { parseMineParam, applyMineFilter, unregisterRoleError, remindRoleError, validateRemindMessage, buildRemindNotification, registeredUserIds } from '../services/opportunities/registrations'
import { stagingStore } from '../repositories/stagingRepository'
import { buildFetchDetailsPrompt, validateFetchDetails, buildHackathonDeterministicFallback, toFetchDetailsEnvelope, isAiNotConfiguredResponse } from '../services/opportunities/fetchDetails'
import { getOrSet } from '../lib/cache'

// PERF (prod burst fix): staging counts cache — this endpoint ran an unbounded
// full-table findMany scan per call, polled per viewer. Now computed at most
// 1×/60s per scope (shared via Redis when healthy, memory otherwise — same seam
// as super-dashboard). Exact same numbers; TTL-only expiry.
const STAGING_COUNTS_CACHE_TTL_MS = 60_000

// ─── Completed detection helper — handles null deadline via title year (e.g., Netscout Hackathon 2025 created 2026-09-06) ───
function isTitlePastYear(title?: string | null): boolean {
  return isTitlePastYearSSOT(title)
}
function isStagingEnded(_deadline: Date | null | undefined, title?: string | null): boolean {
  // ADMIN STAGING: Never hide based on deadline — admin must review pending even if deadline recently passed.
  // Only hide stale null-deadline items where title year is clearly past (e.g., Netscout 2025 in 2026).
  // Previous `deadline < now` check hid Cognition (2026-08-22) on Sep 06 and therefore admin never saw it.
  return isStagingEndedSSOT(_deadline, title)
}

// Fetch-details page discovery lives in services/hackathon/scraperRoutes.ts (SRP split).
// Built from the registry SSOT (enrichPages) so platform #11 needs no edits here.
// Re-exported for compat; the fetch loop below is untouched.
import { SCRAPER_PAGE_ROUTES } from '../services/hackathon/scraperRoutes';
export { SCRAPER_PAGE_ROUTES };

const router = Router()
router.use(authenticate)

const fetchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many fetch attempts, please try again later' },
})

// AI now uses AI Manager routing via src/ai/client.ts

// Extract title from HTML even if page is an SPA
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (match) return match[1].trim()
  const ogMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
  if (ogMatch) return ogMatch[1].trim()
  return ''
}

// Search the web for hackathon details when page content is an SPA
async function searchHackathonDetails(query: string): Promise<string> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    })
    const html = await resp.text()
    const snippets: string[] = []
    const urls: string[] = []
    let match

    // Extract snippets (these are <a> tags with class="result__snippet")
    const snippetRegex = /class="result__snippet"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = snippetRegex.exec(html)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
      if (text.length > 20) snippets.push(text)
    }

    // Extract result URLs (non-duckduckgo redirect URLs)
    const urlRegex = /class="result__url"[^>]*href="[^"]*uddg=([^&"]+)/gi
    while ((match = urlRegex.exec(html)) !== null) {
      try {
        const decoded = decodeURIComponent(match[1])
        if (decoded && !decoded.includes('duckduckgo.com')) urls.push(decoded)
      } catch {}
    }

    logger.info(`Web search found ${snippets.length} snippets, ${urls.length} URLs for: ${query.substring(0, 60)}`)

    // Fetch the top 3 non-SPA result pages for richer content
    const spaDomains = ['unstop.com', 'youtube.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com']
    const pagesToFetch = urls
      .filter(u => !spaDomains.some(d => u.includes(d)))
      .slice(0, 3)

    const fetchedPages: string[] = []
    for (const pageUrl of pagesToFetch) {
      try {
        try { await validateExternalUrl(pageUrl) } catch { continue }
        const pageResp = await fetch(pageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
          redirect: 'manual' as any,
        } as any)
        if (pageResp.status >= 300 && pageResp.status < 400) continue
        const pageHtml = await pageResp.text()
        const pageText = pageHtml
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 4000)
        if (pageText.length > 100) {
          fetchedPages.push(`[Source: ${pageUrl}]\n${pageText}`)
          logger.info(`Fetched ${pageUrl} (${pageText.length} chars)`)
        }
      } catch (e) {
        logger.info(`Failed to fetch ${pageUrl}`)
      }
    }

    // Combine all sources
    const allContent = [
      'Search snippets:',
      ...snippets.map((s, i) => `[${i + 1}] ${s}`),
      '',
      ...fetchedPages,
    ].join('\n')

    return allContent
  } catch (err) {
    logger.info({ err: err }, 'Web search fallback failed:')
    return ''
  }
}

// Fetch hackathon details from URL using AI - SSRF protected
export async function fetchHackathonDetails(url: string): Promise<any> {
    // AI Manager handles provider resolution
  // SSRF: validate before any fetch
  try {
    await validateExternalUrl(String(url))
  } catch {
    return null
  }

  try {
    const baseUrl = url.replace(/\/$/, '')
    
    // Determine which pages to fetch based on platform (registry lookup).
    const scraperRoute = SCRAPER_PAGE_ROUTES.find((r) => r.match(url))
    const pagesToFetch: { path: string; name: string }[] = (
      scraperRoute?.pages ?? [{ path: '', name: 'overview' }]
    ).map((p) => ({ ...p }))

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    
    const fetchPage = async (path: string): Promise<string> => {
      try {
        const fetchUrl = path ? `${baseUrl}${path}` : baseUrl
        try { await validateExternalUrl(fetchUrl) } catch { return '' }
        const response = await fetch(fetchUrl, {
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': UA },
          redirect: 'manual' as any,
        } as any)
        if (response.status >= 300 && response.status < 400) return ''
        if (!response.ok) return ''
        const html = await response.text()
        if (html.length > 2 * 1024 * 1024) return ''
        return html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 5000)
      } catch {
        return ''
      }
    }

    // Fetch pages in parallel
    const results = await Promise.allSettled(pagesToFetch.map(p => fetchPage(p.path)))
    const pageContents = results
      .map((r, i) => {
        if (r.status === 'fulfilled' && r.value.length > 100) {
          return `\n--- ${pagesToFetch[i].name.toUpperCase()} PAGE ---\n${r.value}`
        }
        return ''
      })
      .filter(Boolean)
    
    let allContent = pageContents.join('\n')
    let pageTitle = ''
    
    // Extract title from first page
    if (results[0]?.status === 'fulfilled' && results[0].value) {
      const titleMatch = results[0].value.match(/<title[^>]*>([^<]+)<\/title>/i)
      if (titleMatch) pageTitle = titleMatch[1].trim()
    }

    // If page content is too short (SPA), search the web for details
    let searchResults = ''
    if (allContent.length < 300) {
      let searchQuery = pageTitle || ''
      try {
        const urlPath = new URL(url).pathname
        const slug = urlPath.split('/').filter(Boolean).pop() || ''
        const cleaned = slug.replace(/[-_]/g, ' ').replace(/\d{5,}/g, '').replace(/\s+/g, ' ').trim()
        if (cleaned.length > 5) searchQuery = cleaned
      } catch {}
      if (!searchQuery || searchQuery.length < 5) {
        const domain = new URL(url).hostname.replace('www.', '')
        searchQuery = `${domain} hackathon`
      }
      logger.info(`Content too short (${allContent.length} chars), searching web for: ${searchQuery}`)
      searchResults = await searchHackathonDetails(searchQuery + ' hackathon details rounds dates prizes eligibility')
    }

    const contentSection = allContent.length > 300
      ? `Page content (multiple pages scraped):\n${allContent}`
      : `Page content: (SPA/JavaScript-rendered page - content not available via fetch)`

    const searchSection = searchResults
      ? `\n\nWeb search results for this hackathon:\n${searchResults}`
      : ''

    // Grounded text for post-AI validation + deterministic fallback (stages.ts:222-252 pattern).
    const groundedContent = [allContent, searchResults].filter(Boolean).join('\n')

    // Shared prompt (fetchDetails.ts SSOT): full-desc + never-₹0 + TIMELINE/ROUNDS independent.
    const prompt = buildFetchDetailsPrompt('hackathon', { url, contentSection, searchSection })

    // Use AI Manager routing (fetch feature)
    let response = ''
    try {
      response = await chatCompletion('fetch', [
        { role: 'user', content: prompt },
      ], { temperature: 0.1, max_tokens: 4000 })
    } catch (aiErr) {
      logger.info({ err: aiErr }, 'AI fetch failed for hackathon details:')
    }

    const parseAiResponse = (text: string): any => {
      if (!text) return null
      try {
        const firstParse = JSON.parse(text)
        if (typeof firstParse === 'string') return JSON.parse(firstParse)
        return firstParse
      } catch {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (jsonMatch) return JSON.parse(jsonMatch[0])
        } catch {}
        return null
      }
    }

    // No-key fallback: NOT_CONFIGURED / throw → deterministic details.ts extractors instead of null.
    if (!response || isAiNotConfiguredResponse(response)) {
      if (groundedContent && groundedContent.length > 50) {
        logger.info('AI not configured/failed for hackathon fetch — using deterministic fallback')
        return buildHackathonDeterministicFallback(groundedContent, url)
      }
      return null
    }

    const parsed = parseAiResponse(response)
    if (!parsed) {
      if (groundedContent && groundedContent.length > 50) {
        logger.info('AI parse failed for hackathon fetch — using deterministic fallback')
        return buildHackathonDeterministicFallback(groundedContent, url)
      }
      return null
    }

    // Validation gate: strip fake prizes/dates not grounded in page text before returning.
    try {
      const validated = validateFetchDetails('hackathon', parsed, groundedContent)
      if (validated.dropped.length) {
        logger.info({ dropped: validated.dropped }, 'Hackathon fetch validation dropped hallucinated fields:')
      }
      return validated.data
    } catch {
      return parsed
    }
  } catch (err) {
    logger.error({ err: err }, 'AI fetch hackathon details error:')
  }
  return null
}

// Create hackathon (Teacher)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create hackathons' })
      return
    }

    const { title, description, url, organizer, registrationUrl, startDate, endDate, deadline, teamSize, themes, collegeId, location, mode, eligibility, prizePool, duration, schedule, bootcamps, highlights, rounds, targetDepartments, targetYears, eligibilityEnabled } = req.body

    // topbottom F7: title is NOT NULL — missing title rode into Prisma and 500d.
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Title is required' })
      return
    }
    // topbottom F7: Invalid Date must 400, not ride into Prisma and 500.
    for (const [key, val] of [['startDate', startDate], ['endDate', endDate]] as const) {
      if (val !== undefined && val !== null && val !== '' && Number.isNaN(new Date(val as any).getTime())) {
        res.status(400).json({ error: `Invalid ${key}. Must be a parseable date string` })
        return
      }
    }

    const parsedTeamSize = teamSize ? parseInt(teamSize) : null
    if (parsedTeamSize !== null && isNaN(parsedTeamSize)) {
      res.status(400).json({ error: 'Invalid team size' })
      return
    }

    const targetCollegeId = deriveCollegeId(user as any, collegeId as string | null | undefined, req)
    // Order 3: canonical Json arrays only (String twins dropped, *Json renamed → base).
    const deptArr = normalizeDepartments(targetDepartments as string[] | string | null | undefined)
    const yearsArr = normalizeYears(targetYears as number[] | string | null | undefined)
    const themesArr = normalizeThemes(themes as string[] | string | null | undefined)
    const hackathon = await prisma.hackathon.create({
      data: {
        creatorId: req.userId!,
        collegeId: targetCollegeId,
        title,
        description,
        url,
        organizer,
        registrationUrl,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        deadline: coerceDeadline(deadline),
        teamSize: parsedTeamSize,
        themes: themesArr as any,
        location,
        mode: mode || 'OFFLINE',
        eligibility: typeof eligibility === 'string' ? eligibility : JSON.stringify(eligibility || {}),
        prizePool,
        duration,
        schedule,
        bootcamps: JSON.stringify(bootcamps || []),
        highlights: JSON.stringify(highlights || []),
        targetDepartments: deptArr as any,
        targetYears: yearsArr as any,
        eligibilityEnabled: eligibilityEnabled || false,
        status: 'PUBLISHED',
      },
    })

    // Create rounds if provided — single createMany (was N+1 sequential
    // creates; one round-trip, all-or-nothing instead of partial on failure).
    if (Array.isArray(rounds) && rounds.length > 0) {
      await prisma.hackathonRound.createMany({
        data: rounds.map((round: any) => ({
          hackathonId: hackathon.id,
          roundNumber: round.roundNumber,
          title: round.title || `Round ${round.roundNumber}`,
          description: round.description || '',
          date: round.date ? new Date(round.date) : null,
          resultDate: round.resultDate ? new Date(round.resultDate) : null,
        })),
      })
    }

    try { broadcastHackathonMutation({ hackathonId: hackathon.id, action: 'created' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.status(201).json(hackathon)
  } catch (error) {
    logger.error({ err: error }, 'Create hackathon error:')
    res.status(500).json({ error: 'Failed to create hackathon' })
  }
})

// Fetch hackathon details from URL (AI-powered) - SSRF protected + rate limited
router.post('/fetch-details', fetchLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { url } = req.body
    if (!url) {
      res.status(400).json({ error: 'URL required' })
      return
    }
    try {
      await validateExternalUrl(String(url))
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Invalid URL' })
      return
    }

    const details = await fetchHackathonDetails(url)
    if (details) {
      // Envelope exposes BOTH shapes: {...fields, details} (old direct + new wrapped clients).
      res.json(toFetchDetailsEnvelope(details as Record<string, unknown>))
    } else {
      res.json(toFetchDetailsEnvelope(null, 'Could not fetch details. Please fill manually.'))
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch details' })
  }
})

// Get all hackathons (filtered by role) - paginated + indexed scan
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (!user.collegeId && user.role !== 'SUPER_ADMIN') {
      res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
      res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } })
      return
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()
    const statusFilter = req.query.status as string | undefined

    // Build role-based where clause — SUPER_ADMIN respects ?collegeId= scoping via deriveCollegeId / interceptor
    let baseWhere: any = {}
    if (user.role === 'SUPER_ADMIN') {
      const scopedCollegeId = getSuperAdminTargetCollegeId(req)
      if (scopedCollegeId) baseWhere = { collegeId: scopedCollegeId }
      else baseWhere = {}
    } else if (user.role === 'COLLEGE_ADMIN') {
      baseWhere = { collegeId: user.collegeId }
    } else if (user.role === 'TEACHER') {
      baseWhere = {
        OR: [
          { creatorId: req.userId },
          { collegeId: user.collegeId },
        ],
      }
    } else {
      baseWhere = {
        status: 'PUBLISHED',
        collegeId: user.collegeId,
      }
    }

    // Optional status filter
    if (statusFilter && ['PUBLISHED', 'DRAFT'].includes(statusFilter.toUpperCase())) {
      baseWhere = { ...baseWhere, status: statusFilter.toUpperCase() }
    }

    // Server-side search (indexed, avoids shipping all records to client)
    if (search) {
      const s: any = { contains: search, mode: 'insensitive' }
      const searchClause = { OR: [{ title: s }, { description: s }, { organizer: s }] }
      baseWhere = Object.keys(baseWhere).length ? { AND: [baseWhere, searchClause] } : searchClause
    }

    // ?mine=true — own registrations only (register leftovers #5).
    // ANDs the role/search where with `{ registrations: { some: { userId } } }`
    // so students get "Registered" without client-side PII scans.
    baseWhere = applyMineFilter(baseWhere, req.userId!, parseMineParam(req.query))

    // Trim selects: _count instead of full registrations/rounds blobs (O(1) vs O(n) payload)
    const include = {
      creator: { select: { name: true, email: true } },
      _count: { select: { registrations: true, rounds: true } },
    } as const

    const [hackathons, total] = await Promise.all([
      prisma.hackathon.findMany({
        where: baseWhere,
        include,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.hackathon.count({ where: baseWhere }),
    ])

    // Map _count to legacy fields for backward compat (frontend uses registrations?.length)
    const data = hackathons.map((h: any) => ({
      ...h,
      registrations: Array(h._count.registrations).fill({}),
      rounds: Array(h._count.rounds).fill({}),
      registrationsCount: h._count.registrations,
      roundsCount: h._count.rounds,
    }))

    // High-scale: CDN-aware SWR + GitHub-style Link pagination (edge caches 2min, stale 5min)
    const pages = Math.ceil(total / limit)
    const makeLink = (p: number) => {
      const base = `${req.baseUrl}${req.path}`
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      return `<${base}?${params.toString()}>`
    }
    const links: string[] = []
    if (page < pages) links.push(`${makeLink(page + 1)}; rel="next"`)
    if (page > 1) links.push(`${makeLink(page - 1)}; rel="prev"`)
    links.push(`${makeLink(1)}; rel="first"`)
    if (pages > 0) links.push(`${makeLink(pages)}; rel="last"`)
    if (links.length) res.set('Link', links.join(', '))
    // P0 SECURITY (F11): authenticated list — private only, never s-maxage (cross-tenant CDN leak).
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        pages,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'Get hackathons error:')
    res.status(500).json({ error: 'Failed to fetch hackathons' })
  }
})

// Export all hackathons (master Excel) — P0 SECURITY (F02): tenant + role gate
router.get('/export/all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    // Only staff may bulk-export PII. Students get 403 (not empty) to avoid silent exfil confusion.
    if (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Export requires teacher or admin role' })
      return
    }

    let hackathons: any[] = []
    if (user.role === 'SUPER_ADMIN') {
      hackathons = await prisma.hackathon.findMany({
        include: {
          registrations: {
            include: { user: { select: { name: true, email: true, department: true, studentId: true } } },
          },
          rounds: true,
        },
      })
    } else {
      const where = user.collegeId
        ? { collegeId: user.collegeId }
        : { creatorId: user.id }
      hackathons = await prisma.hackathon.findMany({
        where,
        include: {
          registrations: {
            include: { user: { select: { name: true, email: true, department: true, studentId: true } } },
          },
          rounds: true,
        },
      })
    }

    if (hackathons.length === 0) {
      res.status(404).json({ error: 'No hackathons to export' })
      return
    }

    // 10k-scale guard: fail fast instead of OOMing the 512MB instance.
    // Full registration blobs are already tenant-scoped above; cap total data
    // rows and ask the caller to narrow scope (per-hackathon export).
    const EXPORT_ALL_MAX_ROWS = 10000
    const totalExportRows = hackathons.reduce(
      (n: number, h: any) => n + (h.registrations?.length ?? 0),
      0,
    )
    if (totalExportRows > EXPORT_ALL_MAX_ROWS) {
      logger.warn(
        { totalExportRows, max: EXPORT_ALL_MAX_ROWS },
        'Export all hackathons refused: row cap exceeded',
      )
      res.status(413).json({
        error: `Export too large (${totalExportRows} rows, max ${EXPORT_ALL_MAX_ROWS}). Export per hackathon instead.`,
      })
      return
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'CampusFlow'
    workbook.created = new Date()

    for (const [idx, hackathon] of hackathons.entries()) {
      let sheetName = hackathon.title.substring(0, 27)
      sheetName = `${sheetName}_${idx + 1}`
      const sheet = workbook.addWorksheet(sheetName)
      sheet.columns = [
        { header: 'S.No', key: 'sno', width: 8 },
        { header: 'Roll No', key: 'rollNo', width: 15 },
        { header: 'Student Name', key: 'name', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Department', key: 'department', width: 15 },
        { header: 'Team Name', key: 'teamName', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Current Round', key: 'currentRound', width: 15 },
        { header: 'Win Position', key: 'winPosition', width: 15 },
        { header: 'Review', key: 'review', width: 40 },
      ]

      hackathon.registrations.forEach((reg: any, idx: number) => {
        sheet.addRow({
          sno: idx + 1,
          rollNo: escapeExcelValue(reg.user.studentId || ''),
          name: escapeExcelValue(reg.user.name),
          email: escapeExcelValue(reg.user.email),
          department: escapeExcelValue(reg.user.department || ''),
          teamName: escapeExcelValue(reg.teamName || ''),
          status: escapeExcelValue(reg.status),
          currentRound: reg.currentRound,
          winPosition: escapeExcelValue(reg.winPosition || ''),
          review: escapeExcelValue(reg.review || ''),
        })
      })
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename=All_Hackathons.xlsx')
    
    try {
      const buffer = await workbook.xlsx.writeBuffer()
      const nodeBuf = Buffer.from(buffer as any)
      res.send(nodeBuf)
    } catch (bufErr) {
      logger.error({ err: bufErr }, 'Export all buffer error:')
      throw bufErr
    }
  } catch (error: any) {
    logger.error({ err: error?.message }, 'Export all hackathons error:', error?.stack)
    res.status(500).json({ error: 'Failed to export', detail: error?.message })
  }
})

// GET /staging - List staging hackathons with pagination (admin/teacher only)
router.get('/staging', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    // Real offset/cursor pagination (C-6 SSOT: services/opportunities/staging.ts
    // — parse + where + find-args + envelope in one tested place).
    // NOTE: No deadline filter for admin staging — admin must see ALL pending
    // (including recently expired like Cognition 2026-08-22; previously a
    // `deadline >= now` filter hid it and caused "not at all showing").
    // Expired items are visually marked Expired in the frontend, not hidden.
    const { page, limit, skip, cursor } = parseStagingParams(
      req.query as { page?: unknown; limit?: unknown; cursor?: unknown },
    )
    const status = req.query.status as string | undefined
    // Per-college decisions: pending = no decision by MY college (global row
    // stays PENDING; A approve/reject never hides it from B). Super-admin
    // keeps the unscoped global view. Pre-migration fallback retries without
    // the decisions fragment (P2021 table-missing).
    const isSuper = user.role === 'SUPER_ADMIN'
    const decisionCollegeId = !isSuper ? (user.collegeId || null) : null
    let scopedWhere: Record<string, unknown>
    try {
      scopedWhere = buildStagingWhere({
        status,
        collegeId: user.collegeId,
        isSuperAdmin: isSuper,
        ...(decisionCollegeId ? { decisionCollegeId } : {}),
      }).scopedWhere
    } catch {
      scopedWhere = buildStagingWhere({ status, collegeId: user.collegeId, isSuperAdmin: isSuper }).scopedWhere
    }

    const findArgs = buildStagingFindArgs({ scopedWhere, page, limit, skip, cursor })
    // DIP: staging list/count via StagingListStore (Prisma impl in prod,
    // in-memory fake in vitest) — route no longer `new`s the concrete model.
    let rows: unknown[]
    let total: number
    try {
      rows = await stagingStore.listHackathonStaging(findArgs)
      // Single count on the SAME where (was full-table select + in-memory filter per page).
      total = await stagingStore.countHackathonStaging(scopedWhere)
    } catch (e: any) {
      const msg = String(e?.message || e || '')
      if (msg.includes('decisions') || (e as any)?.code === 'P2021' || msg.includes('HackathonStagingDecision')) {
        const legacy = buildStagingWhere({ status, collegeId: user.collegeId, isSuperAdmin: isSuper }).scopedWhere
        const legacyArgs = buildStagingFindArgs({ scopedWhere: legacy, page, limit, skip, cursor })
        rows = await stagingStore.listHackathonStaging(legacyArgs)
        total = await stagingStore.countHackathonStaging(legacy)
      } else {
        throw e
      }
    }
    // Safety net only (DB already excluded past-year): drop any straggler.
    const hackathons = (rows as unknown[]).filter((h) => {
      const row = h as { deadline: Date | null; title: string }
      return !isStagingEnded(row.deadline, row.title)
    })
    const { pageRows, hasMore, nextCursor } = buildStagingPage({
      rows: rows as Array<{ id: string }>,
      filtered: hackathons as Array<{ id: string }>,
      total,
      page,
      limit,
      cursor,
    })

    res.json({
      data: pageRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        ...(cursor ? { cursor, nextCursor, hasMore } : { hasMore }),
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'Get staging hackathons error')
    res.status(500).json({ error: 'Failed to fetch staging hackathons' })
  }
})

// GET /staging/counts - Get staging counts (independent of pagination) — excludes past-year null-deadline completed (Netscout 2025)
router.get('/staging/counts', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    // Per-college decisions make college scoping exact, so the 60s cache key
    // is per scope (global for SUPER_ADMIN, per college otherwise).
    const scope = !user || user.role === 'SUPER_ADMIN' ? 'global' : `college:${user.collegeId ?? 'none'}`
    const counts = await getOrSet(`staging-counts:hack:${scope}`, STAGING_COUNTS_CACHE_TTL_MS, async () => {
      // No deadline filter — counts must include recently expired pending (Cognition) so admin sees 2 pending, not 1
      let countsWhere: Record<string, unknown> = {}
      if (user && user.role !== 'SUPER_ADMIN') {
        countsWhere = { OR: [{ collegeId: user.collegeId }, { collegeId: null }] }
      }
      // C-6: push past-year exclusion to DB so counts never scan stale rows.
      {
        const y = new Date().getFullYear()
        const ors: Array<Record<string, unknown>> = []
        for (let past = y - 6; past < y; past++) ors.push({ title: { contains: String(past) } })
        const excl = { NOT: { OR: ors } }
        countsWhere = Object.keys(countsWhere).length > 0 ? { AND: [countsWhere, excl] } : excl
      }
      const allRaw = await prisma.hackathonStaging.findMany({
        select: { id: true, targetDepartments: true, status: true, deadline: true, title: true },
        where: countsWhere as never,
      })
      // Safety net only (DB already excluded past-year).
      const all = allRaw.filter(c => !isStagingEnded(c.deadline as Date | null, c.title))
      // Per-college decisions (additive): pending = no decision by MY college.
      // A approve/reject never changes B's counts. Super-admin keeps global view.
      // Pre-migration (no table) → empty map → legacy global-status behavior.
      let myDecisions = new Map<string, string>()
      if (user && user.role !== 'SUPER_ADMIN' && user.collegeId) {
        try {
          myDecisions = await listDecisionsForCollege(prisma as any, 'hackathonStagingDecision', user.collegeId)
        } catch {
          myDecisions = new Map<string, string>()
        }
      }
      let total = 0, enriched = 0, pending = 0, approved = 0, rejected = 0
      for (const item of all) {
        // Order 3: targetDepartments is canonical Json (array); parse helper
        // accepts Json array or legacy String during rollout, never throws.
        const depts = parseJsonArraySafe((item as any).targetDepartments)
        total++
        if (depts.length > 0) enriched++
        const mine = myDecisions.get((item as any).id)
        if (mine === 'APPROVED') { approved++; continue }
        if (mine === 'REJECTED') { rejected++; continue }
        if ((item as any).status === 'APPROVED') approved++
        else if ((item as any).status === 'REJECTED') rejected++
        else if (depts.length > 0) pending++
      }
      return { total, enriched, pending, approved, rejected }
    })
    res.json(counts)
  } catch (error) {
    logger.error({ err: error }, 'Error fetching hackathon staging counts:')
    res.status(500).json({ error: 'Failed to fetch counts' })
  }
})

// GET /staging/:id - Get single staging hackathon (F15: tenant gate — role-only leaked unapproved items x-college)
router.get('/staging/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const hackathon = await prisma.hackathonStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!hackathon) {
      res.status(404).json({ error: 'Staging hackathon not found' })
      return
    }
    // Global (collegeId null) staging is visible to staff for review, but
    // tenant staging from another college is denied (null-open would leak drafts).
    if ((hackathon as any).collegeId && !canAccessCollege(user as any, (hackathon as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    // Additive: my per-college decision (APPROVED/REJECTED/null) so the
    // teacher UI can show "Approved by your college" without changing shape.
    let myDecision: string | null = null
    if (user.role !== 'SUPER_ADMIN' && user.collegeId) {
      try {
        const d = await findDecision(prisma as any, 'hackathonStagingDecision', (hackathon as any).id, user.collegeId)
        myDecision = d?.decision ?? null
      } catch {
        myDecision = null
      }
    }
    res.json({ ...(hackathon as any), ...(myDecision ? { myDecision } : {}) })
  } catch (error) {
    logger.error({ err: error }, 'Get staging hackathon error:')
    res.status(500).json({ error: 'Failed to fetch staging hackathon' })
  }
})

// Get single hackathon — P0 SECURITY (F01 BOLA): tenant gate + STUDENT own-only.
// Cross-college UUID guessing previously returned full registration PII.
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: requester + hackathon independent → Promise.all (was sequential).
    const [requester, hackathon] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }), // NARROW-READ half1
      prisma.hackathon.findUnique({
        where: { id: req.params.id as string },
        include: {
          creator: { select: { name: true, email: true, role: true } },
          registrations: {
            include: { user: { select: { name: true, email: true, department: true, departmentId: true, incomingYear: true, studentId: true } } },
          },
          rounds: { orderBy: { roundNumber: 'asc' } },
        },
      }),
    ])
    if (!requester) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }

    // Tenant isolation: deny cross-college direct-ID access (list already filters).
    if (!canAccessCollege(requester as any, (hackathon as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    // STUDENT own-only: strip other students' registrations/PII (Classroom parity).
    if (requester.role === 'STUDENT') {
      const own = (hackathon as any).registrations.filter((r: any) => r.userId === requester.id)
      res.json({ ...hackathon, registrations: own })
      return
    }

    res.json(hackathon)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch hackathon' })
  }
})

// Register for hackathon (Student) — F13: tenant gate before create
router.post('/:id/register', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: user + hackathon independent → Promise.all (was sequential).
    const [user, hackathon] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }), // NARROW-READ half1
      prisma.hackathon.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can register' })
      return
    }

    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }

    // F13: cross-college enrollment blocked — student may only register in own college.
    if (!canAccessCollege(user as any, (hackathon as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    // Check if already registered
    const existing = await prisma.hackathonRegistration.findUnique({
      where: { hackathonId_userId: { hackathonId: req.params.id as string, userId: req.userId! } },
    })

    if (existing) {
      res.status(400).json({ error: 'Already registered' })
      return
    }

    // Check eligibility if enabled — AI codes (CSE/IT/ALL) resolve to departmentIds
    if (hackathon.eligibilityEnabled) {
      // Order 3: canonical Json arrays (helpers accept Json or legacy String, never throw).
      const targetDepts = parseJsonArraySafe((hackathon as any).targetDepartments)
      const targetYears = parseJsonNumberArraySafe((hackathon as any).targetYears)

      // Must match department if targetDepartments specified (handles AI codes + UUIDs + ALL)
      if (targetDepts.length > 0) {
        const { isDepartmentEligible, getCollegeDepartments } = await import('../utils/eligibility')
        const collegeDepts = await getCollegeDepartments(hackathon.collegeId || user.collegeId)
        if (!isDepartmentEligible(targetDepts, user.departmentId, collegeDepts)) {
          res.status(403).json({ error: 'Your department is not eligible for this hackathon' })
          return
        }
      }

      // Must match year if targetYears specified
      if (targetYears.length > 0 && user.incomingYear) {
        const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
        if (!targetYears.includes(currentYear)) {
          res.status(403).json({ error: `Only year ${targetYears.join(', ')} students are eligible for this hackathon` })
          return
        }
      }
    }

    const { teamName, teamMembers, projectIdea } = req.body

    const registration = await prisma.hackathonRegistration.create({
      data: {
        hackathonId: req.params.id as string,
        userId: req.userId!,
        teamName,
        teamMembers,
        projectIdea,
        status: 'REGISTERED',
        currentRound: 0,
      },
    })

    // Order 10 (V-18): dual-write teamMembers blob → HackathonTeamMember
    // rows (best-effort — table may predate migration; blob stays fallback).
    try {
      const names = parseTeamMembersInput(teamMembers)
      if (names.length > 0) {
        await (prisma as any).hackathonTeamMember.createMany({
          data: names.map((name) => ({ registrationId: registration.id, name })),
        })
      }
    } catch (err) { logger.debug({ err }, '[hackathons] team dual-write non-fatal') }

    res.status(201).json(registration)
  } catch (error) {
    logger.error({ err: error }, 'Register hackathon error:')
    res.status(500).json({ error: 'Failed to register' })
  }
})

// Unregister from hackathon — student own only, 404 if not registered (#5 leftovers).
// DELETE (not POST) so register→unregister→reregister is idempotent-safe:
// re-POST after DELETE re-creates via the same dup-blocked create path.
router.delete('/:id/register', async (req: AuthRequest, res: Response) => {
  try {
    const [user, hackathon] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      prisma.hackathon.findUnique({ where: { id: req.params.id as string }, select: { id: true, collegeId: true } }),
    ])
    const roleErr = unregisterRoleError(user?.role)
    if (!user || roleErr) {
      res.status(403).json({ error: roleErr || 'Only students can unregister' })
      return
    }
    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(user as any, (hackathon as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const existing = await prisma.hackathonRegistration.findUnique({
      where: { hackathonId_userId: { hackathonId: req.params.id as string, userId: req.userId! } },
    })
    if (!existing) {
      res.status(404).json({ error: 'Not registered' })
      return
    }
    await prisma.hackathonRegistration.delete({ where: { id: existing.id } })
    try { broadcastHackathonMutation({ hackathonId: req.params.id as string, action: 'unregistered' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'Unregister hackathon error:')
    res.status(500).json({ error: 'Failed to unregister' })
  }
})

// Remind registered users only — teacher/admin of college (body { message }) (#5 leftovers).
// Reuses notificationService.notifyUsers scoped to registration userIds (never whole college).
router.post('/:id/remind', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    const roleErr = remindRoleError(user?.role)
    if (!user || roleErr) {
      res.status(403).json({ error: roleErr || 'Only teachers or admins can send reminders' })
      return
    }
    const hackathon = await prisma.hackathon.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, title: true, collegeId: true },
    })
    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(user as any, (hackathon as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const parsed = validateRemindMessage(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: (parsed as { ok: false; error: string }).error })
      return
    }
    const regs = await prisma.hackathonRegistration.findMany({
      where: { hackathonId: req.params.id as string },
      select: { userId: true },
    })
    const userIds = registeredUserIds(regs as Array<{ userId?: unknown }>)
    if (userIds.length === 0) {
      res.json({ notified: 0, message: 'No registered users to remind' })
      return
    }
    const payload = buildRemindNotification('hackathon', hackathon.title, (parsed as { ok: true; message: string }).message, hackathon.id)
    await notifyUsers(userIds, payload)
    logger.info(`[AUDIT] hackathon:remind actor=${user.id} role=${user.role} target=${hackathon.id} notified=${userIds.length}`)
    res.json({ notified: userIds.length })
  } catch (error) {
    logger.error({ err: error }, 'Remind hackathon error:')
    res.status(500).json({ error: 'Failed to send reminders' })
  }
})

// Update registration (mark as selected for next round) - Student self-reports (F14: IDOR guard)
router.put('/:id/registrations/:regId/round', async (req: AuthRequest, res: Response) => {
  try {
    const registration = await prisma.hackathonRegistration.findUnique({
      where: { id: req.params.regId as string },
    })

    if (!registration) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }

    // F14: registration must belong to the URL hackathon — prevents cross-hackathon IDOR writes.
    if (registration.hackathonId !== (req.params.id as string)) {
      res.status(400).json({ error: 'Registration does not belong to this hackathon' })
      return
    }

    // Only the registered student can update their own status
    if (registration.userId !== req.userId) {
      res.status(403).json({ error: 'Can only update your own registration' })
      return
    }

    const { round, status } = req.body

    // Check if this is the last round
    const hackathon = await prisma.hackathon.findUnique({
      where: { id: req.params.id as string },
      include: { rounds: { orderBy: { roundNumber: 'desc' } } },
    })

    const isLastRound = hackathon?.rounds && hackathon.rounds.length > 0 && round >= hackathon.rounds[0].roundNumber

    const updated = await prisma.hackathonRegistration.update({
      where: { id: req.params.regId as string },
      data: {
        currentRound: round,
        status: isLastRound ? 'COMPLETED' : (status || 'SELECTED'),
      },
    })

    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update round' })
  }
})

// Submit win position and review after completing final round (F14: IDOR guard)
router.put('/:id/registrations/:regId/result', async (req: AuthRequest, res: Response) => {
  try {
    const registration = await prisma.hackathonRegistration.findUnique({
      where: { id: req.params.regId as string },
    })

    if (!registration) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }

    if (registration.hackathonId !== (req.params.id as string)) {
      res.status(400).json({ error: 'Registration does not belong to this hackathon' })
      return
    }

    if (registration.userId !== req.userId) {
      res.status(403).json({ error: 'Can only update your own registration' })
      return
    }

    const { winPosition, review } = req.body

    const updated = await prisma.hackathonRegistration.update({
      where: { id: req.params.regId as string },
      data: {
        winPosition: winPosition || null,
        review: review || null,
        status: 'COMPLETED',
      },
    })

    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit result' })
  }
})

// Add round to hackathon (Teacher) — F03: load hack + tenant gate + owner check
router.post('/:id/rounds', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can add rounds' })
      return
    }

    const hackathon = await prisma.hackathon.findUnique({ where: { id: req.params.id as string }, select: { id: true, collegeId: true, creatorId: true } })
    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(user as any, (hackathon as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    // TEACHER may only mutate hackathons they created; COLLEGE_ADMIN same-college; SUPER_ADMIN global.
    if (user.role === 'TEACHER' && hackathon.creatorId !== user.id) {
      res.status(403).json({ error: 'Can only add rounds to your own hackathons' })
      return
    }

    const { roundNumber, title, description, date, resultDate } = req.body

    const round = await prisma.hackathonRound.create({
      data: {
        hackathonId: req.params.id as string,
        roundNumber: parseInt(roundNumber),
        title,
        description,
        date: date ? new Date(date) : null,
        resultDate: resultDate ? new Date(resultDate) : null,
      },
    })

    try { broadcastHackathonMutation({ hackathonId: req.params.id as string, action: 'round:created', roundId: round.id }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.status(201).json(round)
  } catch (error) {
    res.status(500).json({ error: 'Failed to add round' })
  }
})

// Edit a round (Teacher) — F03: tenant + owner + hackathonId===:id
router.put('/:id/rounds/:roundId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can edit rounds' })
      return
    }

    const round = await prisma.hackathonRound.findUnique({ where: { id: req.params.roundId as string } })
    if (!round) {
      res.status(404).json({ error: 'Round not found' })
      return
    }

    if (round.hackathonId !== req.params.id as string) {
      res.status(400).json({ error: 'Round does not belong to this hackathon' })
      return
    }

    const parent = await prisma.hackathon.findUnique({ where: { id: req.params.id as string }, select: { id: true, collegeId: true, creatorId: true } })
    if (!parent) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(user as any, (parent as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (user.role === 'TEACHER' && parent.creatorId !== user.id) {
      res.status(403).json({ error: 'Can only edit rounds of your own hackathons' })
      return
    }

    const { title, description, date, resultDate } = req.body

    const updated = await prisma.hackathonRound.update({
      where: { id: req.params.roundId as string },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(date !== undefined && { date: date ? new Date(date) : null }),
        ...(resultDate !== undefined && { resultDate: resultDate ? new Date(resultDate) : null }),
      },
    })

    try { broadcastHackathonMutation({ hackathonId: req.params.id as string, action: 'round:updated', roundId: updated.id }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Edit round error:')
    res.status(500).json({ error: 'Failed to edit round' })
  }
})

// Delete a round (Teacher) — F03: tenant + owner + hackathonId===:id
router.delete('/:id/rounds/:roundId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can delete rounds' })
      return
    }

    const round = await prisma.hackathonRound.findUnique({ where: { id: req.params.roundId as string } })
    if (!round) {
      res.status(404).json({ error: 'Round not found' })
      return
    }

    if (round.hackathonId !== req.params.id as string) {
      res.status(400).json({ error: 'Round does not belong to this hackathon' })
      return
    }

    const parent = await prisma.hackathon.findUnique({ where: { id: req.params.id as string }, select: { id: true, collegeId: true, creatorId: true } })
    if (!parent) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(user as any, (parent as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (user.role === 'TEACHER' && parent.creatorId !== user.id) {
      res.status(403).json({ error: 'Can only delete rounds of your own hackathons' })
      return
    }

    await prisma.hackathonRound.delete({ where: { id: req.params.roundId as string } })
    try { broadcastHackathonMutation({ hackathonId: req.params.id as string, action: 'round:deleted', roundId: req.params.roundId as string }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: 'Round deleted' })
  } catch (error) {
    logger.error({ err: error }, 'Delete round error:')
    res.status(500).json({ error: 'Failed to delete round' })
  }
})

// Teacher updates registration status (advance to next round or eliminate) — F03: tenant + owner
router.put('/:id/registrations/:regId/status', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: user + registration + parent independent (all keyed by params) → Promise.all (was 3 sequential).
    const [user, registration, parent] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }), // NARROW-READ half1
      prisma.hackathonRegistration.findUnique({ where: { id: req.params.regId as string } }),
      prisma.hackathon.findUnique({ where: { id: req.params.id as string }, select: { id: true, collegeId: true, creatorId: true } }),
    ])
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can update registration status' })
      return
    }

    if (!registration) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }

    if (registration.hackathonId !== req.params.id as string) {
      res.status(400).json({ error: 'Registration does not belong to this hackathon' })
      return
    }

    if (!parent) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(user as any, (parent as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (user.role === 'TEACHER' && parent.creatorId !== user.id) {
      res.status(403).json({ error: 'Can only manage registrations of your own hackathons' })
      return
    }

    const { currentRound, status } = req.body

    if (!['ACTIVE', 'ELIMINATED'].includes(status)) {
      res.status(400).json({ error: 'Status must be ACTIVE or ELIMINATED' })
      return
    }

    const updated = await prisma.hackathonRegistration.update({
      where: { id: req.params.regId as string },
      data: {
        currentRound,
        status,
      },
    })

    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Update registration status error:')
    res.status(500).json({ error: 'Failed to update registration status' })
  }
})

// Export hackathon to Excel (single hackathon) — F02: tenant + role gate + safe filename
router.get('/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const requester = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    if (!requester) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (requester.role !== 'TEACHER' && requester.role !== 'COLLEGE_ADMIN' && requester.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Export requires teacher or admin role' })
      return
    }
    const hackathon = await prisma.hackathon.findUnique({
      where: { id: req.params.id as string },
      include: {
        registrations: {
          include: {
            user: { select: { name: true, email: true, department: true, studentId: true } },
            // Order 10: read-new (child rows) with blob fallback below. Retry
            // without the include when the table predates migration.
            teamRows: true,
          },
        },
        rounds: { orderBy: { roundNumber: 'asc' } },
      },
    }).catch(async () => prisma.hackathon.findUnique({
      where: { id: req.params.id as string },
      include: {
        registrations: {
          include: { user: { select: { name: true, email: true, department: true, studentId: true } } },
        },
        rounds: { orderBy: { roundNumber: 'asc' } },
      },
    }))

    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }

    // Tenant isolation before building the workbook (bulk PII exfil guard).
    if (!canAccessCollege(requester as any, (hackathon as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    // TEACHER may only export hackathons they created; admins same-college/global.
    if (requester.role === 'TEACHER' && (hackathon as any).creatorId !== requester.id) {
      res.status(403).json({ error: 'Can only export your own hackathons' })
      return
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'CampusFlow'
    workbook.created = new Date()

    // Sheet 1: All Registrations
    const regSheet = workbook.addWorksheet('Registrations')
    regSheet.columns = [
      { header: 'S.No', key: 'sno', width: 8 },
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Student ID', key: 'studentId', width: 15 },
      { header: 'Team Name', key: 'teamName', width: 20 },
      { header: 'Team Members', key: 'teamMembers', width: 30 },
      { header: 'Project Idea', key: 'projectIdea', width: 30 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Current Round', key: 'currentRound', width: 15 },
      { header: 'Win Position', key: 'winPosition', width: 15 },
      { header: 'Review', key: 'review', width: 40 },
      { header: 'Registered At', key: 'createdAt', width: 20 },
    ]

    hackathon.registrations.forEach((reg, idx) => {
      regSheet.addRow({
        sno: idx + 1,
        name: escapeExcelValue(reg.user.name),
        email: escapeExcelValue(reg.user.email),
        department: escapeExcelValue(reg.user.department || ''),
        studentId: escapeExcelValue(reg.user.studentId || ''),
        teamName: escapeExcelValue(reg.teamName || ''),
        // Order 10: child rows win when present, else the legacy blob.
        teamMembers: escapeExcelValue(resolveTeamMembersDisplay(reg as any) || ''),
        projectIdea: escapeExcelValue(reg.projectIdea || ''),
        status: escapeExcelValue(reg.status),
        currentRound: reg.currentRound,
        winPosition: escapeExcelValue(reg.winPosition || ''),
        review: escapeExcelValue(reg.review || ''),
        createdAt: reg.createdAt.toLocaleDateString(),
      })
    })

    // Sheet per round
    for (const round of hackathon.rounds) {
      const roundSheet = workbook.addWorksheet(`Round ${round.roundNumber} - ${round.title}`)
      roundSheet.columns = [
        { header: 'S.No', key: 'sno', width: 8 },
        { header: 'Roll No', key: 'rollNo', width: 15 },
        { header: 'Student Name', key: 'name', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Team Name', key: 'teamName', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
      ]

      const selectedInRound = hackathon.registrations.filter(r => r.currentRound >= round.roundNumber)
      selectedInRound.forEach((reg, idx) => {
        roundSheet.addRow({
          sno: idx + 1,
          rollNo: escapeExcelValue(reg.user.studentId || ''),
          name: escapeExcelValue(reg.user.name),
          email: escapeExcelValue(reg.user.email),
          teamName: escapeExcelValue(reg.teamName || ''),
          status: escapeExcelValue(reg.status),
        })
      })
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    // F17: sanitize filename (strip CR/LF/quotes) + RFC5987 filename* for unicode titles.
    res.setHeader('Content-Disposition', contentDisposition(`${safeFilename(hackathon.title, 'hackathon')}.xlsx`))
    
    try {
      const buffer = await workbook.xlsx.writeBuffer()
      const nodeBuf = Buffer.from(buffer as any)
      res.send(nodeBuf)
    } catch (bufErr) {
      logger.error({ err: bufErr }, 'Export single buffer error:')
      throw bufErr
    }
  } catch (error: any) {
    logger.error({ err: error?.message }, 'Export hackathon error:', error?.stack)
    res.status(500).json({ error: 'Failed to export', detail: error?.message })
  }
})

// Delete hackathon (Teacher who created it)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const hackathon = await prisma.hackathon.findUnique({ where: { id: req.params.id as string } })
    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }

    if (hackathon.creatorId !== req.userId) {
      res.status(403).json({ error: 'Can only delete your own hackathons' })
      return
    }

    await prisma.hackathon.delete({ where: { id: req.params.id as string } })
    try { broadcastHackathonMutation({ hackathonId: req.params.id as string, action: 'deleted' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: 'Hackathon deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete hackathon' })
  }
})

// PUT /staging/:id - Edit staging hackathon (F04: tenant gate + global policy + audit)
router.put('/staging/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: user + existing independent → Promise.all (was sequential).
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }), // NARROW-READ half1
      prisma.hackathonStaging.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    if (!existing) {
      res.status(404).json({ error: 'Staging hackathon not found' })
      return
    }
    // Global (collegeId null) staging may only be mutated by SUPER_ADMIN — otherwise
    // any teacher could rewrite platform-wide drafts (null-open x-tenant write).
    if (!(existing as any).collegeId) {
      if (user.role !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Only super admins can edit global staging items' })
        return
      }
    } else if (!canAccessCollege(user as any, (existing as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const { title, description, url, organizer, registrationUrl, startDate, endDate, deadline, teamSize, themes, location, mode, eligibility, prizePool, duration, schedule, bootcamps, highlights, targetDepartments, targetYears, website, discord, participantsCount, inviteOnly } = req.body

    const hackathon = await prisma.hackathonStaging.update({
      where: { id: req.params.id as string },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(url !== undefined && { url }),
        ...(organizer !== undefined && { organizer }),
        ...(registrationUrl !== undefined && { registrationUrl }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
        ...(teamSize !== undefined && { teamSize: teamSize ? parseInt(teamSize) : null }),
        // Order 3: canonical Json arrays (normalize array-or-String input, never throw).
        ...(themes !== undefined && { themes: normalizeThemes(themes as any) as any }),
        ...(location !== undefined && { location }),
        ...(mode !== undefined && { mode }),
        ...(eligibility !== undefined && { eligibility: typeof eligibility === 'string' ? eligibility : JSON.stringify(eligibility) }),
        ...(prizePool !== undefined && { prizePool }),
        ...(duration !== undefined && { duration }),
        ...(schedule !== undefined && { schedule }),
        ...(bootcamps !== undefined && { bootcamps: JSON.stringify(bootcamps) }),
        ...(highlights !== undefined && { highlights: JSON.stringify(highlights) }),
        // Order 3: canonical Json arrays (normalize array-or-String input).
        ...(targetDepartments !== undefined && { targetDepartments: normalizeDepartments(targetDepartments as any) as any }),
        ...(targetYears !== undefined && { targetYears: normalizeYears(targetYears as any) as any }),
        ...(website !== undefined && { website }),
        ...(discord !== undefined && { discord }),
        ...(participantsCount !== undefined && { participantsCount: parseInt(participantsCount) || 0 }),
        ...(inviteOnly !== undefined && { inviteOnly }),
      },
    })
    try { broadcastHackathonMutation({ stagingId: req.params.id as string, action: 'staging:updated' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    logger.info(`[AUDIT] staging:update actor=${user.id} role=${user.role} college=${(user as any).collegeId} target=${req.params.id}`)
    res.json(hackathon)
  } catch (error) {
    logger.error({ err: error }, 'Update staging hackathon error:')
    res.status(500).json({ error: 'Failed to update staging hackathon' })
  }
})

// DELETE /staging/:id - Delete staging hackathon (F04: tenant gate + audit)
router.delete('/staging/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const existing = await prisma.hackathonStaging.findUnique({ where: { id: req.params.id as string } })
    if (!existing) {
      res.status(404).json({ error: 'Staging hackathon not found' })
      return
    }
    if (!(existing as any).collegeId) {
      if (user.role !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Only super admins can delete global staging items' })
        return
      }
    } else if (!canAccessCollege(user as any, (existing as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    await prisma.hackathonStaging.delete({
      where: { id: req.params.id as string },
    })
    try { broadcastHackathonMutation({ stagingId: req.params.id as string, action: 'staging:deleted' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    logger.info(`[AUDIT] staging:delete actor=${user.id} role=${user.role} college=${(user as any).collegeId} target=${req.params.id}`)
    res.json({ message: 'Staging hackathon deleted' })
  } catch (error) {
    logger.error({ err: error }, 'Delete staging hackathon error:')
    res.status(500).json({ error: 'Failed to delete staging hackathon' })
  }
})

// POST /staging/:id/approve - Approve staging hackathon (move to main table)
// Per-college independent (fix: single global status).
// - Global row keeps PENDING/DRAFT; each college's approve creates its OWN
//   published copy (collegeId = decision college) + own APPROVED decision row.
// - A approve never hides the row from B (B still pending = no decision).
// - Idempotent, leak-closed: already-APPROVED returns MY college's copy only
//   (scoped by collegeId + url/title+source, never another college's row).
// - Null-publish fixed: missing target college → 400 (parity with internships).
// - Teacher approve/reject buttons unchanged shape (same req/res envelope).
// F04: tenant gate — cross-college tenant rows denied; global rows decidable
// by any college for its OWN college (super-admin needs explicit target).
router.post('/staging/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const staging = await prisma.hackathonStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!staging) {
      res.status(404).json({ error: 'Staging hackathon not found' })
      return
    }

    // Resolve decision college: tenant row → its college; global row →
    // own college (non-super) or explicit super-admin target (body/query/header).
    const targetCollegeId = resolveDecisionCollegeId(user as any, staging as any, req)
      || deriveCollegeId(user as any, (staging as any).collegeId as string | null | undefined, req)
      || (staging as any).collegeId
      || (user as any).collegeId
      || null
    if (!targetCollegeId) {
      res.status(400).json({ error: 'College ID required for hackathon approval' })
      return
    }
    if (!canDecideForCollege(user as any, (staging as any).collegeId, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (!canAccessDecisionCollege(user as any, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    // Per-college idempotency: already APPROVED by MY college → return MY copy.
    const myDecision = await findDecision(prisma as any, 'hackathonStagingDecision', staging.id, targetCollegeId)
    if (myDecision?.decision === 'APPROVED') {
      const ownWhere = buildOwnPublishedWhere(staging as any, targetCollegeId)
      const existing = await prisma.hackathon.findFirst({ where: ownWhere as never })
      if (existing) {
        res.json({ message: 'Hackathon already approved', hackathon: existing, idempotent: true })
        return
      }
      // Decision says APPROVED but published row gone (deleted) — fall through and re-create.
    } else if (myDecision?.decision === 'REJECTED') {
      // Reconsideration allowed: REJECTED → APPROVED overwrites below.
    } else if ((staging as any).url) {
      // Guard double-approve races for MY college only (never another college's row).
      const ownDup = await prisma.hackathon.findFirst({
        where: { url: (staging as any).url, collegeId: targetCollegeId } as never,
      })
      if (ownDup) {
        await upsertDecision(prisma as any, prisma as any, 'hackathonStagingDecision', {
          stagingId: staging.id,
          collegeId: targetCollegeId,
          decision: 'APPROVED',
          decidedBy: user.id,
        })
        res.json({ message: 'Hackathon already approved', hackathon: ownDup, idempotent: true })
        return
      }
    }

    // Parse rounds from schedule BEFORE the transaction (no DB I/O inside parse).
    let roundsToCreate: { roundNumber: number; title: string; description: string; date: Date | null; resultDate: Date | null }[] = []
    if (staging.schedule) {
      try {
        const parsed = JSON.parse(staging.schedule)
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].roundNumber) {
          roundsToCreate = parsed.map((round: any) => ({
            roundNumber: round.roundNumber,
            title: round.title || `Round ${round.roundNumber}`,
            description: round.description || '',
            date: round.date ? new Date(round.date) : null,
            resultDate: round.resultDate ? new Date(round.resultDate) : null,
          }))
        }
      } catch {
        // schedule is not JSON rounds, ignore
      }
    }

    // Atomic: create published hackathon (+rounds) and mark staging APPROVED together.
    const hackathon = await prisma.$transaction(async (tx) => {
      const created = await tx.hackathon.create({
        data: {
          title: staging.title,
          description: staging.description,
          url: staging.url,
          organizer: staging.organizer,
          registrationUrl: staging.registrationUrl,
          startDate: staging.startDate,
          endDate: staging.endDate,
          deadline: staging.deadline,
          teamSize: staging.teamSize,
          // Order 3: staging→published carries canonical Json arrays directly.
          themes: staging.themes as any,
          location: staging.location,
          mode: staging.mode,
          eligibility: staging.eligibility,
          prizePool: staging.prizePool,
          duration: staging.duration,
          schedule: staging.schedule,
          bootcamps: staging.bootcamps,
          highlights: staging.highlights,
          targetDepartments: staging.targetDepartments as any,
          targetYears: staging.targetYears as any,
          eligibilityEnabled: staging.eligibilityEnabled,
          website: staging.website,
          discord: staging.discord,
          participantsCount: staging.participantsCount,
          inviteOnly: staging.inviteOnly,
          status: 'PUBLISHED',
          source: staging.source,
          creatorId: user.id,
          collegeId: targetCollegeId,
        },
      })

      // HALF1: single createMany (was N+1 sequential creates in loop).
      if (roundsToCreate.length > 0) {
        await tx.hackathonRound.createMany({
          data: roundsToCreate.map((round) => ({
            hackathonId: created.id,
            roundNumber: round.roundNumber,
            title: round.title,
            description: round.description,
            date: round.date,
            resultDate: round.resultDate,
          })),
        })
      }
      if (roundsToCreate.length > 0) {
        logger.info(`[Approve] Created ${roundsToCreate.length} rounds for hackathon ${created.id}`)
      }

      // Per-college: record MY decision; NEVER flip the shared global status
      // (global stays PENDING so other colleges remain pending). Pre-migration
      // (no decisions table) falls back to the legacy global flip inside the
      // same transaction so old deploys keep working.
      try {
        const dm = (tx as any).hackathonStagingDecision
        if (dm?.upsert) {
          await dm.upsert({
            where: { stagingId_collegeId: { stagingId: staging.id, collegeId: targetCollegeId } },
            create: { stagingId: staging.id, collegeId: targetCollegeId, decision: 'APPROVED', decidedBy: user.id },
            update: { decision: 'APPROVED', decidedBy: user.id, decidedAt: new Date() },
          })
        } else {
          await tx.hackathonStaging.update({ where: { id: staging.id }, data: { status: 'APPROVED' } })
        }
      } catch {
        try {
          await tx.hackathonStaging.update({ where: { id: staging.id }, data: { status: 'APPROVED' } })
        } catch {}
      }
      return created
    })

    // Notify students of the college about the new hackathon (fire-and-forget) — uses target college, not superadmin null
    try {
      const notifyCollegeId = (hackathon as any).collegeId || deriveCollegeId(user as any, null, req) || user.collegeId
      if (notifyCollegeId) {
        const students = await prisma.user.findMany({
          where: { role: 'STUDENT', collegeId: notifyCollegeId },
          select: { id: true },
        })
        const studentIds = students.map((s: any) => s.id)
        if (studentIds.length > 0) {
          await notifyUsers(studentIds, {
            title: 'New Hackathon Available',
            message: `A new hackathon has been approved: ${hackathon.title}`,
            type: 'HACKATHON',
            source: hackathon.id,
          })
        }
      }
    } catch (err) {
      logger.error({ err: err }, 'Hackathon approval notification error:')
    }

    try { broadcastHackathonMutation({ hackathonId: hackathon.id, stagingId: req.params.id as string, action: 'approved' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    logger.info(`[AUDIT] staging:approve actor=${user.id} role=${user.role} college=${(user as any).collegeId} decisionCollege=${targetCollegeId} target=${req.params.id} published=${hackathon.id}`)
    res.json({ message: 'Hackathon approved and published', hackathon })
  } catch (error) {
    logger.error({ err: error }, 'Approve staging hackathon error:')
    res.status(500).json({ error: 'Failed to approve staging hackathon' })
  }
})

// POST /staging/:id/reject - Reject staging hackathon (F04: tenant gate + audit)
// Per-college independent: records MY college's REJECTED decision only; other
// colleges unaffected (still pending). Global status untouched. Already
// APPROVED by my college → 409 (reject-after-publish would orphan the
// published copy); already REJECTED → idempotent 200.
router.post('/staging/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const staging = await prisma.hackathonStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!staging) {
      res.status(404).json({ error: 'Staging hackathon not found' })
      return
    }

    const targetCollegeId = resolveDecisionCollegeId(user as any, staging as any, req)
      || deriveCollegeId(user as any, (staging as any).collegeId as string | null | undefined, req)
      || (staging as any).collegeId
      || (user as any).collegeId
      || null
    if (!targetCollegeId) {
      res.status(400).json({ error: 'College ID required for hackathon rejection' })
      return
    }
    if (!canDecideForCollege(user as any, (staging as any).collegeId, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (!canAccessDecisionCollege(user as any, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const myDecision = await findDecision(prisma as any, 'hackathonStagingDecision', staging.id, targetCollegeId)
    if (myDecision?.decision === 'REJECTED') {
      res.json({ message: 'Hackathon already rejected', idempotent: true })
      return
    }
    if (myDecision?.decision === 'APPROVED') {
      res.status(409).json({ error: 'Already approved by your college' })
      return
    }

    const saved = await upsertDecision(prisma as any, prisma as any, 'hackathonStagingDecision', {
      stagingId: staging.id,
      collegeId: targetCollegeId,
      decision: 'REJECTED',
      decidedBy: user.id,
    })
    if (!saved) {
      // Pre-migration fallback: legacy global flip (old behavior).
      await prisma.hackathonStaging.update({
        where: { id: req.params.id as string },
        data: { status: 'REJECTED' },
      })
    }

    try { broadcastHackathonMutation({ stagingId: req.params.id as string, action: 'rejected' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    logger.info(`[AUDIT] staging:reject actor=${user.id} role=${user.role} college=${(user as any).collegeId} decisionCollege=${targetCollegeId} target=${req.params.id}`)
    res.json({ message: 'Hackathon rejected' })
  } catch (error) {
    logger.error({ err: error }, 'Reject staging hackathon error:')
    res.status(500).json({ error: 'Failed to reject staging hackathon' })
  }
})

// POST /fetch-external - Trigger auto-fetch of hackathons from external sources - SUPER_ADMIN + rate limited
router.post('/fetch-external', fetchLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' })
      return
    }

    const { fetchFromAllSources, enrichHackathonStaging } = await import('../services/opportunityAgent')
    const allOpps = await fetchFromAllSources()
    const hackathons = allOpps.filter(o => o.type === 'HACKATHON')

    let fetched = 0
    let skipped = 0
    const idsToEnrich: string[] = []

    for (const opp of hackathons) {
      if (!opp.url || !opp.title) { skipped++; continue }
      // Order 2 V-24 NULL-safe: normalize missing/blank → 'MANUAL' (matches DB NOT NULL + GLOBAL unique).
      const oppSource = normalizeSource((opp as { source?: unknown }).source)
      try {
        const existing = await prisma.hackathonStaging.findFirst({
          where: { title: opp.title, source: oppSource },
        })
        if (existing) { skipped++; continue }

        const created = await prisma.hackathonStaging.create({
          data: {
            title: opp.title,
            description: opp.description || null,
            url: opp.url,
            organizer: opp.organizer || null,
            deadline: opp.deadline ? new Date(opp.deadline) : null,
            startDate: opp.startDate ? new Date(opp.startDate) : null,
            duration: opp.duration || null,
            location: opp.location || null,
            mode: opp.mode || null,
            prizePool: opp.prizePool || null,
            themes: (Array.isArray(opp.themes) ? opp.themes : []) as any,
            website: opp.website || null,
            discord: opp.discord || null,
            participantsCount: opp.participantsCount || 0,
            inviteOnly: opp.inviteOnly || false,
            status: 'DRAFT',
            source: oppSource,
            creatorId: user.id,
            collegeId: user.collegeId || null,
          },
        })
        fetched++
        idsToEnrich.push(created.id)
      } catch (err) {
        logger.error({ err: err }, `Error storing hackathon staging "${opp.title}":`)
        skipped++
      }
    }

    logger.info(`[Fetch] ${fetched} hackathons created — enriching in background`)

    // Enrich in background (don't block the response)
    const ENRICH_DELAY_MS = 12000
    ;(async () => {
      for (let i = 0; i < idsToEnrich.length; i++) {
        logger.info(`[Fetch] Enriching hackathon ${i + 1}/${idsToEnrich.length}`)
        await enrichHackathonStaging(idsToEnrich[i]).catch(() => {})
        if (i < idsToEnrich.length - 1) {
          await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
        }
      }
      logger.info(`[Fetch] Done — enriched ${idsToEnrich.length} hackathons`)
    })()

    try { broadcastHackathonMutation({ action: 'fetched', fetched, total: hackathons.length }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: `Hackathon fetch complete`, fetched, skipped, total: hackathons.length })
  } catch (error) {
    logger.error({ err: error }, 'Fetch external hackathons error:')
    res.status(500).json({ error: 'Failed to fetch external hackathons' })
  }
})

// POST /staging/:id/assign - Assign staging hackathon to teacher
router.post('/staging/:id/assign', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const { teacherId } = req.body
    if (!teacherId) {
      res.status(400).json({ error: 'teacherId is required' })
      return
    }

    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { id: true, role: true, collegeId: true, name: true } }) // NARROW-READ half1
    if (!teacher || teacher.role !== 'TEACHER') {
      res.status(400).json({ error: 'Invalid teacher' })
      return
    }

    const staging = await prisma.hackathonStaging.findUnique({ where: { id: req.params.id as string } })
    if (!staging) {
      res.status(404).json({ error: 'Staging hackathon not found' })
      return
    }

    // F04 hardening: COLLEGE_ADMIN scoped to own college for both staging row and target teacher.
    if (user.role === 'COLLEGE_ADMIN') {
      if ((staging as any).collegeId && (staging as any).collegeId !== user.collegeId) {
        res.status(403).json({ error: 'Access denied: different college' })
        return
      }
      if ((teacher as any).collegeId !== user.collegeId) {
        res.status(403).json({ error: 'Can only assign teachers of your college' })
        return
      }
    }

    const updated = await prisma.hackathonStaging.update({
      where: { id: req.params.id as string },
      data: { creatorId: teacherId },
    })

    try { broadcastHackathonMutation({ stagingId: req.params.id as string, action: 'staging:assigned', teacherId }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: `Assigned to ${teacher.name}`, staging: updated })
  } catch (error) {
    logger.error({ err: error }, 'Assign hackathon staging error:')
    res.status(500).json({ error: 'Failed to assign' })
  }
})

// POST /staging/assign-all - Assign ALL pending hackathons to teacher
router.post('/staging/assign-all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const { teacherId } = req.body
    if (!teacherId) {
      res.status(400).json({ error: 'teacherId is required' })
      return
    }

    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { id: true, role: true, collegeId: true, name: true } }) // NARROW-READ half1
    if (!teacher || teacher.role !== 'TEACHER') {
      res.status(400).json({ error: 'Invalid teacher' })
      return
    }

    // F04 hardening: COLLEGE_ADMIN bulk-assign scoped to own college only.
    const bulkWhere: any = { status: 'DRAFT' }
    if (user.role === 'COLLEGE_ADMIN') {
      if ((teacher as any).collegeId !== user.collegeId) {
        res.status(403).json({ error: 'Can only assign teachers of your college' })
        return
      }
      bulkWhere.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    }

    const result = await prisma.hackathonStaging.updateMany({
      where: bulkWhere,
      data: { creatorId: teacherId },
    })

    try { broadcastHackathonMutation({ action: 'staging:bulk-assigned', teacherId, count: result.count }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ assigned: result.count, teacher: teacher.name })
  } catch (error) {
    logger.error({ err: error }, 'Assign all hackathon staging error:')
    res.status(500).json({ error: 'Failed to assign all' })
  }
})

// POST /staging/re-enrich - Re-enrich all unenriched hackathon staging records
// Per-college note: skips only GLOBAL REJECTED (status != REJECTED). A single
// college's REJECTED decision (HackathonStagingDecision) never blocks enrich
// for other colleges — the shared row stays enrichable until globally rejected.
router.post('/staging/re-enrich', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' })
      return
    }

    const { enrichHackathonStaging } = await import('../services/opportunityAgent')

    // Find staging records with no targetDepartments OR no deadline (not fully enriched)
    // Order 3: targetDepartments is canonical Json — explicit equals (was String '[]').
    const unenriched = await prisma.hackathonStaging.findMany({
      where: {
        status: { not: 'REJECTED' },
        OR: [
          { targetDepartments: { equals: [] } },
          { deadline: null },
        ],
      },
    })

    if (unenriched.length === 0) {
      res.json({ message: 'All hackathons already enriched', enriched: 0 })
      return
    }

    logger.info(`[Re-enrich] Found ${unenriched.length} unenriched hackathons — enriching in background`)

    // Enrich in background (don't block the response)
    const ENRICH_DELAY_MS = 12000
    ;(async () => {
      for (let i = 0; i < unenriched.length; i++) {
        logger.info(`[Re-enrich] Enriching hackathon ${i + 1}/${unenriched.length}`)
        await enrichHackathonStaging(unenriched[i].id).catch(() => {})
        if (i < unenriched.length - 1) {
          await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
        }
      }
      logger.info(`[Re-enrich] Done — enriched ${unenriched.length} hackathons`)
    })()

    res.json({ message: `Enrichment started in background`, total: unenriched.length })
  } catch (error) {
    logger.error({ err: error }, 'Re-enrich hackathons error:')
    res.status(500).json({ error: 'Failed to re-enrich' })
  }
})

export default router
