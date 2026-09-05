import { Router, Request, Response } from 'express'
import { timingSafeEqual } from 'crypto'
import prisma from '../config/db'
import { fetchAndStoreContests } from '../services/contestFetcher'
import { syncAllUsers } from '../services/syncEngine'
import { fetchFromAllSources, enrichHackathonStaging, enrichInternshipStaging } from '../services/opportunityAgent'

const ENRICH_DELAY_MS = 12000

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function requireCronSecret(req: Request, res: Response, next: () => void) {
  const secret = process.env.CRON_SECRET
  // Fail closed ALWAYS: without a secret these endpoints trigger external API
  // scraping, bulk DB writes, and deleteMany jobs - never serve them unauthenticated.
  // Local devs must set CRON_SECRET in .env to use these endpoints.
  if (!secret) {
    res.status(503).json({ error: 'Cron secret not configured' })
    return
  }
  const provided = req.get('x-cron-secret')
  if (!provided || !secretsMatch(provided, secret)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

export async function runContestsJob(): Promise<{ fetched: number; updated: number }> {
  console.log('[Cron] Running contest fetch...')
  return fetchAndStoreContests()
}

export async function runProfileSyncJob(): Promise<{ totalUsers: number; totalSynced: number }> {
  console.log('[CRON] Starting contest participation sync...')
  const result = await syncAllUsers()
  console.log(`[CRON] Synced ${result.totalSynced} records from ${result.totalUsers} users`)
  return result
}

export interface OpportunitiesJobResult {
  hackathonsFetched: number
  hackathonsSkipped: number
  internshipsFetched: number
  internshipsSkipped: number
  hackathonsEnriched: number
  internshipsEnriched: number
}

export async function runOpportunitiesJob(): Promise<OpportunitiesJobResult> {
  // BUILD MODE: Other Sources detached - cron fetches ONLY 5 fixed platforms via fetchFromAllSources (DEVFOLIO/DEVPOST/MLH/UNSTOP/INTERNSHALA).
  // OTHER_HACKATHON / OTHER_INTERNSHIP are NOT fetched here; manual only via POST /fetch/other/* (detached per user request).
  console.log('[Cron] Fetching opportunities from external sources...')

  // Find an admin to own the staging records
  const admin = await prisma.user.findFirst({
    where: { role: { in: ['SUPER_ADMIN', 'COLLEGE_ADMIN'] } },
  })
  if (!admin) {
    console.log('[Cron] No admin user found, skipping opportunity fetch')
    return { hackathonsFetched: 0, hackathonsSkipped: 0, internshipsFetched: 0, internshipsSkipped: 0, hackathonsEnriched: 0, internshipsEnriched: 0 }
  }

  const allOpps = await fetchFromAllSources()
  let hackathonFetched = 0, hackathonSkipped = 0
  let internshipFetched = 0, internshipSkipped = 0
  const hackathonIdsToEnrich: string[] = []
  const internshipIdsToEnrich: string[] = []

  // Process hackathons
  const hackathons = allOpps.filter(o => o.type === 'HACKATHON')
  for (const opp of hackathons) {
    if (!opp.url || !opp.title) { hackathonSkipped++; continue }
    try {
      const existing = await prisma.hackathonStaging.findFirst({
        where: { title: opp.title, source: opp.source },
      })
      if (existing) { hackathonSkipped++; continue }

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
          themes: JSON.stringify(opp.themes || []),
          website: opp.website || null,
          discord: opp.discord || null,
          participantsCount: opp.participantsCount || 0,
          inviteOnly: opp.inviteOnly || false,
          status: 'DRAFT',
          source: opp.source,
          creatorId: admin.id,
          collegeId: admin.collegeId!,
        },
      })
      hackathonFetched++
      hackathonIdsToEnrich.push(created.id)
    } catch { hackathonSkipped++ }
  }

  // Process internships
  const internships = allOpps.filter(o => o.type === 'INTERNSHIP')
  for (const opp of internships) {
    if (!opp.url || !opp.title) { internshipSkipped++; continue }
    try {
      const existing = await prisma.internshipStaging.findFirst({
        where: { title: opp.title, source: opp.source },
      })
      if (existing) { internshipSkipped++; continue }

      const created = await prisma.internshipStaging.create({
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
          creatorId: admin.id,
          collegeId: admin.collegeId!,
        },
      })
      internshipFetched++
      internshipIdsToEnrich.push(created.id)
    } catch { internshipSkipped++ }
  }

  console.log(`[Cron] Opportunities: ${hackathonFetched} hackathons + ${internshipFetched} internships fetched, ${hackathonSkipped + internshipSkipped} skipped`)

  // Enrich sequentially with delay between each to avoid rate limits
  async function enrichSequentially(ids: string[], enrichFn: (id: string) => Promise<void>, label: string) {
    let enriched = 0
    for (let i = 0; i < ids.length; i++) {
      console.log(`[Cron] Enriching ${label} ${i + 1}/${ids.length}`)
      try {
        await enrichFn(ids[i])
        enriched++
      } catch { /* individual enrichment failures are ignored */ }
      if (i < ids.length - 1) {
        await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
      }
    }
    return enriched
  }

  const hackathonsEnriched = await enrichSequentially(hackathonIdsToEnrich, enrichHackathonStaging, 'hackathons')
  const internshipsEnriched = await enrichSequentially(internshipIdsToEnrich, enrichInternshipStaging, 'internships')

  return {
    hackathonsFetched: hackathonFetched,
    hackathonsSkipped: hackathonSkipped,
    internshipsFetched: internshipFetched,
    internshipsSkipped: internshipSkipped,
    hackathonsEnriched,
    internshipsEnriched,
  }
}

export async function runCleanupJob(): Promise<{ hackathonsDeleted: number; internshipsDeleted: number }> {
  console.log('[Cron] Cleaning up old rejected items...')
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const hackDeleted = await prisma.hackathonStaging.deleteMany({
    where: { status: 'REJECTED', updatedAt: { lt: cutoff } },
  })
  const intDeleted = await prisma.internshipStaging.deleteMany({
    where: { status: 'REJECTED', updatedAt: { lt: cutoff } },
  })
  console.log(`[Cron] Cleanup: deleted ${hackDeleted.count} hackathons, ${intDeleted.count} internships older than 30 days`)
  return { hackathonsDeleted: hackDeleted.count, internshipsDeleted: intDeleted.count }
}

const router = Router()
router.use(requireCronSecret)

type JobRunner = () => Promise<object>

const handleJob = (job: string, runner: JobRunner) => async (_req: Request, res: Response) => {
  const startedAt = new Date().toISOString()
  try {
    const result = await runner()
    res.json({ ok: true, job, startedAt, finishedAt: new Date().toISOString(), ...result })
  } catch (err) {
    console.error(`[Cron] ${job} job failed:`, err)
    // Generic error only - raw messages can embed Prisma/DB internals; full error stays in server logs
    res.status(500).json({
      ok: false,
      job,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: 'Job execution failed',
    })
  }
}

router.post('/contests', handleJob('contests', runContestsJob))
router.post('/profile-sync', handleJob('profile-sync', runProfileSyncJob))
router.post('/opportunities', handleJob('opportunities', runOpportunitiesJob))
router.post('/cleanup', handleJob('cleanup', runCleanupJob))

export default router
