import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import Groq from 'groq-sdk'
import { config } from '../config'
import ExcelJS from 'exceljs'

const router = Router()
router.use(authenticate)

const hasAI = config.groqApiKey && config.groqApiKey !== 'your-groq-api-key-here'
const groq = hasAI ? new Groq({ apiKey: config.groqApiKey }) : null

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

    console.log(`Web search found ${snippets.length} snippets, ${urls.length} URLs for: ${query.substring(0, 60)}`)

    // Fetch the top 3 non-SPA result pages for richer content
    const spaDomains = ['unstop.com', 'youtube.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com']
    const pagesToFetch = urls
      .filter(u => !spaDomains.some(d => u.includes(d)))
      .slice(0, 3)

    const fetchedPages: string[] = []
    for (const pageUrl of pagesToFetch) {
      try {
        const pageResp = await fetch(pageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
          redirect: 'follow',
        })
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
          console.log(`Fetched ${pageUrl} (${pageText.length} chars)`)
        }
      } catch (e) {
        console.log(`Failed to fetch ${pageUrl}`)
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
    console.log('Web search fallback failed:', err)
    return ''
  }
}

// Fetch hackathon details from URL using AI
async function fetchHackathonDetails(url: string): Promise<any> {
  if (!groq) return null
  
  try {
    // Fetch actual page content
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    
    let pageContent = ''
    let pageTitle = ''
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      })
      const html = await response.text()
      pageTitle = extractTitle(html)
      // Extract text content from HTML
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000) // Limit content size
    } catch (fetchErr) {
      console.log('Could not fetch URL content, sending URL only to AI')
    }
    clearTimeout(timeout)

    // If page content is too short (SPA), search the web for details
    let searchResults = ''
    if (pageContent.length < 300) {
      // Extract hackathon name from URL for better search results
      let searchQuery = pageTitle || ''
      try {
        const urlPath = new URL(url).pathname
        // Extract readable name from URL paths like /hackathons/crp-adobe-university-hackathon-2026-adobe-1715333
        const slug = urlPath.split('/').filter(Boolean).pop() || ''
        const cleaned = slug.replace(/[-_]/g, ' ').replace(/\d{5,}/g, '').replace(/\s+/g, ' ').trim()
        if (cleaned.length > 5) searchQuery = cleaned
      } catch {}
      if (!searchQuery || searchQuery.length < 5) {
        const domain = new URL(url).hostname.replace('www.', '')
        searchQuery = `${domain} hackathon`
      }
      console.log(`Page content too short (${pageContent.length} chars), searching web for: ${searchQuery}`)
      searchResults = await searchHackathonDetails(searchQuery + ' hackathon details rounds dates prizes eligibility')
    }

    const contentSection = pageContent.length > 300
      ? `Page content:\n${pageContent}`
      : `Page content: (SPA/JavaScript-rendered page - content not available via fetch)`

    const searchSection = searchResults
      ? `\n\nWeb search results for this hackathon:\n${searchResults}`
      : ''

    const prompt = `Extract hackathon details from the following sources. URL: ${url}

${contentSection}${searchSection}

Return ONLY a valid JSON object with these fields:
{
  "title": "hackathon name",
  "description": "brief description (2-3 sentences)",
  "organizer": "who is organizing",
  "registrationUrl": "registration link (full URL, only if explicitly found on the page)",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "deadline": "registration deadline YYYY-MM-DD or null",
  "teamSize": number or null,
  "themes": ["theme1", "theme2"],
  "location": "venue, city, or college name",
  "mode": "ONLINE or OFFLINE or HYBRID",
  "eligibility": "free text describing who can participate (departments, years, gender, etc.) or null",
  "prizePool": "prize money or CTC info or null",
  "duration": "hackathon duration or null",
  "rounds": [
    {
      "roundNumber": 1,
      "title": "round name",
      "description": "round description including what it evaluates",
      "date": "YYYY-MM-DD or null",
      "resultDate": "YYYY-MM-DD or null"
    }
  ],
  "schedule": "event schedule summary or null",
  "bootcamps": ["bootcamp1 info", "bootcamp2 info"] or null,
  "highlights": ["highlight1", "highlight2"] or null
}

CRITICAL RULES:
1. NEVER fabricate or guess dates. Only use dates that are EXPLICITLY written in the content. If no dates are found, set them to null. Do NOT infer dates from "Day 1", "Day 2" — those are not dates. Do NOT make up dates unless you see that exact date text in the content.
2. NEVER invent information not present in the provided content.
3. Extract rounds/phases/stages/qualifiers from the selection process flow.
4. Extract ALL available information including prize pool, eligibility criteria, event schedule, bootcamps, and highlights.
5. For eligibility, extract as free text (not structured JSON) to preserve all details.
6. For rounds, only set date/resultDate if a specific calendar date is mentioned next to that round.
7. Return ONLY the JSON object, no other text:`

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 4000,
    })

    const response = completion.choices[0]?.message?.content || '{}'
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (err) {
    console.error('AI fetch hackathon details error:', err)
  }
  return null
}

// Create hackathon (Teacher)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create hackathons' })
      return
    }

    const { title, description, url, organizer, registrationUrl, startDate, endDate, deadline, teamSize, themes, collegeId, location, mode, eligibility, prizePool, duration, schedule, bootcamps, highlights, rounds, targetDepartments, targetYears, eligibilityEnabled } = req.body

    const hackathon = await prisma.hackathon.create({
      data: {
        creatorId: req.userId!,
        collegeId: collegeId || user.collegeId,
        title,
        description,
        url,
        organizer,
        registrationUrl,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        deadline: deadline ? new Date(deadline) : null,
        teamSize: teamSize ? parseInt(teamSize) : null,
        themes: JSON.stringify(themes || []),
        location,
        mode: mode || 'OFFLINE',
        eligibility: typeof eligibility === 'string' ? eligibility : JSON.stringify(eligibility || {}),
        prizePool,
        duration,
        schedule,
        bootcamps: JSON.stringify(bootcamps || []),
        highlights: JSON.stringify(highlights || []),
        targetDepartments: JSON.stringify(targetDepartments || []),
        targetYears: JSON.stringify(targetYears || []),
        eligibilityEnabled: eligibilityEnabled || false,
        status: 'PUBLISHED',
      },
    })

    // Create rounds if provided
    if (Array.isArray(rounds) && rounds.length > 0) {
      for (const round of rounds) {
        await prisma.hackathonRound.create({
          data: {
            hackathonId: hackathon.id,
            roundNumber: round.roundNumber,
            title: round.title || `Round ${round.roundNumber}`,
            description: round.description || '',
            date: round.date ? new Date(round.date) : null,
            resultDate: round.resultDate ? new Date(round.resultDate) : null,
          },
        })
      }
    }

    res.status(201).json(hackathon)
  } catch (error) {
    console.error('Create hackathon error:', error)
    res.status(500).json({ error: 'Failed to create hackathon' })
  }
})

// Fetch hackathon details from URL (AI-powered)
router.post('/fetch-details', async (req: AuthRequest, res: Response) => {
  try {
    const { url } = req.body
    if (!url) {
      res.status(400).json({ error: 'URL required' })
      return
    }

    const details = await fetchHackathonDetails(url)
    if (details) {
      res.json(details)
    } else {
      res.json({ message: 'Could not fetch details. Please fill manually.' })
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch details' })
  }
})

// Get all hackathons (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    let hackathons: any[] = []

    if (!user.collegeId && user.role !== 'SUPER_ADMIN') {
      res.json([])
      return
    }

    if (user.role === 'SUPER_ADMIN') {
      // Super admin sees all
      hackathons = await prisma.hackathon.findMany({
        include: { creator: { select: { name: true, email: true } }, registrations: true, rounds: true },
        orderBy: { createdAt: 'desc' },
      })
    } else if (user.role === 'COLLEGE_ADMIN') {
      // College admin sees their college's hackathons
      hackathons = await prisma.hackathon.findMany({
        where: { collegeId: user.collegeId },
        include: { creator: { select: { name: true, email: true } }, registrations: true, rounds: true },
        orderBy: { createdAt: 'desc' },
      })
    } else if (user.role === 'TEACHER') {
      // Teachers see hackathons they created + from their college
      hackathons = await prisma.hackathon.findMany({
        where: {
          OR: [
            { creatorId: req.userId },
            { collegeId: user.collegeId },
          ],
        },
        include: { creator: { select: { name: true, email: true } }, registrations: true, rounds: true },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      // Students see published hackathons from their college + external opportunities
      hackathons = await prisma.hackathon.findMany({
        where: {
          status: 'PUBLISHED',
          collegeId: user.collegeId,
        },
        include: { creator: { select: { name: true, email: true } }, registrations: true, rounds: true },
        orderBy: { createdAt: 'desc' },
      })
    }

    res.json(hackathons)
  } catch (error) {
    console.error('Get hackathons error:', error)
    res.status(500).json({ error: 'Failed to fetch hackathons' })
  }
})

// Export all hackathons (master Excel)
router.get('/export/all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
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
          rollNo: reg.user.studentId || '',
          name: reg.user.name,
          email: reg.user.email,
          department: reg.user.department || '',
          teamName: reg.teamName || '',
          status: reg.status,
          currentRound: reg.currentRound,
          winPosition: reg.winPosition || '',
          review: reg.review || '',
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
      console.error('Export all buffer error:', bufErr)
      throw bufErr
    }
  } catch (error: any) {
    console.error('Export all hackathons error:', error?.message, error?.stack)
    res.status(500).json({ error: 'Failed to export', detail: error?.message })
  }
})

// Get single hackathon
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const hackathon = await prisma.hackathon.findUnique({
      where: { id: req.params.id as string },
      include: {
        creator: { select: { name: true, email: true, role: true } },
        registrations: {
          include: { user: { select: { name: true, email: true, department: true, departmentId: true, incomingYear: true, studentId: true } } },
        },
        rounds: { orderBy: { roundNumber: 'asc' } },
      },
    })

    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }

    // Auto-expire: revert SELECTED registrations to REGISTERED after 3 days of no update
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

    for (const reg of hackathon.registrations) {
      if (reg.status === 'SELECTED' && reg.updatedAt < threeDaysAgo) {
        await prisma.hackathonRegistration.update({
          where: { id: reg.id },
          data: { status: 'REGISTERED', currentRound: 0 },
        })
        reg.status = 'REGISTERED'
        reg.currentRound = 0
      }
    }

    res.json(hackathon)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch hackathon' })
  }
})

// Register for hackathon (Student)
router.post('/:id/register', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can register' })
      return
    }

    const hackathon = await prisma.hackathon.findUnique({ where: { id: req.params.id as string } })
    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
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

    // Check eligibility if enabled
    if (hackathon.eligibilityEnabled) {
      const targetDepts: string[] = JSON.parse(hackathon.targetDepartments || '[]')
      const targetYears: number[] = JSON.parse(hackathon.targetYears || '[]')

      // Must match department if targetDepartments specified
      if (targetDepts.length > 0 && (!user.departmentId || !targetDepts.includes(user.departmentId))) {
        res.status(403).json({ error: 'Your department is not eligible for this hackathon' })
        return
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

    res.status(201).json(registration)
  } catch (error) {
    console.error('Register hackathon error:', error)
    res.status(500).json({ error: 'Failed to register' })
  }
})

// Update registration (mark as selected for next round) - Student self-reports
router.put('/:id/registrations/:regId/round', async (req: AuthRequest, res: Response) => {
  try {
    const registration = await prisma.hackathonRegistration.findUnique({
      where: { id: req.params.regId as string },
    })

    if (!registration) {
      res.status(404).json({ error: 'Registration not found' })
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

// Submit win position and review after completing final round
router.put('/:id/registrations/:regId/result', async (req: AuthRequest, res: Response) => {
  try {
    const registration = await prisma.hackathonRegistration.findUnique({
      where: { id: req.params.regId as string },
    })

    if (!registration) {
      res.status(404).json({ error: 'Registration not found' })
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

// Add round to hackathon (Teacher)
router.post('/:id/rounds', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can add rounds' })
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

    res.status(201).json(round)
  } catch (error) {
    res.status(500).json({ error: 'Failed to add round' })
  }
})

// Edit a round (Teacher)
router.put('/:id/rounds/:roundId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
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

    res.json(updated)
  } catch (error) {
    console.error('Edit round error:', error)
    res.status(500).json({ error: 'Failed to edit round' })
  }
})

// Delete a round (Teacher)
router.delete('/:id/rounds/:roundId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
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

    await prisma.hackathonRound.delete({ where: { id: req.params.roundId as string } })
    res.json({ message: 'Round deleted' })
  } catch (error) {
    console.error('Delete round error:', error)
    res.status(500).json({ error: 'Failed to delete round' })
  }
})

// Teacher updates registration status (advance to next round or eliminate)
router.put('/:id/registrations/:regId/status', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can update registration status' })
      return
    }

    const registration = await prisma.hackathonRegistration.findUnique({
      where: { id: req.params.regId as string },
    })

    if (!registration) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }

    if (registration.hackathonId !== req.params.id as string) {
      res.status(400).json({ error: 'Registration does not belong to this hackathon' })
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
    console.error('Update registration status error:', error)
    res.status(500).json({ error: 'Failed to update registration status' })
  }
})

// Export hackathon to Excel (single hackathon)
router.get('/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const hackathon = await prisma.hackathon.findUnique({
      where: { id: req.params.id as string },
      include: {
        registrations: {
          include: { user: { select: { name: true, email: true, department: true, studentId: true } } },
        },
        rounds: { orderBy: { roundNumber: 'asc' } },
      },
    })

    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
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
        name: reg.user.name,
        email: reg.user.email,
        department: reg.user.department || '',
        studentId: reg.user.studentId || '',
        teamName: reg.teamName || '',
        teamMembers: reg.teamMembers || '',
        projectIdea: reg.projectIdea || '',
        status: reg.status,
        currentRound: reg.currentRound,
        winPosition: reg.winPosition || '',
        review: reg.review || '',
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
          rollNo: reg.user.studentId || '',
          name: reg.user.name,
          email: reg.user.email,
          teamName: reg.teamName || '',
          status: reg.status,
        })
      })
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename=${hackathon.title.replace(/\s+/g, '_')}.xlsx`)
    
    try {
      const buffer = await workbook.xlsx.writeBuffer()
      const nodeBuf = Buffer.from(buffer as any)
      res.send(nodeBuf)
    } catch (bufErr) {
      console.error('Export single buffer error:', bufErr)
      throw bufErr
    }
  } catch (error: any) {
    console.error('Export hackathon error:', error?.message, error?.stack)
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
    res.json({ message: 'Hackathon deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete hackathon' })
  }
})

// POST /fetch-external - Trigger auto-fetch of hackathons from external sources
router.post('/fetch-external', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const { fetchFromAllSources } = await import('../services/opportunityAgent')
    const allOpps = await fetchFromAllSources()
    const hackathons = allOpps.filter(o => o.type === 'HACKATHON')

    let fetched = 0
    let skipped = 0

    for (const opp of hackathons) {
      if (!opp.url || !opp.title) { skipped++; continue }
      try {
        const existing = await prisma.hackathon.findFirst({
          where: { title: opp.title, source: opp.source },
        })
        if (existing) { skipped++; continue }

        await prisma.hackathon.create({
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
            status: 'DRAFT',
            source: opp.source,
            creatorId: user.id,
          },
        })
        fetched++
      } catch (err) {
        console.error(`Error storing hackathon "${opp.title}":`, err)
        skipped++
      }
    }

    res.json({ message: `Hackathon fetch complete`, fetched, skipped, total: hackathons.length })
  } catch (error) {
    console.error('Fetch external hackathons error:', error)
    res.status(500).json({ error: 'Failed to fetch external hackathons' })
  }
})

export default router
