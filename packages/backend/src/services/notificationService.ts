import prisma from '../config/db'
import { emitNotification } from './socket'

export async function notifyUsers(
  userIds: string[],
  n: { title: string; message: string; type?: string; priority?: string; source?: string }
) {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return

  await prisma.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      title: n.title,
      message: n.message,
      type: n.type || 'GENERAL',
      priority: n.priority || 'MEDIUM',
      source: n.source || null,
    })),
  })

  for (const userId of unique) {
    try {
      emitNotification(userId, {
        id: '',
        title: n.title,
        message: n.message,
        type: n.type || 'GENERAL',
        priority: n.priority || 'MEDIUM',
        createdAt: new Date(),
      })
    } catch {
      // Socket emit failure is non-critical — notification is already persisted
    }
  }
}

export async function notifyUser(
  userId: string,
  n: { title: string; message: string; type?: string; priority?: string; source?: string }
) {
  return notifyUsers([userId], n)
}
