// routes/colleges.ts — public college router (SRP extract from index.ts).
// WHY: index.ts (composition root) contained 4 inline college handlers +
// duplicate /list vs /public. Single router here; index.ts only mounts it.
// Behavior identical; validation/error shapes preserved.

import { Router, Request, Response } from 'express'
import prisma from '../config/db'
import { logger } from '../utils/logger'
import { normalizeEmail } from '../utils/authHardening'

const router = Router()

// Public: Register college (no auth required) - rate limited at mount site.
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, code, address, phone, website, adminEmail } = req.body as {
      name?: string
      code?: string
      address?: string
      phone?: string
      website?: string
      adminEmail?: string
    }

    if (!name || !code || !adminEmail) {
      res.status(400).json({ error: 'Name, code, and admin email are required' })
      return
    }

    const existing = await prisma.college.findFirst({
      where: { OR: [{ name }, { code }] },
    })
    if (existing) {
      res.status(400).json({ error: 'College name or code already exists' })
      return
    }

    const college = await prisma.college.create({
      // EMAIL-CASE FIX: store adminEmail normalized so the register
      // COLLEGE_ADMIN comparison (normalizeEmail both sides in auth.ts)
      // matches regardless of input case/whitespace. Legacy mixed-case rows
      // stay as-is until a backfill + citext/lower() index lands (no migrate here).
      data: { name, code, address, phone, website, adminEmail: normalizeEmail(adminEmail), status: 'PENDING' },
    })

    res.status(201).json(college)
  } catch {
    logger.error({ route: 'POST /api/colleges/register' }, 'Public college register error')
    res.status(500).json({ error: 'Failed to register college' })
  }
})

// Public: List approved colleges for registration dropdown (no auth required)
async function listApproved(_req: Request, res: Response, route: string): Promise<void> {
  try {
    const colleges = await prisma.college.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    res.json(colleges)
  } catch {
    logger.error({ route }, 'Public college list error')
    res.status(500).json({ error: 'Failed to fetch colleges' })
  }
}

router.get('/list', (req, res) => listApproved(req, res, 'GET /api/colleges/list'))
// Alias for legacy frontend (backward compat for rolling deploys)
router.get('/public', (req, res) => listApproved(req, res, 'GET /api/colleges/public'))

// Public: Get departments for a college (no auth required)
router.get('/:id/departments', async (req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      where: { collegeId: String(req.params.id) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    res.json(departments)
  } catch {
    logger.error({ route: 'GET /api/colleges/:id/departments' }, 'Public college departments error')
    res.status(500).json({ error: 'Failed to fetch departments' })
  }
})

export default router
