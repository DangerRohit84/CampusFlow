import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

// ─── GET /api/announcements/colleges — list colleges for super admin ──────────
router.get('/colleges', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }
    const colleges = await prisma.college.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    res.json(colleges)
  } catch (error: any) {
    console.error('Colleges list error:', error?.message || error)
    res.status(500).json({ error: 'Failed to fetch colleges' })
  }
})

// ─── POST /api/announcements — create ────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }
    if (!['TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      res.status(403).json({ error: 'Only teachers and admins can create announcements' })
      return
    }

    const { title, content, target, departmentIds, targetScope, collegeIds, publishAt, expiresAt } = req.body

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Title is required' })
      return
    }
    if (title.trim().length > 200) {
      res.status(400).json({ error: 'Title must be 200 characters or less' })
      return
    }
    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Content is required' })
      return
    }
    if (!target || !['ALL_DEPARTMENTS', 'SPECIFIC_DEPARTMENTS'].includes(target)) {
      res.status(400).json({ error: 'Target must be ALL_DEPARTMENTS or SPECIFIC_DEPARTMENTS' })
      return
    }

    // Validate schedule/expiry
    let publishAtDate: Date | null = null
    let expiresAtDate: Date | null = null
    if (publishAt) {
      publishAtDate = new Date(publishAt)
      if (isNaN(publishAtDate.getTime())) {
        res.status(400).json({ error: 'Invalid publishAt date' })
        return
      }
    }
    if (expiresAt) {
      expiresAtDate = new Date(expiresAt)
      if (isNaN(expiresAtDate.getTime())) {
        res.status(400).json({ error: 'Invalid expiresAt date' })
        return
      }
    }
    if (publishAtDate && expiresAtDate && expiresAtDate <= publishAtDate) {
      res.status(400).json({ error: 'expiresAt must be after publishAt' })
      return
    }

    const isSuperAdmin = user.role === 'SUPER_ADMIN'

    // Determine targetScope
    let effectiveScope: string = 'MY_COLLEGES'
    if (isSuperAdmin && targetScope) {
      if (!['ALL_COLLEGES', 'SPECIFIC_COLLEGES', 'MY_COLLEGES'].includes(targetScope)) {
        res.status(400).json({ error: 'Invalid targetScope' })
        return
      }
      effectiveScope = targetScope
    }

    // For super admin, collegeId on Announcement is null for cross-college targeting
    let announcementCollegeId: string | null = null
    if (!isSuperAdmin) {
      announcementCollegeId = user.collegeId
      if (!announcementCollegeId) {
        res.status(400).json({ error: 'College ID is required' })
        return
      }
    }

    // Validate department assignments (only for college-scoped)
    if (target === 'SPECIFIC_DEPARTMENTS') {
      if (!Array.isArray(departmentIds) || departmentIds.length === 0) {
        res.status(400).json({ error: 'At least one department is required for SPECIFIC_DEPARTMENTS target' })
        return
      }
      const deptCollegeId = isSuperAnnouncementCollegeId(announcementCollegeId, user)
      const validDepts = await prisma.department.findMany({
        where: {
          id: { in: departmentIds },
          collegeId: deptCollegeId,
        },
      })
      if (validDepts.length !== departmentIds.length) {
        res.status(400).json({ error: 'One or more department IDs are invalid for your college' })
        return
      }
    }

    // Validate collegeIds for SPECIFIC_COLLEGES
    if (isSuperAdmin && effectiveScope === 'SPECIFIC_COLLEGES') {
      if (!Array.isArray(collegeIds) || collegeIds.length === 0) {
        res.status(400).json({ error: 'At least one college is required for SPECIFIC_COLLEGES scope' })
        return
      }
      const validColleges = await prisma.college.findMany({
        where: { id: { in: collegeIds }, status: 'APPROVED' },
      })
      if (validColleges.length !== collegeIds.length) {
        res.status(400).json({ error: 'One or more college IDs are invalid' })
        return
      }
    }

    const announcement = await prisma.announcement.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        target,
        targetScope: effectiveScope as any,
        creatorId: user.id,
        collegeId: announcementCollegeId,
        publishAt: publishAtDate,
        expiresAt: expiresAtDate,
        ...(target === 'SPECIFIC_DEPARTMENTS' && departmentIds?.length
          ? {
              departments: {
                create: departmentIds.map((deptId: string) => ({
                  departmentId: deptId,
                })),
              },
            }
          : {}),
        ...(isSuperAdmin && effectiveScope === 'SPECIFIC_COLLEGES' && collegeIds?.length
          ? {
              colleges: {
                create: collegeIds.map((cid: string) => ({
                  collegeId: cid,
                })),
              },
            }
          : {}),
      },
      include: {
        creator: { select: { id: true, name: true, role: true, avatar: true } },
        departments: {
          include: { department: { select: { id: true, name: true } } },
        },
        colleges: {
          include: { college: { select: { id: true, name: true } } },
        },
      },
    })

    res.status(201).json(announcement)
  } catch (error: any) {
    console.error('Announcement create error:', error?.message || error)
    res.status(500).json({ error: 'Failed to create announcement' })
  }
})

// ─── Helper: build visibility where (reused for unreadCount + read-all) ────────
function buildAnnouncementWhere(user: any, filterCollegeId: string | undefined, now: Date): any {
  const base: any = {
    AND: [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  }
  const isSuperAdmin = user.role === 'SUPER_ADMIN'
  if (isSuperAdmin && !filterCollegeId) {
    const collegeConditions: any[] = [{ targetScope: 'ALL_COLLEGES' }]
    if (user.collegeId) {
      collegeConditions.push(
        { targetScope: 'MY_COLLEGES', collegeId: user.collegeId },
        { targetScope: 'SPECIFIC_COLLEGES', colleges: { some: { collegeId: user.collegeId } } }
      )
    }
    return { ...base, OR: collegeConditions }
  } else if (isSuperAdmin && filterCollegeId) {
    return {
      ...base,
      OR: [
        { collegeId: filterCollegeId },
        { colleges: { some: { collegeId: filterCollegeId } } },
      ],
    }
  } else {
    const collegeId = user.collegeId
    if (!collegeId) {
      return { ...base, targetScope: 'ALL_COLLEGES' }
    } else {
      return {
        ...base,
        OR: [
          { collegeId },
          { targetScope: 'ALL_COLLEGES' },
        ],
      }
    }
  }
}

// ─── GET /api/announcements — list for current user's college ────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10))
    const skip = (page - 1) * limit

    const filterCollegeId = req.query.collegeId as string | undefined
    const now = new Date()
    const where = buildAnnouncementWhere(user, filterCollegeId, now)
    const unreadWhere: any = { ...where, reads: { none: { userId: user.id } } }

    const [announcements, total, unreadCount] = await Promise.all([
      prisma.announcement.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true, role: true, avatar: true } },
          departments: {
            include: { department: { select: { id: true, name: true } } },
          },
          colleges: {
            include: { college: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.announcement.count({ where }),
      prisma.announcement.count({ where: unreadWhere }),
    ])

    const ids = announcements.map((a) => a.id)
    let readSet = new Set<string>()
    if (ids.length) {
      const reads = await prisma.announcementRead.findMany({
        where: { userId: user.id, announcementId: { in: ids } },
        select: { announcementId: true },
      })
      readSet = new Set(reads.map((r) => r.announcementId))
    }

    const withIsRead = announcements.map((a) => ({
      ...a,
      isRead: readSet.has(a.id),
    }))

    res.json({
      announcements: withIsRead,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      unreadCount,
    })
  } catch (error: any) {
    console.error('Announcement list error:', error?.message || error)
    res.status(500).json({ error: 'Failed to fetch announcements' })
  }
})

// ─── POST /api/announcements/read-all — mark all visible unread as read ─────
router.post('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }
    const isSuperAdmin = user.role === 'SUPER_ADMIN'
    const filterCollegeId = (req.query.collegeId as string | undefined) || (req.body?.collegeId as string | undefined)
    const now = new Date()
    const where = buildAnnouncementWhere(user, isSuperAdmin ? filterCollegeId : undefined, now)
    const unreadWhere: any = { ...where, reads: { none: { userId: user.id } } }
    const unread = await prisma.announcement.findMany({
      where: unreadWhere,
      select: { id: true },
    })
    if (unread.length === 0) {
      res.json({ count: 0 })
      return
    }
    const result = await prisma.announcementRead.createMany({
      data: unread.map((a) => ({ announcementId: a.id, userId: user.id })),
      skipDuplicates: true,
    })
    res.json({ count: result.count })
  } catch (error: any) {
    console.error('Announcement read-all error:', error?.message || error)
    res.status(500).json({ error: 'Failed to mark all as read' })
  }
})

// ─── POST /api/announcements/:id/read — mark single as read ─────────────────
router.post('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }
    const announcementId = req.params.id as string
    const now = new Date()
    const where = buildAnnouncementWhere(user, undefined, now)
    // Verify visibility: announcement must match where + id
    const visible = await prisma.announcement.findFirst({
      where: { ...where, id: announcementId },
    })
    if (!visible) {
      res.status(404).json({ error: 'Announcement not found or not visible' })
      return
    }
    await prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId, userId: user.id } },
      create: { announcementId, userId: user.id },
      update: {},
    })
    res.json({ success: true })
  } catch (error: any) {
    console.error('Announcement mark-read error:', error?.message || error)
    res.status(500).json({ error: 'Failed to mark as read' })
  }
})

// ─── PUT /api/announcements/:id — edit announcement ─────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    const announcementId = req.params.id as string
    const existing = await prisma.announcement.findUnique({
      where: { id: announcementId },
      include: { departments: true, colleges: true },
    })
    if (!existing) {
      res.status(404).json({ error: 'Announcement not found' })
      return
    }

    // Permission: creator, college-admin (same college), or super-admin
    const isCreator = existing.creatorId === user.id
    const isAdmin = user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId
    const isSuperAdmin = user.role === 'SUPER_ADMIN'
    if (!isCreator && !isAdmin && !isSuperAdmin) {
      res.status(403).json({ error: 'Only the creator or an admin can edit this announcement' })
      return
    }

    const { title, content, target, departmentIds, targetScope, collegeIds, publishAt, expiresAt } = req.body

    // Validate provided fields (same rules as create)
    if (title !== undefined) {
      if (!title || !title.trim()) {
        res.status(400).json({ error: 'Title cannot be empty' })
        return
      }
      if (title.trim().length > 200) {
        res.status(400).json({ error: 'Title must be 200 characters or less' })
        return
      }
    }
    if (content !== undefined && (!content || !content.trim())) {
      res.status(400).json({ error: 'Content cannot be empty' })
      return
    }
    if (target !== undefined && !['ALL_DEPARTMENTS', 'SPECIFIC_DEPARTMENTS'].includes(target)) {
      res.status(400).json({ error: 'Target must be ALL_DEPARTMENTS or SPECIFIC_DEPARTMENTS' })
      return
    }

    // Validate schedule/expiry if provided
    let publishAtDate: Date | null = existing.publishAt
    let expiresAtDate: Date | null = existing.expiresAt
    if (publishAt !== undefined) {
      publishAtDate = publishAt ? new Date(publishAt) : null
      if (publishAtDate && isNaN(publishAtDate.getTime())) {
        res.status(400).json({ error: 'Invalid publishAt date' })
        return
      }
    }
    if (expiresAt !== undefined) {
      expiresAtDate = expiresAt ? new Date(expiresAt) : null
      if (expiresAtDate && isNaN(expiresAtDate.getTime())) {
        res.status(400).json({ error: 'Invalid expiresAt date' })
        return
      }
    }
    if (publishAtDate && expiresAtDate && expiresAtDate <= publishAtDate) {
      res.status(400).json({ error: 'expiresAt must be after publishAt' })
      return
    }

    const effectiveTarget = target || existing.target

    // Validate department assignments if target is changing to SPECIFIC_DEPARTMENTS
    if (effectiveTarget === 'SPECIFIC_DEPARTMENTS' && departmentIds !== undefined) {
      if (!Array.isArray(departmentIds) || departmentIds.length === 0) {
        res.status(400).json({ error: 'At least one department is required for SPECIFIC_DEPARTMENTS target' })
        return
      }
      const deptCollegeId = existing.collegeId || user.collegeId
      if (deptCollegeId) {
        const validDepts = await prisma.department.findMany({
          where: { id: { in: departmentIds }, collegeId: deptCollegeId },
        })
        if (validDepts.length !== departmentIds.length) {
          res.status(400).json({ error: 'One or more department IDs are invalid for your college' })
          return
        }
      }
    }

    // Validate collegeIds if targetScope is changing to SPECIFIC_COLLEGES
    const effectiveScope = targetScope || existing.targetScope
    if (isSuperAdmin && effectiveScope === 'SPECIFIC_COLLEGES' && collegeIds !== undefined) {
      if (!Array.isArray(collegeIds) || collegeIds.length === 0) {
        res.status(400).json({ error: 'At least one college is required for SPECIFIC_COLLEGES scope' })
        return
      }
      const validColleges = await prisma.college.findMany({
        where: { id: { in: collegeIds }, status: 'APPROVED' },
      })
      if (validColleges.length !== collegeIds.length) {
        res.status(400).json({ error: 'One or more college IDs are invalid' })
        return
      }
    }

    // Build update data
    const updateData: any = {}
    if (title !== undefined) updateData.title = title.trim()
    if (content !== undefined) updateData.content = content.trim()
    if (target !== undefined) updateData.target = target
    if (targetScope !== undefined && isSuperAdmin) updateData.targetScope = targetScope
    if (publishAt !== undefined) updateData.publishAt = publishAtDate
    if (expiresAt !== undefined) updateData.expiresAt = expiresAtDate

    // Update department relations if provided
    const shouldUpdateDepts = departmentIds !== undefined && effectiveTarget === 'SPECIFIC_DEPARTMENTS'
    const shouldUpdateColleges = collegeIds !== undefined && isSuperAdmin && effectiveScope === 'SPECIFIC_COLLEGES'

    const announcement = await prisma.$transaction(async (tx) => {
      // Replace department relations if needed
      if (shouldUpdateDepts) {
        await tx.announcementDepartment.deleteMany({ where: { announcementId } })
        await tx.announcementDepartment.createMany({
          data: departmentIds.map((deptId: string) => ({ announcementId, departmentId: deptId })),
        })
      }

      // Replace college relations if needed
      if (shouldUpdateColleges) {
        await tx.announcementCollege.deleteMany({ where: { announcementId } })
        await tx.announcementCollege.createMany({
          data: collegeIds.map((cid: string) => ({ announcementId, collegeId: cid })),
        })
      }

      return tx.announcement.update({
        where: { id: announcementId },
        data: updateData,
        include: {
          creator: { select: { id: true, name: true, role: true, avatar: true } },
          departments: { include: { department: { select: { id: true, name: true } } } },
          colleges: { include: { college: { select: { id: true, name: true } } } },
        },
      })
    })

    res.json(announcement)
  } catch (error: any) {
    console.error('Announcement update error:', error?.message || error)
    res.status(500).json({ error: 'Failed to update announcement' })
  }
})

// ─── DELETE /api/announcements/:id — creator or admin only ───────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    const announcementId = req.params.id as string

    const announcement = await prisma.announcement.findUnique({
      where: { id: announcementId },
    })
    if (!announcement) {
      res.status(404).json({ error: 'Announcement not found' })
      return
    }

    // Super admin can delete anything
    if (user.role === 'SUPER_ADMIN') {
      await prisma.announcement.delete({ where: { id: announcementId } })
      res.json({ success: true })
      return
    }

    // Only creator or college admin can delete college-scoped announcements
    const isCreator = announcement.creatorId === user.id
    const isAdmin = user.role === 'COLLEGE_ADMIN'
    if (!isCreator && !isAdmin) {
      res.status(403).json({ error: 'Only the creator or an admin can delete this announcement' })
      return
    }

    // College admin can only delete their own college's announcements
    if (isAdmin && announcement.collegeId !== user.collegeId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    await prisma.announcement.delete({ where: { id: announcementId } })
    res.json({ success: true })
  } catch (error: any) {
    console.error('Announcement delete error:', error?.message || error)
    res.status(500).json({ error: 'Failed to delete announcement' })
  }
})

// Helper to determine collegeId for department validation
function isSuperAnnouncementCollegeId(collegeId: string | null, user: any): string {
  if (collegeId) return collegeId
  return user.collegeId!
}

export default router
