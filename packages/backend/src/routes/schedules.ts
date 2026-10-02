import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { broadcastScheduleMutation } from '../services/socket'
import { timeToMinutes } from '../lib/validators'
import { toScheduleTypeEnum } from '../lib/enums'
import { isPrismaNotFound } from '../lib/prismaErrors'
import { validateOverrideInput, mergeTimetableForRange, findClashes, toDateKey } from '../lib/timetableMerge'
import { logger } from '../utils/logger'

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

// ---- Timetable overrides (Approach A, additive 20261002) ----
// Registered BEFORE /:id-style routes (explicit first, avoids param capture).

const overrideKindEnum = z.enum(['EDITED', 'CANCELLED', 'ADDED_TEMP'])

const overrideSchema = z.object({
  kind: overrideKindEnum,
  baseScheduleId: z.string().optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  course: z.string().max(100).optional().nullable(),
  location: z.string().max(100).optional().nullable(),
  teacher: z.string().max(100).optional().nullable(),
  type: z.string().optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  validFrom: z.string().min(8).max(30),
  validUntil: z.string().min(8).max(30),
  startTime: z.string().max(10).optional().nullable(),
  endTime: z.string().max(10).optional().nullable(),
})

function overrideDelegate(): any {
  return (prisma as any).scheduleOverride
}

function toUtcMidnight(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

function coerceOverrideType(v: unknown): any | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined
  try {
    return toScheduleTypeEnum(v)
  } catch {
    return toScheduleTypeEnum('CLASS')
  }
}

// List overrides (owner-only). ?from=&to= filters overlapping range.
router.get('/overrides', async (req: AuthRequest, res: Response) => {
  try {
    const delegate = overrideDelegate()
    if (!delegate) {
      res.json([])
      return
    }
    const fromKey = typeof req.query.from === 'string' ? req.query.from.slice(0, 10) : undefined
    const toKey = typeof req.query.to === 'string' ? req.query.to.slice(0, 10) : undefined
    const where: any = { userId: req.userId }
    if (fromKey && toKey && /^\d{4}-\d{2}-\d{2}$/.test(fromKey) && /^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
      where.AND = [{ validFrom: { lte: toUtcMidnight(toKey) } }, { validUntil: { gte: toUtcMidnight(fromKey) } }]
    }
    const rows = await delegate.findMany({ where, orderBy: [{ validFrom: 'asc' }, { startTime: 'asc' }] })
    res.json(rows)
  } catch (error: any) {
    // Pre-migration: table/client missing → degrade to [] (templates-only).
    const msg = String(error?.message || error?.code || '')
    if ((error as any)?.code === 'P2021' || /does not exist|Unknown argument|scheduleOverride/i.test(msg)) {
      res.json([])
      return
    }
    res.status(500).json({ error: 'Failed to fetch overrides' })
  }
})

// Create override (owner-only). Returns { override, warnings } (soft clash, non-blocking).
router.post('/overrides', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = overrideSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.errors })
      return
    }
    const body = parsed.data as any
    const businessErr = validateOverrideInput(body)
    if (businessErr) {
      res.status(400).json({ error: businessErr })
      return
    }
    const delegate = overrideDelegate()
    if (!delegate || typeof delegate.create !== 'function') {
      res.status(503).json({ error: 'Overrides unavailable (migration pending)' })
      return
    }
    const kind = String(body.kind).toUpperCase()
    // Owner-only: EDITED/CANCELLED must reference own template.
    if (kind === 'EDITED' || kind === 'CANCELLED') {
      const base = await prisma.schedule.findFirst({ where: { id: body.baseScheduleId, userId: req.userId } })
      if (!base) {
        res.status(404).json({ error: 'Base schedule not found' })
        return
      }
    }
    const fromKey = toDateKey(body.validFrom)!
    const untilKey = toDateKey(body.validUntil)!
    const sm = body.startTime ? timeToMinutes(body.startTime) : null
    const em = body.endTime ? timeToMinutes(body.endTime) : null
    const coercedType = coerceOverrideType(body.type)
    const created = await delegate.create({
      data: {
        userId: req.userId!,
        baseScheduleId: body.baseScheduleId || null,
        kind,
        title: body.title || null,
        course: body.course || null,
        location: body.location || null,
        teacher: body.teacher || null,
        ...(coercedType ? { type: coercedType } : {}),
        color: body.color || null,
        dayOfWeek: body.dayOfWeek ?? null,
        validFrom: toUtcMidnight(fromKey),
        validUntil: toUtcMidnight(untilKey),
        startTime: body.startTime || null,
        endTime: body.endTime || null,
        ...(sm !== null ? { startMinutes: sm } : {}),
        ...(em !== null ? { endMinutes: em } : {}),
      },
    })
    // Soft clash warnings across the new range (non-blocking).
    let warnings: any[] = []
    try {
      const templates = await prisma.schedule.findMany({ where: { userId: req.userId } })
      const existing = await delegate.findMany({ where: { userId: req.userId } })
      const withNew = [...(existing || []).filter((o: any) => o.id !== created.id), created]
      const merged = mergeTimetableForRange(templates as any, withNew as any, fromKey, untilKey)
      const byDate = new Map<string, any[]>()
      for (const e of merged) {
        const k = String((e as any).date || fromKey)
        if (!byDate.has(k)) byDate.set(k, [])
        byDate.get(k)!.push(e)
      }
      for (const [date, list] of byDate) {
        for (const w of findClashes(list)) warnings.push({ date, ...w })
        if (warnings.length >= 10) break
      }
    } catch {}
    try { broadcastScheduleMutation({ action: 'override:created', scheduleId: created.id, userId: req.userId }) } catch {}
    res.status(201).json({ override: created, warnings })
  } catch (error: any) {
    const msg = String(error?.message || error?.code || '')
    if ((error as any)?.code === 'P2021' || /does not exist|Unknown argument|scheduleOverride/i.test(msg)) {
      res.status(503).json({ error: 'Overrides unavailable (migration pending)' })
      return
    }
    logger.error({ err: error }, 'Create override error:')
    res.status(500).json({ error: 'Failed to create override' })
  }
})

// Update override (owner-only, partial).
router.put('/overrides/:id', async (req: AuthRequest, res: Response) => {
  try {
    const delegate = overrideDelegate()
    if (!delegate || typeof delegate.findFirst !== 'function') {
      res.status(503).json({ error: 'Overrides unavailable (migration pending)' })
      return
    }
    const existing = await delegate.findFirst({ where: { id: req.params.id as string, userId: req.userId } })
    if (!existing) {
      res.status(404).json({ error: 'Override not found' })
      return
    }
    const partial = overrideSchema.partial().safeParse(req.body)
    if (!partial.success) {
      res.status(400).json({ error: 'Validation error', details: partial.error.errors })
      return
    }
    const next = { ...existing, ...partial.data }
    // Normalize Dates → keys for business validation
    const normForCheck = {
      ...next,
      validFrom: next.validFrom instanceof Date ? next.validFrom.toISOString().slice(0, 10) : next.validFrom,
      validUntil: next.validUntil instanceof Date ? next.validUntil.toISOString().slice(0, 10) : next.validUntil,
    }
    const businessErr = validateOverrideInput(normForCheck)
    if (businessErr) {
      res.status(400).json({ error: businessErr })
      return
    }
    const data: any = {}
    for (const k of ['kind', 'baseScheduleId', 'title', 'course', 'location', 'teacher', 'color', 'dayOfWeek', 'startTime', 'endTime'] as const) {
      if ((partial.data as any)[k] !== undefined) data[k] = (partial.data as any)[k]
    }
    if ((partial.data as any).type !== undefined) {
      const t = coerceOverrideType((partial.data as any).type)
      if (t) data.type = t
    }
    if ((partial.data as any).validFrom !== undefined) {
      const k = toDateKey((partial.data as any).validFrom)
      if (k) data.validFrom = toUtcMidnight(k)
    }
    if ((partial.data as any).validUntil !== undefined) {
      const k = toDateKey((partial.data as any).validUntil)
      if (k) data.validUntil = toUtcMidnight(k)
    }
    if ((partial.data as any).startTime !== undefined) {
      const m = timeToMinutes((partial.data as any).startTime)
      data.startMinutes = m
    }
    if ((partial.data as any).endTime !== undefined) {
      const m = timeToMinutes((partial.data as any).endTime)
      data.endMinutes = m
    }
    if (data.kind) data.kind = String(data.kind).toUpperCase()
    const updated = await delegate.update({ where: { id: req.params.id as string }, data })
    try { broadcastScheduleMutation({ action: 'override:updated', scheduleId: updated.id, userId: req.userId }) } catch {}
    res.json({ override: updated, warnings: [] })
  } catch (error: any) {
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Override not found' })
      return
    }
    res.status(500).json({ error: 'Failed to update override' })
  }
})

// Revert override (owner-only delete).
router.delete('/overrides/:id', async (req: AuthRequest, res: Response) => {
  try {
    const delegate = overrideDelegate()
    if (!delegate || typeof delegate.delete !== 'function') {
      res.status(503).json({ error: 'Overrides unavailable (migration pending)' })
      return
    }
    await delegate.delete({ where: { id: req.params.id as string, userId: req.userId } })
    try { broadcastScheduleMutation({ action: 'override:deleted', scheduleId: req.params.id as string, userId: req.userId }) } catch {}
    res.json({ message: 'Override reverted' })
  } catch (error) {
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Override not found' })
      return
    }
    // Mocked delete on missing/owned row may throw generic — map to 404 when P2025-like
    res.status(500).json({ error: 'Failed to revert override' })
  }
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