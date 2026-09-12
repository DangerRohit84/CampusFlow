import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { broadcastScheduleMutation } from '../services/socket'
import { timeToMinutes } from '../lib/validators'
import { toScheduleTypeEnum } from '../lib/enums'
import { isPrismaNotFound } from '../lib/prismaErrors'

const router = Router()
router.use(authenticate)

const scheduleSchema = z.object({
  title: z.string(),
  course: z.string().optional(),
  location: z.string().optional(),
  dayOfWeek: z.number().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
  // Order 12: ScheduleType enum — Repair 20260926020000 expands to CLASS/LAB/
  // SEMINAR/OTHER — preserve all four real values (seed: Placement Prep SEMINAR,
  // Club Meeting OTHER), coerce only true ghosts to CLASS so the DB enum never
  // 500s on legacy/AI free text (timetable.ts does the same).
  type: z.string().default('CLASS').transform((v) => {
    const up = String(v ?? 'CLASS').trim().toUpperCase();
    return up === 'LAB' ? 'LAB' : up === 'SEMINAR' ? 'SEMINAR' : up === 'OTHER' ? 'OTHER' : 'CLASS';
  }),
  color: z.string().optional(),
  recurring: z.boolean().default(true),
})

// Get all schedules
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { userId: req.userId },
      // Order 8: order by typed minutes (nulls last via String fallback for legacy rows).
      orderBy: [{ dayOfWeek: 'asc' }, { startMinutes: 'asc' }, { startTime: 'asc' }],
    })
    res.json(schedules)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedules' })
  }
})

// Get schedule by day
router.get('/day/:dayOfWeek', async (req: AuthRequest, res: Response) => {
  try {
    const dayOfWeek = parseInt(req.params.dayOfWeek as string)
    const schedules = await prisma.schedule.findMany({
      where: { userId: req.userId, dayOfWeek },
      orderBy: [{ startMinutes: 'asc' }, { startTime: 'asc' }],
    })
    res.json(schedules)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedules' })
  }
})

// Create schedule
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = scheduleSchema.parse(req.body)
    // Order 8 dual-write: String times + typed minutes (CHECK 0-1439).
    const _sm = timeToMinutes((body as any).startTime)
    const _em = timeToMinutes((body as any).endTime)
    // body.type already coerced to CLASS/LAB/SEMINAR/OTHER; re-validate
    // against the REAL ScheduleType enum (stale-client `as any` removed).
    const schedule = await prisma.schedule.create({
      data: { ...body, type: toScheduleTypeEnum((body as any).type), userId: req.userId!, ...(_sm !== null ? { startMinutes: _sm } : {}), ...(_em !== null ? { endMinutes: _em } : {}) },
    })
    try { broadcastScheduleMutation({ action: 'created', scheduleId: schedule.id, userId: req.userId }) } catch {}
    res.status(201).json(schedule)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to create schedule' })
  }
})

// Update schedule
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const body = scheduleSchema.partial().parse(req.body)
    // Order 8 dual-write on update (only when times provided).
    const _u: any = { ...body }
    if ((body as any).type !== undefined) _u.type = toScheduleTypeEnum((body as any).type)
    if ((body as any).startTime !== undefined) { const _m = timeToMinutes((body as any).startTime); _u.startMinutes = _m }
    if ((body as any).endTime !== undefined) { const _m2 = timeToMinutes((body as any).endTime); _u.endMinutes = _m2 }
    const schedule = await prisma.schedule.update({
      where: { id: req.params.id as string, userId: req.userId },
      data: _u,
    })
    try { broadcastScheduleMutation({ action: 'updated', scheduleId: schedule.id, userId: req.userId }) } catch {}
    res.json(schedule)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    // topbottom F4: scoped update on missing/not-owned row (P2025) is 404, not 500.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Schedule not found' })
      return
    }
    res.status(500).json({ error: 'Failed to update schedule' })
  }
})

// Delete schedule
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.schedule.delete({
      where: { id: req.params.id as string, userId: req.userId },
    })
    try { broadcastScheduleMutation({ action: 'deleted', scheduleId: req.params.id as string, userId: req.userId }) } catch {}
    res.json({ message: 'Schedule deleted' })
  } catch (error) {
    // topbottom F4: missing/not-owned row (P2025) is 404, not 500.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Schedule not found' })
      return
    }
    res.status(500).json({ error: 'Failed to delete schedule' })
  }
})

export default router