import prisma from '../config/db'

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
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Devfolio: HTML scraping ──────────────────────────────────────
async function fetchDevfolio(): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch('https://devfolio.co/hackathons', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Devfolio error: ${response.status}`)
    const html = await response.text()

    // Extract hackathon cards from HTML
    const opportunities: NormalizedOpportunity[] = []
    const cardRegex = /href="(https:\/\/[^"]+\.devfolio\.co\/?)"[^>]*>([\s\S]*?)<\/a>/g
    let match
    while ((match = cardRegex.exec(html)) !== null && opportunities.length < 20) {
      const section = match[2]
      const titleMatch = section.match(/<h3[^>]*>([^<]+)<\/h3>/)
      if (!titleMatch) continue

      const title = titleMatch[1].trim()
      const url = match[1]

      // Extract additional details from card
      const taglineMatch = section.match(/<p[^>]*>([^<]+)<\/p>/)
      const onlineMatch = section.match(/Online/i)
      const offlineMatch = section.match(/Offline/i)

      opportunities.push({
        type: 'HACKATHON',
        title,
        description: taglineMatch ? taglineMatch[1].trim() : '',
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
      })
    }
    console.log(`[Devfolio] Fetched ${opportunities.length} hackathons`)
    return opportunities
  } catch (error) {
    console.error('Devfolio fetch error:', error)
    return []
  }
}

// ─── Internshala: JSON-LD structured data ─────────────────────────
async function fetchInternshala(): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch('https://internshala.com/internships/page-1', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Internshala error: ${response.status}`)
    const html = await response.text()

    // Extract JSON-LD ItemList with internship listings
    const opportunities: NormalizedOpportunity[] = []
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    let match

    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1])
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          for (const item of data.itemListElement) {
            if (opportunities.length >= 20) break
            const name = item.name || ''
            const url = item.url || ''

            // Parse company and role from title like "Marketing - Internship"
            const parts = name.split(' - ')
            const role = parts[0]?.trim() || name
            const company = url.includes('/at-')
              ? url.split('/at-')[1]?.replace(/\d+$/, '')?.replace(/-/g, ' ') || 'Unknown'
              : 'Unknown'

            opportunities.push({
              type: 'INTERNSHIP',
              title: name,
              description: `Internship opportunity at ${company}`,
              url,
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
            })
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }
    console.log(`[Internshala] Fetched ${opportunities.length} internships`)
    return opportunities
  } catch (error) {
    console.error('Internshala fetch error:', error)
    return []
  }
}

// ─── Devpost: scrape open hackathons via search page ──────────────
async function fetchDevpost(): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch('https://devpost.com/hackathons?challenge_type=all&search=&status=open', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Devpost error: ${response.status}`)
    const html = await response.text()

    const opportunities: NormalizedOpportunity[] = []

    // Try multiple regex patterns
    // Pattern 1: Direct card links
    const regex1 = /href="(\/hackathons\/[^"]+)"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g
    let match
    while ((match = regex1.exec(html)) !== null && opportunities.length < 20) {
      opportunities.push({
        type: 'HACKATHON',
        title: match[2].trim(),
        description: '',
        url: `https://devpost.com${match[1]}`,
        source: 'DEVPOST',
        organizer: '',
        deadline: '',
        startDate: '',
        duration: '',
        location: '',
        mode: 'ONLINE',
        prizePool: '',
        stipend: '',
        company: '',
        role: '',
      })
    }

    // Pattern 2: Search for hackathon URLs in the page
    if (opportunities.length === 0) {
      const urlRegex = /href="(https?:\/\/[^"]*\.devpost\.com\/?)"[^>]*>([^<]*)</g
      while ((match = urlRegex.exec(html)) !== null && opportunities.length < 20) {
        const url = match[1]
        const text = match[2].trim()
        if (text && !url.includes('.css') && !url.includes('.js') && text.length > 5) {
          opportunities.push({
            type: 'HACKATHON',
            title: text,
            description: '',
            url,
            source: 'DEVPOST',
            organizer: '',
            deadline: '',
            startDate: '',
            duration: '',
            location: '',
            mode: 'ONLINE',
            prizePool: '',
            stipend: '',
            company: '',
            role: '',
          })
        }
      }
    }

    console.log(`[Devpost] Fetched ${opportunities.length} hackathons`)
    return opportunities
  } catch (error) {
    console.error('Devpost fetch error:', error)
    return []
  }
}

// ─── HackerRank: upcoming contests (for reference) ────────────────
async function fetchHackerRankContests(): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch('https://www.hackerrank.com/rest/contests', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`HackerRank error: ${response.status}`)
    const data = await response.json() as any
    const contests = data?.contests || []

    return contests.slice(0, 10).map((c: any) => ({
      type: 'HACKATHON',
      title: c.name || '',
      description: `Coding contest on HackerRank`,
      url: c.url ? `https://www.hackerrank.com${c.url}` : '',
      source: 'HACKERRANK',
      organizer: 'HackerRank',
      deadline: '',
      startDate: c.start_at || '',
      duration: '',
      location: '',
      mode: 'ONLINE',
      prizePool: '',
      stipend: '',
      company: '',
      role: '',
    }))
  } catch (error) {
    console.error('HackerRank fetch error:', error)
    return []
  }
}

// ─── All sources combined ─────────────────────────────────────────
export async function fetchFromAllSources(): Promise<NormalizedOpportunity[]> {
  const results = await Promise.all([
    fetchDevfolio(),
    fetchDevpost(),
    fetchInternshala(),
    fetchHackerRankContests(),
  ])
  return results.flat()
}

export async function fetchAndStoreOpportunities(): Promise<{ fetched: number; skipped: number }> {
  console.log('[OpportunityAgent] Starting fetch...')
  const allOpportunities = await fetchFromAllSources()
  let fetched = 0
  let skipped = 0

  for (const opp of allOpportunities) {
    if (!opp.url || !opp.title) {
      skipped++
      continue
    }

    try {
      // Deduplicate by URL
      const existingByUrl = await prisma.opportunity.findFirst({
        where: { url: opp.url },
      })
      if (existingByUrl) {
        skipped++
        continue
      }

      // Deduplicate by title + source
      const existingByTitleSource = await prisma.opportunity.findFirst({
        where: { title: opp.title, source: opp.source },
      })
      if (existingByTitleSource) {
        skipped++
        continue
      }

      await prisma.opportunity.create({
        data: {
          type: opp.type,
          title: opp.title,
          description: opp.description || null,
          url: opp.url,
          source: opp.source,
          organizer: opp.organizer || null,
          deadline: opp.deadline || null,
          startDate: opp.startDate || null,
          duration: opp.duration || null,
          location: opp.location || null,
          mode: opp.mode || null,
          prizePool: opp.prizePool || null,
          stipend: opp.stipend || null,
          company: opp.company || null,
          role: opp.role || null,
          status: 'PENDING',
          isAutoFetched: true,
          fetchedAt: new Date(),
        },
      })
      fetched++
    } catch (error) {
      console.error(`Error storing opportunity "${opp.title}":`, error)
      skipped++
    }
  }

  console.log(`[OpportunityAgent] Done. Fetched: ${fetched}, Skipped: ${skipped}`)
  return { fetched, skipped }
}
