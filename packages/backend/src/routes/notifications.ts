import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

// Get all notifications
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { unread } = req.query
    const where: any = { userId: req.userId }
    if (unread === 'true') where.read = false

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
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
    res.json({ count })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch count' })
  }
})

// Mark as read
router.put('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const notification = await prisma.notification.update({
      where: { id: req.params.id, userId: req.userId },
      data: { read: true },
    })
    res.json(notification)
  } catch (error) {
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
      where: { id: req.params.id, userId: req.userId },
    })
    res.json({ message: 'Notification deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' })
  }
})

export default router