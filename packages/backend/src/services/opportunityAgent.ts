import prisma from '../config/db'
import { config } from '../config'
import { searchDetails, parseSearchDate } from '../utils/search'
import Groq from 'groq-sdk'
import OpenAI from 'openai'

// AI provider setup: OpenCode Serve only (Zen and Groq disabled for testing)
const hasOpenCodeServe = config.openCodeServeUrl !== ''

const openCodeServe = hasOpenCodeServe ? new OpenAI({
  apiKey: 'no-key',
  baseURL: config.openCodeServeUrl,
}) : null

export interface NormalizedOpportunity {
  type: string
  title: string
  description: string
  url: string
  source: string
  organizer: string
  deadline: string
  startDate: string
  duration: string
  location: string
  mode: string
  prizePool: string
  stipend: string
  company: string
  role: string
  // Extended fields from structured sources
  themes: string[]
  website: string
  discord: string
  participantsCount: number
  inviteOnly: boolean
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function isEnded(deadlineStr: string): boolean {
  if (!deadlineStr) return false
  try {
    const d = new Date(deadlineStr)
    if (isNaN(d.getTime())) return false
    return d.getTime() < Date.now()
  } catch {
    return false
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Devfolio: Next.js __NEXT_DATA__ ──────────────────────────────
async function fetchDevfolioPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  try {
    const url = page === 1 ? 'https://devfolio.co/hackathons' : `https://devfolio.co/hackathons?page=${page}`
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) return []
    const html = await response.text()

    // Extract __NEXT_DATA__ which contains the hackathon data
    const nextDataMatch = html.match(/__NEXT_DATA__[^{]*({[\s\S]*?})\s*<\/script>/)
    if (!nextDataMatch) return []

    // Parse JSON from the match
    let jsonStr = nextDataMatch[1]
    let data: any
    try {
      data = JSON.parse(jsonStr)
    } catch {
      let depth = 0
      let start = jsonStr.indexOf('{')
      for (let i = start; i < jsonStr.length; i++) {
        if (jsonStr[i] === '{') depth++
        if (jsonStr[i] === '}') {
          depth--
          if (depth === 0) { jsonStr = jsonStr.substring(start, i + 1); break }
        }
      }
      data = JSON.parse(jsonStr)
    }

    const state = data.props?.pageProps?.dehydratedState
    if (!state?.queries) return []

    const opportunities: NormalizedOpportunity[] = []

    for (const query of state.queries) {
      const hackathons = query.state?.data?.open_hackathons
        || query.state?.data?.hackathons
        || (Array.isArray(query.state?.data) ? query.state.data : [])

      for (const h of hackathons) {
        if (!h.name) continue
        if (seen.has(h.name)) continue
        seen.add(h.name)

        const title = h.name
        const slug = h.slug
        const hackUrl = `https://${slug}.devfolio.co/`

        // Dates
        const startDate = h.starts_at ? h.starts_at.split('T')[0] : ''
        const regDeadline = h.settings?.reg_ends_at
          ? h.settings.reg_ends_at.split('T')[0]
          : ''
        const deadline = regDeadline || (h.ends_at ? h.ends_at.split('T')[0] : '')

        // Mode
        let mode = 'ONLINE'
        if (h.is_online === false) mode = 'OFFLINE'
        else if (h.is_online === true) mode = 'ONLINE'

        const location = mode === 'OFFLINE' ? '' : 'Online'
        if (mode === 'OFFLINE' && (!location || location.trim() === '')) {
          mode = 'ONLINE'
        }

        // Themes
        const themes = (h.themes || []).map((t: any) => t.theme?.name).filter(Boolean)

        // Extended fields
        const website = h.settings?.site || ''
        const discord = h.settings?.discord || ''
        const participantsCount = h.participants_count || 0

        opportunities.push({
          type: 'HACKATHON',
          title,
          description: h.tagline || '',
          url: hackUrl,
          source: 'DEVFOLIO',
          organizer: '',
          deadline,
          startDate,
          duration: '',
          location,
          mode,
          prizePool: '',
          stipend: '',
          company: '',
          role: '',
          themes,
          website,
          discord,
          participantsCount,
          inviteOnly: false,
        })
      }
    }
    return opportunities
  } catch {
    return []
  }
}

async function fetchDevfolio(): Promise<NormalizedOpportunity[]> {
  const seen = new Set<string>()
  const all: NormalizedOpportunity[] = []
  for (let page = 1; page <= 5; page++) {
    const results = await fetchDevfolioPage(page, seen)
    all.push(...results)
    if (results.length === 0) break // no more pages
  }
  console.log(`[Devfolio] Fetched ${all.length} hackathons across pages`)
  return all
}

function fetchDevfolioFromHTML(html: string): NormalizedOpportunity[] {
  const opportunities: NormalizedOpportunity[] = []
  const cardRegex = /href="(https:\/\/[^"]*\.devfolio\.co\/?)"[^>]*>([\s\S]*?)<\/a>/g
  let match
  while ((match = cardRegex.exec(html)) !== null && opportunities.length < 20) {
    const section = match[2]
    const titleMatch = section.match(/<h3[^>]*>([^<]+)<\/h3>/)
    if (!titleMatch) continue
    const title = titleMatch[1].trim()
    const url = match[1]
    const onlineMatch = section.match(/Online/i)
    const offlineMatch = section.match(/Offline/i)
    opportunities.push({
      type: 'HACKATHON',
      title,
      description: '',
      url,
      source: 'DEVFOLIO',
      organizer: '',
      deadline: '',
      startDate: '',
      duration: '',
      location: '',
      mode: onlineMatch ? 'ONLINE' : offlineMatch ? 'OFFLINE' : 'ONLINE',
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
  return opportunities
}

// ─── Internshala: JSON-LD ItemList + detail page JSON-LD ───────────
async function fetchInternshalaPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch(`https://internshala.com/internships/page-${page}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) return []
    const html = await response.text()

    const opportunities: NormalizedOpportunity[] = []
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    let match

    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1])
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          for (const item of data.itemListElement) {
            const name = item.name || ''
            const itemUrl = item.url || ''

            if (seen.has(name)) continue
            seen.add(name)

            const parts = name.split(' - ')
            const role = parts[0]?.trim() || name
            const company = itemUrl.includes('/at-')
              ? itemUrl.split('/at-')[1]?.replace(/\d+$/, '')?.replace(/-/g, ' ') || 'Unknown'
              : 'Unknown'

            opportunities.push({
              type: 'INTERNSHIP',
              title: name,
              description: `Internship opportunity at ${company}`,
              url: itemUrl,
              source: 'INTERNSHALA',
              organizer: company,
              deadline: '',
              startDate: '',
              duration: '',
              location: '',
              mode: 'REMOTE',
              prizePool: '',
              stipend: '',
              company,
              role,
              themes: [],
              website: '',
              discord: '',
              participantsCount: 0,
              inviteOnly: false,
            })
          }
        }
      } catch { /* skip malformed JSON */ }
    }
    return opportunities
  } catch {
    return []
  }
}

async function fetchInternshala(): Promise<NormalizedOpportunity[]> {
  const seen = new Set<string>()
  const all: NormalizedOpportunity[] = []

  // Fetch listing pages
  for (let page = 1; page <= 5; page++) {
    const results = await fetchInternshalaPage(page, seen)
    all.push(...results)
    if (results.length === 0) break
  }

  // Enrich with detail pages (fetch in batches of 5 to avoid overwhelming)
  const toEnrich = all.slice(0, 50) // Enrich up to 50 entries
  for (let i = 0; i < toEnrich.length; i += 5) {
    const batch = toEnrich.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(opp => fetchInternshalaDetail(opp.url))
    )
    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'fulfilled' && result.value) {
        const details = result.value
        toEnrich[i + j].deadline = details.deadline || ''
        toEnrich[i + j].startDate = details.startDate || ''
        toEnrich[i + j].duration = details.duration || ''
        toEnrich[i + j].location = details.location || ''
        toEnrich[i + j].stipend = details.stipend || ''
        if (details.mode) toEnrich[i + j].mode = details.mode
      }
    }
  }

  console.log(`[Internshala] Fetched ${all.length} internships across pages`)
  return all
}

async function fetchInternshalaDetail(url: string, retries = 2): Promise<{
  deadline: string; startDate: string; duration: string; location: string; stipend: string; mode: string
} | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      })
    if (!res.ok) return null
    const html = await res.text()

    // Extract JSON-LD JobPosting
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    let match
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1])
        if (data['@type'] === 'JobPosting') {
          const deadline = data.validThrough || '' // "2026-09-05 23:59:59"
          const startDate = data.datePosted || '' // "2026-08-06"
          const stipend = data.baseSalary
            ? `${data.baseSalary.value?.minValue || ''}-${data.baseSalary.value?.maxValue || ''} ${data.baseSalary.value?.unitText || ''}`
            : ''
          const location = data.jobLocation?.[0]?.address
            ? `${data.jobLocation[0].address.addressLocality || ''}, ${data.jobLocation[0].address.addressRegion || ''}`
            : ''
          const duration = html.match(/(\d+)\s*months?/i)?.[0] || ''

          // Determine mode from employment type or location
          let mode = 'REMOTE'
          if (html.includes('Work From Home') || html.includes('work from home')) mode = 'REMOTE'
          else if (location) mode = 'OFFLINE'

          return { deadline, startDate, duration, location, stipend, mode }
        }
      } catch { /* skip */ }
    }

    // Fallback: extract dates from HTML patterns
    const deadlineMatch = html.match(/APPLY BY[^<]*?(\w+ \d{1,2},?\s*\d{4})/i)
    const startDateMatch = html.match(/Start Date[^<]*?(\w+ \d{1,2},?\s*\d{4})/i)

    return {
      deadline: deadlineMatch?.[1] || '',
      startDate: startDateMatch?.[1] || '',
      duration: html.match(/(\d+)\s*months?/i)?.[0] || '',
      location: '',
      stipend: html.match(/₹\s*[\d,]+(?:\s*-\s*₹?\s*[\d,]+)?/)?.[0] || '',
      mode: html.includes('Work From Home') ? 'REMOTE' : 'OFFLINE',
    }
  } catch {
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    return null
  }
  }
  return null
}

// ─── Devpost: JSON API ────────────────────────────────────────────
async function fetchDevpostPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch(`https://devpost.com/api/hackathons?page=${page}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) return []
    const data = await response.json() as any

    const opportunities: NormalizedOpportunity[] = []
    for (const h of (data.hackathons || [])) {
      const title = h.title?.trim() || ''
      if (!title || seen.has(title)) continue
      seen.add(title)

      // Parse submission period dates for deadline and start
      let deadline = ''
      let startDate = ''
      if (h.submission_period_dates) {
        const parts = h.submission_period_dates.split(' - ')
        if (parts.length === 2) {
          startDate = parseDevpostDate(parts[0].trim()) || ''
          deadline = parseDevpostDate(parts[1].trim()) || ''
        }
      }

      // Extract prize amount (strip HTML tags)
      const prizeRaw = h.prize_amount || ''
      const prizePool = prizeRaw.replace(/<[^>]+>/g, '').trim()

      // Themes
      const themes = (h.themes || []).map((t: any) => t.name).filter(Boolean)

      // Mode
      const loc = h.displayed_location?.location || ''
      let mode = 'ONLINE'
      if (loc.toLowerCase().includes('online')) mode = 'ONLINE'
      else if (loc) mode = 'HYBRID'

      opportunities.push({
        type: 'HACKATHON',
        title,
        description: h.tagline || '',
        url: h.url || '',
        source: 'DEVPOST',
        organizer: h.organizer_name || '',
        deadline,
        startDate,
        duration: h.time_left_to_submission || '',
        location: loc,
        mode,
        prizePool,
        stipend: '',
        company: h.organizer_name || '',
        role: '',
        themes,
        website: '',
        discord: '',
        participantsCount: h.registrations_count || 0,
        inviteOnly: h.invite_only || false,
      })
    }
    return opportunities
  } catch {
    return []
  }
}

function parseDevpostDate(dateStr: string): string {
  // "May 19" or "Aug 17, 2026" or "Aug 17"
  try {
    // If no year, assume current year or next year
    const cleaned = dateStr.replace(/\u003c[^>]*>/g, '').trim()
    const d = new Date(cleaned)
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0]
    }
    // Try with current year
    const now = new Date()
    const withYear = `${cleaned}, ${now.getFullYear()}`
    const d2 = new Date(withYear)
    if (!isNaN(d2.getTime())) {
      // If date is in the past, assume next year
      if (d2.getTime() < now.getTime()) {
        d2.setFullYear(d2.getFullYear() + 1)
      }
      return d2.toISOString().split('T')[0]
    }
  } catch {}
  return ''
}

async function fetchDevpost(): Promise<NormalizedOpportunity[]> {
  const seen = new Set<string>()
  const all: NormalizedOpportunity[] = []
  for (let page = 1; page <= 5; page++) {
    const results = await fetchDevpostPage(page, seen)
    all.push(...results)
    if (results.length === 0) break
  }
  console.log(`[Devpost] Fetched ${all.length} hackathons across pages`)
  return all
}

// ─── MLH: upcoming hackathons ────────────────────────────────────
async function fetchMLH(): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch('https://mlh.io/seasons/2026/events', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`MLH error: ${response.status}`)
    const html = await response.text()

    const opportunities: NormalizedOpportunity[] = []
    const seen = new Set<string>()

    // Extract individual event objects by regex matching the known fields
    const eventRegex = /\{"id":"[^"]+","slug":"[^"]+","name":"[^"]+","status":"[^"]+","startsAt":"[^"]+","endsAt":"[^"]+","dateRange":"[^"]*","url":"[^"]*","location":"[^"]*","formatType":"[^"]*"/g

    let match
    while ((match = eventRegex.exec(html)) !== null) {
      // Find the full object by counting braces
      const start = match.index
      let depth = 0
      let end = start
      for (let i = start; i < html.length && i < start + 2000; i++) {
        if (html[i] === '{') depth++
        if (html[i] === '}') {
          depth--
          if (depth === 0) {
            end = i + 1
            break
          }
        }
      }

      try {
        const event = JSON.parse(html.substring(start, end))

        // Skip ended events
        if (event.status === 'ended') continue

        const title = event.name
        if (!title || seen.has(title)) continue
        seen.add(title)

        const slug = event.slug
        const url = `https://mlh.io/events/${slug}`

        // Dates
        const startDate = event.startsAt ? event.startsAt.split('T')[0] : ''
        const deadline = event.endsAt ? event.endsAt.split('T')[0] : ''

        // Location
        const venueAddress = event.venueAddress
        const fullLocation = venueAddress
          ? [venueAddress.city, venueAddress.state, venueAddress.country].filter(Boolean).join(', ')
          : (event.location || '')

        // Mode from formatType
        let mode = 'ONLINE'
        if (event.formatType === 'physical' || event.formatType === 'in-person') {
          mode = 'OFFLINE'
        } else if (event.formatType === 'hybrid') {
          mode = 'HYBRID'
        }

        opportunities.push({
          type: 'HACKATHON',
          title,
          description: event.dateRange || '',
          url,
          source: 'MLH',
          organizer: 'MLH',
          deadline,
          startDate,
          duration: '',
          location: fullLocation,
          mode,
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
      } catch (e) {
        // Skip individual parse errors
      }
    }

    console.log(`[MLH] Fetched ${opportunities.length} upcoming hackathons`)
    return opportunities
  } catch (error) {
    console.error('MLH fetch error:', error)
    return []
  }
}

// ─── Unstop: JSON API for hackathons ──────────────────────────────
async function fetchUnstop(): Promise<NormalizedOpportunity[]> {
  try {
    const opportunities: NormalizedOpportunity[] = []
    for (let page = 1; page <= 5 && opportunities.length < 20; page++) {
      const url = `https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&per_page=18&oppstatus=open&page=${page}`
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) break
      const data = await response.json() as any
      const items = data.data?.data || []
      if (items.length === 0) break

      for (const h of items) {
        if (opportunities.length >= 20) break
        const link = `https://unstop.com/${h.public_url || ''}`
        const regnReqs = h.regnRequirements || {}
        const address = h.address_with_country_logo || {}
        const org = h.organisation || {}

        opportunities.push({
          type: 'HACKATHON',
          title: h.title || '',
          description: h.details || '',
          url: link,
          source: 'UNSTOP',
          organizer: org.name || '',
          deadline: regnReqs.end_regn_dt || '',
          startDate: '',
          duration: regnReqs.remainingDaysArray?.text || '',
          location: address.city || '',
          mode: regnReqs.work_location_type === 'online' ? 'ONLINE'
            : (address.city ? 'OFFLINE' : 'ONLINE'),
          prizePool: Array.isArray(h.prizes)
            ? h.prizes.map((p: any) => `${p.rank}: ₹${p.cash || 0}`).join(', ')
            : typeof h.prizes === 'string' ? h.prizes : '',
          stipend: '',
          company: org.name || '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: h.participants_count || 0,
          inviteOnly: false,
        })
      }
    }
    console.log(`[Unstop] Fetched ${opportunities.length} hackathons`)
    return opportunities
  } catch (error) {
    console.error('Unstop fetch error:', error)
    return []
  }
}

export async function enrichHackathonStaging(id: string): Promise<void> {
  try {
    const record = await prisma.hackathonStaging.findUnique({ where: { id } })
    if (!record) return

    const content = record.description || ''
    const scrapedHints = [
      record.title ? `Title: ${record.title}` : '',
      record.themes && record.themes !== '[]' ? `Themes: ${record.themes}` : '',
      record.organizer ? `Organizer: ${record.organizer}` : '',
      record.mode ? `Mode: ${record.mode}` : '',
      record.prizePool ? `Prize: ${record.prizePool}` : '',
      record.url ? `URL: ${record.url}` : '',
      record.location ? `Location: ${record.location}` : '',
      record.duration ? `Duration: ${record.duration}` : '',
    ].filter(Boolean).join('\n')

    const prompt = `Enrich this hackathon with full details. Extract ALL available information.

${scrapedHints ? `Known info:\n${scrapedHints}\n` : ''}${content ? `\nDescription:\n${content}\n` : '\n(No description available)\n'}
Extract and return a JSON object with ALL of these fields:

{
  "description": "enhanced brief description (2-3 sentences, summarize what the hackathon is about)",
  "targetDepartments": ["CSE", "IT", ...],
  "targetYears": [1, 2, 3, 4],
  "eligibility": "free text eligibility criteria",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "deadline": "YYYY-MM-DD or null",
  "teamSize": number or null,
  "themes": ["theme1", "theme2"],
  "location": "venue or city or null",
  "mode": "ONLINE or OFFLINE or HYBRID",
  "prizePool": "prize info or null",
  "duration": "duration text or null",
  "schedule": "event schedule summary or null",
  "bootcamps": ["bootcamp1", "bootcamp2"] or null,
  "highlights": ["highlight1", "highlight2"] or null,
  "rounds": [
    {
      "roundNumber": 1,
      "title": "round name",
      "description": "what this round evaluates",
      "date": "YYYY-MM-DD or null",
      "resultDate": "YYYY-MM-DD or null"
    }
  ]
}

DEPARTMENT ANALYSIS (INFER from the topic — do NOT just extract explicit text):
- Software/Developer/Web/App/Cloud/Blockchain → CSE, IT, AIDS, CSBS, CYS, DS, MCA
- AI/ML/Data/Deep Learning/NLP/Computer Vision → CSE, IT, AIDS, AIML, DS
- Cybersecurity/Security/Ethical Hacking → CSE, IT, CYS
- IoT/Embedded/Edge Computing → CSE, IT, ECE, EEE
- Electronics/VLSI/Signal/Communication → ECE, EEE
- Mechanical/CAD/Robotics/Automotive → MECH, AUTO, IE
- Civil/Structural/Construction/Architecture → CIVIL, ARCH
- Chemistry/Biology/Biotech/Pharma → CHEM, BT, PHARMA, BIO
- Business/Marketing/Finance/Management → MBA
- If "open to all" or "all branches" → ["ALL"]
- If nothing specific → []

YEAR ANALYSIS (INFER from context):
- "beginner friendly" / "freshmen" / "no experience needed" → [1, 2]
- "final year" / "4th year" / "capstone" → [4]
- "pre-final year" / "3rd year" → [3]
- "2nd year" / "sophomore" → [2]
- "all years" / "open to all" → [1, 2, 3, 4]
- No info → []

CRITICAL RULES:
1. NEVER fabricate dates. Only use dates EXPLICITLY found. If none, set to null.
2. Extract rounds/phases/stages from the selection process flow.
3. Analyze the TOPIC to infer departments, not just extract text.
4. Return ONLY the JSON object, no other text.`

    let responseText = ''
    if (openCodeServe) {
      try {
        const completion = await openCodeServe.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'big-pickle',
          temperature: 0.1,
          max_tokens: 4000,
        })
        responseText = completion.choices[0]?.message?.content || ''
      } catch (serveErr) {
        console.log('OpenCode Serve failed for hackathon staging enrichment:', serveErr)
      }
    }

    if (!responseText) return

    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    let details: any = null
    try {
      details = JSON.parse(jsonMatch[0])
    } catch {
      return
    }

    const updateData: any = {}
    if (details.description) updateData.description = stripHtml(details.description)
    if (details.targetDepartments) updateData.targetDepartments = JSON.stringify(details.targetDepartments)
    if (details.targetYears) updateData.targetYears = JSON.stringify(details.targetYears)
    if (details.eligibility) updateData.eligibility = JSON.stringify(details.eligibility)
    if (details.startDate) updateData.startDate = new Date(details.startDate)
    if (details.endDate) updateData.endDate = new Date(details.endDate)
    if (details.deadline) updateData.deadline = new Date(details.deadline)
    if (details.teamSize) updateData.teamSize = details.teamSize
    if (details.themes) updateData.themes = JSON.stringify(details.themes)
    if (details.location) updateData.location = details.location
    if (details.mode) updateData.mode = details.mode
    if (details.prizePool) updateData.prizePool = details.prizePool
    if (details.duration) updateData.duration = details.duration
    if (details.schedule) updateData.schedule = details.schedule
    if (details.bootcamps) updateData.bootcamps = JSON.stringify(details.bootcamps)
    if (details.highlights) updateData.highlights = JSON.stringify(details.highlights)
    if (details.rounds) updateData.schedule = JSON.stringify(details.rounds)

    await prisma.hackathonStaging.update({
      where: { id },
      data: updateData,
    })
    console.log(`[Enrichment] Hackathon staging ${id} enriched — ${Object.keys(updateData).length} fields updated`)
  } catch (error) {
    console.error(`[Enrichment] Error enriching hackathon staging ${id}:`, error)
  }
}

export async function enrichInternshipStaging(id: string): Promise<void> {
  try {
    const record = await prisma.internshipStaging.findUnique({ where: { id } })
    if (!record) return

    const content = record.description || ''
    const scrapedHints = [
      record.title ? `Title: ${record.title}` : '',
      record.company ? `Company: ${record.company}` : '',
      record.role ? `Role: ${record.role}` : '',
      record.mode ? `Mode: ${record.mode}` : '',
      record.stipend ? `Stipend: ${record.stipend}` : '',
      record.duration ? `Duration: ${record.duration}` : '',
      record.url ? `URL: ${record.url}` : '',
    ].filter(Boolean).join('\n')

    const prompt = `Enrich this internship with full details. Extract ALL available information.

${scrapedHints ? `Known info:\n${scrapedHints}\n` : ''}${content ? `\nDescription:\n${content}\n` : '\n(No description available)\n'}
Extract and return a JSON object with ALL of these fields:

{
  "description": "enhanced brief description (2-3 sentences)",
  "targetDepartments": ["CSE", "IT", ...],
  "targetYears": [1, 2, 3, 4],
  "stipend": "stipend like ₹15,000/month or Unpaid or null",
  "duration": "like 3 months, 6 months or null",
  "mode": "REMOTE, ONSITE, or HYBRID",
  "deadline": "YYYY-MM-DD or null",
  "startDate": "YYYY-MM-DD or null"
}

DEPARTMENT ANALYSIS (INFER from the role and topic — do NOT just extract explicit text):
- Software/Developer/Engineer/Cloud → CSE, IT, AIDS, CSBS, CYS, DS, MCA
- AI/ML/Data/Deep Learning/NLP/Computer Vision → CSE, IT, AIDS, AIML, DS
- Cybersecurity/Security/Ethical Hacking → CSE, IT, CYS
- IoT/Embedded/Edge Computing → CSE, IT, ECE, EEE
- Hardware/Electronics/VLSI/Communication → ECE, EEE
- Mechanical/Design/Manufacturing → MECH, AUTO, IE
- Civil/Structural/Construction → CIVIL
- Marketing/Sales/Business/Management → MBA
- If "open to all" → ["ALL"]
- If nothing specific → []

YEAR ANALYSIS (INFER from context):
- "fresher" / "freshman" → [1]
- "2nd year" / "sophomore" → [2]
- "pre-final year" / "3rd year" → [3]
- "final year" / "4th year" → [4]
- "all years" / "open to all" → [1, 2, 3, 4]
- No info → []

CRITICAL RULES:
1. NEVER fabricate dates. Only use dates EXPLICITLY found. If none, set to null.
2. Analyze the ROLE/TOPIC to infer departments, not just extract text.
3. Return ONLY the JSON object, no other text.`

    let responseText = ''
    if (openCodeServe) {
      try {
        const completion = await openCodeServe.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'big-pickle',
          temperature: 0.1,
          max_tokens: 1000,
        })
        responseText = completion.choices[0]?.message?.content || ''
      } catch (serveErr) {
        console.log('OpenCode Serve failed for internship staging enrichment:', serveErr)
      }
    }

    if (!responseText) return

    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    let details: any = null
    try {
      details = JSON.parse(jsonMatch[0])
    } catch {
      return
    }

    const updateData: any = {}
    if (details.description) updateData.description = stripHtml(details.description)
    if (details.targetDepartments) updateData.targetDepartments = JSON.stringify(details.targetDepartments)
    if (details.targetYears) updateData.targetYears = JSON.stringify(details.targetYears)
    if (details.stipend && !record.stipend) updateData.stipend = details.stipend
    if (details.duration && !record.duration) updateData.duration = details.duration
    if (details.mode && record.mode === 'REMOTE') updateData.mode = details.mode
    if (details.deadline && !record.deadline) updateData.deadline = details.deadline
    if (details.startDate && !record.startDate) updateData.startDate = details.startDate

    await prisma.internshipStaging.update({
      where: { id },
      data: updateData,
    })
    console.log(`[Enrichment] Internship staging ${id} enriched — ${Object.keys(updateData).length} fields updated`)
  } catch (error) {
    console.error(`[Enrichment] Error enriching internship staging ${id}:`, error)
  }
}

// ─── All sources combined ─────────────────────────────────────────
function normalizeMode(mode: string, location: string): string {
  if (!mode || mode.trim() === '') {
    return location && location.trim() !== '' ? 'OFFLINE' : 'ONLINE'
  }
  return mode
}

export async function fetchFromAllSources(): Promise<NormalizedOpportunity[]> {
  const results = await Promise.all([
    fetchDevfolio(),
    fetchDevpost(),
    fetchInternshala(),
    fetchMLH(),
    fetchUnstop(),
  ])
  return results.flat().filter(opp => !opp.deadline || !isEnded(opp.deadline))
}
