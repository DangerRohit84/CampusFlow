import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { isPrismaNotFound } from '../lib/prismaErrors'

const router = Router()
router.use(authenticate)

// @deprecated — canonical notifications live at GET /rooms/notifications/list
// (RoomNotification, socket `notification:new` with real ids). This legacy
// /api/notifications router is kept for backward compat and now:
// - emits `Deprecation: true` + `Sunset` headers (popular-site parity)
// - caps list reads (take:50 + cursor) instead of unbounded findMany
// - proxies shape-compatible reads where possible; writes still hit legacy table.
// Sunset: Sat, 31 Dec 2026 23:59:59 GMT — migrate callers to /rooms/notifications/list.
router.use((_req, res, next) => {
  res.setHeader('Deprecation', 'true')
  res.setHeader('Sunset', 'Sat, 31 Dec 2026 23:59:59 GMT')
  res.setHeader('Link', '</api/rooms/notifications/list>; rel="successor-version"')
  next()
})

// Get all notifications (cursor pagination take:50 + count)
// 10k scale: (userId, read, createdAt) composite index (see schema) serves
// both the unread filter and the desc sort. Dual-mode: no query → capped
// array (compat); ?cursor/?limit/?page → envelope with total+nextCursor.
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { unread, cursor, limit, page } = req.query
    const take = Math.min(50, Math.max(1, parseInt(String(limit || '50'), 10) || 50))
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1)
    const wantsPaged = cursor != null || limit != null || page != null
    const where: any = { userId: req.userId }
    if (unread === 'true') where.read = false

    const cursorClause: any = cursor
      ? { cursor: { id: String(cursor) }, skip: 1 }
      : { skip: (pageNum - 1) * take }
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        ...cursorClause,
      }),
      prisma.notification.count({ where }),
    ])
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    if (wantsPaged) {
      const pages = Math.ceil(total / take)
      const nextCursor =
        notifications.length === take ? (notifications[notifications.length - 1] as any)?.id ?? null : null
      res.json({ data: notifications, pagination: { page: pageNum, limit: take, total, pages, nextCursor } })
      return
    }
    res.set('X-Total-Count', String(total))
    res.json(notifications)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// Get unread count
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.userId, read: false },
    })
    // CACHE-ALL: own unread count — private edge SWR 10s (same TTL as list, notifications.ts:47 pattern).
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({ count })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch count' })
  }
})

// Mark as read
router.put('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const notification = await prisma.notification.update({
      where: { id: req.params.id as string, userId: req.userId },
      data: { read: true },
    })
    res.json(notification)
  } catch (error) {
    // topbottom F4: missing/not-owned row (P2025) is 404, not 500.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Notification not found' })
      return
    }
    res.status(500).json({ error: 'Failed to mark as read' })
  }
})

// Mark all as read
router.put('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.userId, read: false },
      data: { read: true },
    })
    res.json({ message: 'All notifications marked as read' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark all as read' })
  }
})

// Delete notification
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.delete({
      where: { id: req.params.id as string, userId: req.userId },
    })
    res.json({ message: 'Notification deleted' })
  } catch (error) {
    // topbottom F4: missing/not-owned row (P2025) is 404, not 500.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Notification not found' })
      return
    }
    res.status(500).json({ error: 'Failed to delete notification' })
  }
})

export default router