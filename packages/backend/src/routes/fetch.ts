import { Router } from 'express'
import prisma from '../config/db'
import { authenticate, authorize } from '../middleware/auth'
import { enrichHackathonStaging, enrichInternshipStaging, fetchFromAllSources, fetchFromPlatform } from '../services/opportunityAgent'

const router = Router()

// All routes require super admin
router.use(authenticate)
router.use(authorize(['SUPER_ADMIN']))

// ─── Cleanup: delete rejected/ended items older than 30 days ─────
router.post('/cleanup', async (_req, res) => {
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const hackDeleted = await prisma.hackathonStaging.deleteMany({
      where: {
        status: { in: ['REJECTED'] },
        updatedAt: { lt: cutoff },
      },
    })
    const intDeleted = await prisma.internshipStaging.deleteMany({
      where: {
        status: { in: ['REJECTED'] },
        updatedAt: { lt: cutoff },
      },
    })
    console.log(`[Cleanup] Deleted ${hackDeleted.count} hackathons, ${intDeleted.count} internships older than 30 days`)
    res.json({ success: true, deleted: { hackathons: hackDeleted.count, internships: intDeleted.count } })
  } catch (error) {
    console.error('Cleanup error:', error)
    res.status(500).json({ error: 'Failed to cleanup' })
  }
})

// Helper: enrich all pending items (optionally filtered by source)
// Skips ended deadlines, prioritizes near-deadline items first
// Auto-rejects items whose deadline has passed
async function enrichAllPending(source?: string) {
  const BATCH_SIZE = 5
  const today = new Date()

  // Auto-reject ended hackathons
  const rejectedHack = await prisma.hackathonStaging.updateMany({
    where: { deadline: { lt: today }, status: { notIn: ['APPROVED', 'REJECTED'] } },
    data: { status: 'REJECTED' },
  })
  if (rejectedHack.count > 0) console.log(`[Fetch] Auto-rejected ${rejectedHack.count} ended hackathons`)

  // Auto-reject ended internships
  const rejectedInt = await prisma.internshipStaging.updateMany({
    where: { deadline: { lt: today.toISOString().slice(0, 10) }, status: { notIn: ['APPROVED', 'REJECTED'] } },
    data: { status: 'REJECTED' },
  })
  if (rejectedInt.count > 0) console.log(`[Fetch] Auto-rejected ${rejectedInt.count} ended internships`)

  // Enrich hackathons — closest deadline first, skip ended
  let hackEnriched = 0
  while (true) {
    const where: any = {
      OR: [{ description: '' }, { targetDepartments: '[]' }],
      AND: [
        { OR: [{ deadline: null }, { deadline: { gte: today } }] },
      ],
    }
    if (source) where.source = source
    const pending = await prisma.hackathonStaging.findMany({
      where,
      orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
      take: BATCH_SIZE,
    })
    if (pending.length === 0) break
    await Promise.all(pending.map(h => enrichHackathonStaging(h.id)))
    hackEnriched += pending.length
    console.log(`[Fetch] Enriched ${hackEnriched} hackathons so far...`)
  }

  // Enrich internships — closest deadline first, skip ended
  let intEnriched = 0
  while (true) {
    const where: any = {
      OR: [{ description: '' }, { targetDepartments: '[]' }],
      AND: [
        { OR: [{ deadline: null }, { deadline: { gte: today.toISOString().slice(0, 10) } }] },
      ],
    }
    if (source) where.source = source
    const pending = await prisma.internshipStaging.findMany({
      where,
      orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
      take: BATCH_SIZE,
    })
    if (pending.length === 0) break
    await Promise.all(pending.map(i => enrichInternshipStaging(i.id)))
    intEnriched += pending.length
    console.log(`[Fetch] Enriched ${intEnriched} internships so far...`)
  }

  return { hackEnriched, intEnriched }
}

// GET /api/fetch/stats - Get analysis stats for all platforms
router.get('/stats', async (req, res) => {
  try {
    const platforms = ['DEVFOLIO', 'DEVPOST', 'MLH', 'UNSTOP', 'INTERNSHALA']
    
    const stats = await Promise.all(platforms.map(async (platform) => {
      const hackathonCount = await prisma.hackathonStaging.count({ where: { source: platform } })
      const hackathonEnriched = await prisma.hackathonStaging.count({ where: { source: platform, description: { not: '' }, targetDepartments: { not: '[]' } } })
      
      const internshipCount = await prisma.internshipStaging.count({ where: { source: platform } })
      const internshipEnriched = await prisma.internshipStaging.count({ where: { source: platform, description: { not: '' }, targetDepartments: { not: '[]' } } })
      
      return {
        platform,
        hackathons: { fetched: hackathonCount, enriched: hackathonEnriched, pending: hackathonCount - hackathonEnriched },
        internships: { fetched: internshipCount, enriched: internshipEnriched, pending: internshipCount - internshipEnriched },
      }
    }))
    
    const totalFetched = stats.reduce((sum, s) => sum + s.hackathons.fetched + s.internships.fetched, 0)
    const totalEnriched = stats.reduce((sum, s) => sum + s.hackathons.enriched + s.internships.enriched, 0)
    
    res.json({
      totalFetched,
      totalEnriched,
      totalPending: totalFetched - totalEnriched,
      platforms: stats,
    })
  } catch (error) {
    console.error('Fetch stats error:', error)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// Helper: save fetched items to DB
async function saveItems(items: any[], adminId: string, collegeId: string | null) {
  let hackathonSaved = 0, internshipSaved = 0, skipped = 0

  for (const opp of items) {
    if (!opp.url || !opp.title) { skipped++; continue }
    try {
      if (opp.type === 'HACKATHON') {
        const existing = await prisma.hackathonStaging.findFirst({
          where: { title: opp.title, source: opp.source },
        })
        if (existing) { skipped++; continue }

        await prisma.hackathonStaging.create({
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
            themes: JSON.stringify(opp.themes || []),
            website: opp.website || null,
            discord: opp.discord || null,
            participantsCount: opp.participantsCount || 0,
            inviteOnly: opp.inviteOnly || false,
            status: 'DRAFT',
            source: opp.source,
            creatorId: adminId,
            collegeId: collegeId,
          },
        })
        hackathonSaved++
      } else {
        const existing = await prisma.internshipStaging.findFirst({
          where: { title: opp.title, source: opp.source },
        })
        if (existing) { skipped++; continue }

        await prisma.internshipStaging.create({
          data: {
            title: opp.title,
            description: opp.description || 'No description available',
            company: opp.company || opp.organizer || 'Unknown',
            role: opp.role || opp.title,
            url: opp.url,
            stipend: opp.stipend || null,
            duration: opp.duration || null,
            mode: opp.mode || 'REMOTE',
            deadline: opp.deadline || null,
            startDate: opp.startDate || null,
            status: 'ACTIVE',
            source: opp.source,
            creatorId: adminId,
            collegeId: collegeId,
          },
        })
        internshipSaved++
      }
    } catch { skipped++ }
  }

  return { hackathonSaved, internshipSaved, skipped }
}

// POST /api/fetch/all - Fetch from all platforms
// Body: { limits?: Record<string, number> } — 0 = all, 1-50 = max items
router.post('/all', async (req, res) => {
  try {
    const limits = req.body.limits || {}
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
    if (!admin) return res.status(400).json({ error: 'No admin user found' })

    console.log('[Fetch] Starting fetch from all platforms...', limits)
    const result = await fetchFromAllSources()

    // Apply per-platform limits
    const counts: Record<string, number> = {}
    const limited = result.filter(item => {
      const limit = limits[item.source]
      if (!limit || limit === 0) return true
      counts[item.source] = (counts[item.source] || 0) + 1
      return counts[item.source] <= limit
    })

    const saved = await saveItems(limited, admin.id, admin.collegeId)
    const total = saved.hackathonSaved + saved.internshipSaved
    console.log(`[Fetch] Saved ${total} items (${saved.hackathonSaved} hackathons, ${saved.internshipSaved} internships), ${saved.skipped} skipped`)

    // Auto-enrich all pending items
    console.log('[Fetch] Auto-enriching all pending items...')
    const enriched = await enrichAllPending()
    console.log(`[Fetch] Auto-enrich done: ${enriched.hackEnriched} hackathons, ${enriched.intEnriched} internships`)

    res.json({
      success: true,
      fetched: limited.length,
      saved: total,
      hackathons: saved.hackathonSaved,
      internships: saved.internshipSaved,
      skipped: saved.skipped,
      enriched: enriched.hackEnriched + enriched.intEnriched,
    })
  } catch (error) {
    console.error('Fetch all error:', error)
    res.status(500).json({ error: 'Failed to fetch from all platforms' })
  }
})

// POST /api/fetch/:platform - Fetch from specific platform
// Body: { limit?: number } — 0 = all, otherwise max items
router.post('/:platform', async (req, res) => {
  try {
    const { platform } = req.params
    const limit = req.body.limit || 0
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
    if (!admin) return res.status(400).json({ error: 'No admin user found' })

    console.log(`[Fetch] Fetching from ${platform} (limit: ${limit || 'all'})...`)
    const result = await fetchFromPlatform(platform, limit > 0 ? limit : undefined)

    // Apply limit (fallback if scraper didn't honor it)
    const items = limit > 0 ? result.slice(0, limit) : result

    const saved = await saveItems(items, admin.id, admin.collegeId)
    const total = saved.hackathonSaved + saved.internshipSaved
    console.log(`[Fetch] Saved ${total} items from ${platform}`)

    // Auto-enrich only items from this platform
    const enriched = await enrichAllPending(platform.toUpperCase())
    console.log(`[Fetch] Auto-enrich done: ${enriched.hackEnriched} hackathons, ${enriched.intEnriched} internships`)

    res.json({
      success: true,
      fetched: items.length,
      saved: total,
      hackathons: saved.hackathonSaved,
      internships: saved.internshipSaved,
      skipped: saved.skipped,
      enriched: enriched.hackEnriched + enriched.intEnriched,
    })
  } catch (error) {
    console.error(`Fetch ${req.params.platform} error:`, error)
    res.status(500).json({ error: `Failed to fetch from ${req.params.platform}` })
  }
})

// POST /api/fetch/hackathons/enrich - Enrich pending hackathons
// Query: ?source=devfolio&limit=5 (both optional)
// Skips ended deadlines, prioritizes near-deadline first, auto-rejects ended
router.post('/hackathons/enrich', async (req, res) => {
  try {
    const { source, limit: limitStr } = req.query
    const limit = limitStr ? parseInt(String(limitStr)) : 0
    const label = source ? `from ${source}` : 'all'
    const today = new Date()
    console.log(`[Fetch] Enriching pending hackathons (${label}${limit ? `, limit ${limit}` : ''})...`)
    
    // Auto-reject ended
    const rejected = await prisma.hackathonStaging.updateMany({
      where: { deadline: { lt: today }, status: { notIn: ['APPROVED', 'REJECTED'] } },
      data: { status: 'REJECTED' },
    })
    if (rejected.count > 0) console.log(`[Fetch] Auto-rejected ${rejected.count} ended hackathons`)
    
    let enriched = 0
    const BATCH_SIZE = 5
    while (true) {
      const where: any = {
        OR: [{ description: '' }, { targetDepartments: '[]' }],
        AND: [{ OR: [{ deadline: null }, { deadline: { gte: today } }] }],
      }
      if (source) where.source = String(source).toUpperCase()
      const take = limit > 0 ? Math.min(BATCH_SIZE, limit - enriched) : BATCH_SIZE
      if (take <= 0) break
      const pending = await prisma.hackathonStaging.findMany({
        where,
        orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
        take,
      })
      if (pending.length === 0) break
      await Promise.all(pending.map(h => enrichHackathonStaging(h.id)))
      enriched += pending.length
    }
    
    res.json({ success: true, enriched, rejected: rejected.count, message: `Enriched ${enriched}, rejected ${rejected.count} ended` })
  } catch (error) {
    console.error('Enrich hackathons error:', error)
    res.status(500).json({ error: 'Failed to enrich hackathons' })
  }
})

// POST /api/fetch/internships/enrich - Enrich pending internships
// Query: ?source=devfolio&limit=5 (both optional)
// Skips ended deadlines, prioritizes near-deadline first, auto-rejects ended
router.post('/internships/enrich', async (req, res) => {
  try {
    const { source, limit: limitStr } = req.query
    const limit = limitStr ? parseInt(String(limitStr)) : 0
    const label = source ? `from ${source}` : 'all'
    const today = new Date()
    console.log(`[Fetch] Enriching pending internships (${label}${limit ? `, limit ${limit}` : ''})...`)
    
    // Auto-reject ended
    const rejected = await prisma.internshipStaging.updateMany({
      where: { deadline: { lt: today.toISOString().slice(0, 10) }, status: { notIn: ['APPROVED', 'REJECTED'] } },
      data: { status: 'REJECTED' },
    })
    if (rejected.count > 0) console.log(`[Fetch] Auto-rejected ${rejected.count} ended internships`)
    
    let enriched = 0
    const BATCH_SIZE = 5
    while (true) {
      const where: any = {
        OR: [{ description: '' }, { targetDepartments: '[]' }],
        AND: [{ OR: [{ deadline: null }, { deadline: { gte: today.toISOString().slice(0, 10) } }] }],
      }
      if (source) where.source = String(source).toUpperCase()
      const take = limit > 0 ? Math.min(BATCH_SIZE, limit - enriched) : BATCH_SIZE
      if (take <= 0) break
      const pending = await prisma.internshipStaging.findMany({
        where,
        orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
        take,
      })
      if (pending.length === 0) break
      await Promise.all(pending.map(i => enrichInternshipStaging(i.id)))
      enriched += pending.length
    }
    
    res.json({ success: true, enriched, rejected: rejected.count, message: `Enriched ${enriched}, rejected ${rejected.count} ended` })
  } catch (error) {
    console.error('Enrich internships error:', error)
    res.status(500).json({ error: 'Failed to enrich internships' })
  }
})

// GET /api/fetch/:platform/hackathons - Get hackathons from platform
router.get('/:platform/hackathons', async (req, res) => {
  try {
    const { platform } = req.params
    const items = await prisma.hackathonStaging.findMany({
      where: { source: platform.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ items, count: items.length })
  } catch (error) {
    console.error(`Get ${req.params.platform} hackathons error:`, error)
    res.status(500).json({ error: 'Failed to fetch items' })
  }
})

// GET /api/fetch/:platform/internships - Get internships from platform
router.get('/:platform/internships', async (req, res) => {
  try {
    const { platform } = req.params
    const items = await prisma.internshipStaging.findMany({
      where: { source: platform.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ items, count: items.length })
  } catch (error) {
    console.error(`Get ${req.params.platform} internships error:`, error)
    res.status(500).json({ error: 'Failed to fetch items' })
  }
})

// PUT /api/fetch/:platform/limit - Update platform fetch limit
router.put('/:platform/limit', async (req, res) => {
  try {
    const { platform } = req.params
    const { limit, type } = req.body
    
    if (limit === undefined || !type) {
      res.status(400).json({ error: 'limit and type are required' })
      return
    }

    const settings = await prisma.platformSettings.upsert({
      where: {
        platform_type: { platform: platform.toUpperCase(), type }
      },
      update: { fetchLimit: limit },
      create: { platform: platform.toUpperCase(), type, fetchLimit: limit },
    })

    res.json({ success: true, settings })
  } catch (error) {
    console.error('Update limit error:', error)
    res.status(500).json({ error: 'Failed to update limit' })
  }
})

// GET /api/fetch/settings/all - Get all platform settings
router.get('/settings/all', async (req, res) => {
  try {
    const settings = await prisma.platformSettings.findMany()
    res.json({ settings })
  } catch (error) {
    console.error('Get settings error:', error)
    res.status(500).json({ error: 'Failed to get settings' })
  }
})

export default router
