import { Router, Request, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { getGithubCalendar } from '../services/githubActivity'

const router = Router()

// helper to generate activity for calendar if needed (mirrors frontend deterministic)
function generateCalendarContribs(seed: string, days = 364) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const rand = (n: number) => {
    h = (h * 1664525 + 1013904223) | 0
    return Math.abs(h % 1000) / 1000 + n * 0.0001
  }
  const today = new Date()
  const arr: { date: string; count: number; level: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const r = rand(i)
    const recencyBoost = i < 14 ? 0.08 : 0
    let level = 0
    if (r > 0.55 - recencyBoost) level = 1
    if (r > 0.77 - recencyBoost) level = 2
    if (r > 0.90 - recencyBoost) level = 3
    if (r > 0.96 - recencyBoost) level = 4
    const m = d.getMonth()
    if ((m === 0 || m === 4) && r < 0.7) level = Math.max(0, level - 1)
    const count = level === 0 ? 0 : level === 1 ? 1 + Math.floor(rand(i + 1) * 2) : level === 2 ? 3 + Math.floor(rand(i + 2) * 2) : level === 3 ? 5 + Math.floor(rand(i + 3) * 3) : 8 + Math.floor(rand(i + 4) * 4)
    arr.push({ date: d.toISOString().slice(0, 10), count, level })
  }
  return arr
}

function sanitizeUsername(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, '').replace(/^[._-]+/, '').slice(0, 20)
}

function isValidUsername(u: string): boolean {
  return /^[a-z0-9]([a-z0-9._-]{1,18}[a-z0-9])?$/.test(u) && u.length >= 3 && u.length <= 20
}

// Generate suggestion from name/email
function suggestUsername(name: string, email: string): string {
  const base = sanitizeUsername(name.replace(/\s+/g, '_')) || sanitizeUsername(email.split('@')[0]) || 'user'
  // ensure length >=3
  let s = base
  if (s.length < 3) s = (s + 'user').slice(0, 20)
  return s
}

// GET /api/u/check/:username  -> availability (public)  -- must be before :username
router.get('/check/:username', async (req: Request, res: Response) => {
  try {
    const raw = sanitizeUsername(String(req.params.username || ''))
    if (!raw || !isValidUsername(raw)) {
      res.json({ available: false, reason: 'Username must be 3-20 chars, letters/numbers/_.- only, start/end with alphanumeric' })
      return
    }
    try {
      const existing = await (prisma as any).user.findFirst({ where: { username: raw } } as any)
      res.json({ available: !existing, username: raw })
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('username') || msg.includes('Unknown argument')) {
        res.status(503).json({ error: 'Username feature not yet migrated' })
        return
      }
      throw e
    }
  } catch {
    res.status(500).json({ error: 'Check failed' })
  }
})

// GET /api/u/suggest?name=&email=  -> suggestion  -- must be before :username
router.get('/suggest/one', async (req: Request, res: Response) => {
  try {
    const name = String(req.query.name || '')
    const email = String(req.query.email || '')
    let base = suggestUsername(name, email)
    // ensure unique by appending numbers if needed
    let candidate = base
    let tries = 0
    while (tries < 10) {
      try {
        const exists = await (prisma as any).user.findFirst({ where: { username: candidate } } as any)
        if (!exists) break
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (msg.includes('username') || msg.includes('Unknown argument')) break
        throw e
      }
      tries++
      candidate = `${base}${tries}`.slice(0, 20)
    }
    res.json({ suggestion: candidate })
  } catch {
    res.status(500).json({ error: 'Suggest failed' })
  }
})

// GET /api/u/:username  -> public profile (no auth required)
// Also mounted at /api/users/u/:username for legacy, but primary is /api/u/:username
router.get('/:username', async (req: Request, res: Response) => {
  try {
    const raw = String(req.params.username || '').toLowerCase().trim()
    if (!raw || !/^[a-z0-9._-]{3,30}$/.test(raw)) {
      res.status(400).json({ error: 'Invalid username' })
      return
    }
    let user: any
    try {
      user = await (prisma as any).user.findFirst({
        where: { username: raw },
        include: {
          college: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true } },
        },
      })
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('username') || msg.includes('Unknown argument')) {
        res.status(503).json({ error: 'Username feature not yet migrated. Please run prisma migrate.' })
        return
      }
      throw e
    }
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const [codingProfile, hackathonRegs, internshipRegs, participations] = await Promise.all([
      prisma.codingProfile.findUnique({ where: { userId: user.id } }).catch(() => null),
      prisma.hackathonRegistration.findMany({
        where: { userId: user.id },
        include: {
          hackathon: {
            select: {
              id: true, title: true, organizer: true, startDate: true, endDate: true, deadline: true, status: true, location: true, prizePool: true, url: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),
      (prisma.internshipRegistration.findMany({
        where: { userId: user.id },
        include: {
          internship: {
            select: {
              id: true, title: true, company: true, role: true, stipend: true, duration: true, mode: true, deadline: true, status: true, url: true,
            },
          },
        },
      }) as any).catch(() => []),
      prisma.contestParticipation.findMany({
        where: { userId: user.id },
        orderBy: { participatedAt: 'desc' },
        take: 100,
      }).catch(() => []),
    ])

    // Parse platformStats safely
    let platformStats: any[] = []
    let totalSolved = 0
    let bestRating: number | null = null
    try {
      const parsed = codingProfile?.platformStats ? JSON.parse(codingProfile.platformStats) : []
      if (Array.isArray(parsed)) {
        platformStats = parsed.filter((s: any) => s.valid)
        totalSolved = platformStats.reduce((sum: number, s: any) => sum + (s.problemsSolved || 0), 0)
        const rated = platformStats.filter((s: any) => typeof s.rating === 'number')
        if (rated.length) bestRating = Math.max(...rated.map((s: any) => s.rating))
      }
    } catch {}

    // contribution calendar - try real GitHub data if githubUsername exists, else deterministic fallback
    // Always overlay real contest/hackathon dates on top of whichever base calendar we use.
    let calendar: { date: string; count: number; level: number }[]
    let calendarSource: 'github' | 'deterministic' = 'deterministic'
    const githubUsername = (codingProfile as any)?.githubUsername as string | null | undefined

    if (githubUsername) {
      try {
        const ghCal = await getGithubCalendar(githubUsername, 364)
        if (ghCal && ghCal.length) {
          calendar = ghCal
          calendarSource = 'github'
        } else {
          const seed = user.username || user.id || user.email
          calendar = generateCalendarContribs(seed, 364)
        }
      } catch {
        const seed = user.username || user.id || user.email
        calendar = generateCalendarContribs(seed, 364)
      }
    } else {
      const seed = user.username || user.id || user.email
      calendar = generateCalendarContribs(seed, 364)
    }

    // overlay real dates: boost level for days with real participation/registration
    const realDates = new Set<string>()
    for (const p of participations) {
      if (p.participatedAt) realDates.add(new Date(p.participatedAt).toISOString().slice(0, 10))
    }
    for (const r of hackathonRegs) { const d = (r as any).createdAt || (r as any).hackathon?.startDate; if (d) realDates.add(new Date(d).toISOString().slice(0, 10)) }
    for (const r of internshipRegs) { const d = (r as any).reportedAt || (r as any).createdAt || (r as any).internship?.deadline; if (d) realDates.add(new Date(d).toISOString().slice(0, 10)) }
    for (const d of realDates) {
      const idx = calendar.findIndex(c => c.date === d)
      if (idx >= 0) {
        // if calendar already shows high activity (github level >=2), keep it, else boost
        calendar[idx].count = Math.max(calendar[idx].count, 3 + Math.floor(Math.random() * 4))
        calendar[idx].level = Math.max(calendar[idx].level, 2) as number
      }
    }
    const totalContribs = calendar.reduce((s, c) => s + c.count, 0)
    // streaks
    let curStreak = 0
    for (let i = calendar.length - 1; i >= 0; i--) {
      if (calendar[i].level > 0) curStreak++; else break
    }
    let bestStreak = 0
    let cur = 0
    for (const c of calendar) {
      if (c.level > 0) { cur++; bestStreak = Math.max(bestStreak, cur) } else cur = 0
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        portfolioUrl: (user as any).portfolioUrl || null,
        college: (user as any).college || null,
        department: (user as any).department || null,
        collegeName: user.collegeName,
        departmentName: user.departmentName,
        incomingYear: user.incomingYear,
        outgoingYear: user.outgoingYear,
        createdAt: user.createdAt,
      },
      codingProfile: codingProfile ? {
        leetcodeHandle: (codingProfile as any).leetcodeHandle || null,
        codeforcesHandle: (codingProfile as any).codeforcesHandle || null,
        codechefHandle: (codingProfile as any).codechefHandle || null,
        hackerrankHandle: (codingProfile as any).hackerrankHandle || null,
        gfgHandle: (codingProfile as any).gfgHandle || null,
        githubUsername: (codingProfile as any).githubUsername || null,
        platformStats,
        totalSolved,
        bestRating,
        lastSyncedAt: (codingProfile as any).lastSyncedAt || null,
      } : null,
      stats: {
        hackathonsApplied: hackathonRegs.length,
        hackathonsWon: hackathonRegs.filter((r: any) => r.status === 'WINNER' || r.winPosition).length,
        hackathonsAdvanced: hackathonRegs.filter((r: any) => r.status === 'ADVANCED').length,
        internshipsApplied: internshipRegs.length,
        internshipsSelected: internshipRegs.filter((r: any) => r.status === 'SELECTED' || r.status === 'ACCEPTED').length,
        contestsParticipated: participations.length,
        totalSolved,
        totalContribs,
        curStreak,
        bestStreak,
      },
      calendar,
      calendarSource,
      hackathonRegs: hackathonRegs.map((r: any) => ({
        id: r.id,
        status: r.status,
        currentRound: r.currentRound,
        winPosition: r.winPosition,
        createdAt: r.createdAt,
        hackathon: r.hackathon,
      })),
      internshipRegs: internshipRegs.map((r: any) => ({
        id: r.id,
        status: r.status,
        createdAt: r.reportedAt || r.createdAt || null,
        internship: r.internship,
      })),
      participations: participations.map((p: any) => ({
        id: p.id,
        platform: p.platform,
        contestName: p.contestName,
        contestUrl: p.contestUrl,
        rank: p.rank,
        rating: p.rating,
        ratingChange: p.ratingChange,
        problemsSolved: p.problemsSolved,
        participatedAt: p.participatedAt,
      })),
    })
  } catch (e) {
    console.error('public profile error', e)
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

export default router

// Also export helpers for reuse in auth/user routes
export { sanitizeUsername, isValidUsername, suggestUsername }
