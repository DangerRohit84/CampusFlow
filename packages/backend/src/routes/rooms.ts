import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

const router = Router()
router.use(authenticate)

// Helper: generate 6-char join code
function generateJoinCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase()
}

// Helper: sanitize filename
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 100)
}

// Helper: detect file type from extension
function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.pdf': return 'pdf'
    case '.ppt':
    case '.pptx': return 'ppt'
    case '.doc':
    case '.docx': return 'doc'
    case '.xls':
    case '.xlsx': return 'xls'
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif': return 'image'
    default: return 'other'
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const roomId = String(req.params.id)
    const uploadDir = path.join(__dirname, '../../uploads/rooms', roomId)
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const sanitized = sanitizeFilename(file.originalname)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + sanitized)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain',
      'application/zip',
      'application/x-rar-compressed'
    ]
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('File type not allowed'))
    }
  }
})

// 1. POST / — Create room (Teacher only)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create rooms' })
      return
    }

    const { name, description } = req.body

    if (!name) {
      res.status(400).json({ error: 'Room name is required' })
      return
    }

    const joinCode = generateJoinCode()

    const room = await prisma.room.create({
      data: {
        name,
        description: description || '',
        joinCode,
        teacherId: req.userId!,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    res.status(201).json(room)
  } catch (error) {
    console.error('Create room error:', error)
    res.status(500).json({ error: 'Failed to create room' })
  }
})

// 2. GET / — List rooms
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    let rooms: any[] = []

    if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN') {
      // Teachers: list rooms they created
      const teacherRooms = await prisma.room.findMany({
        where: { teacherId: req.userId! },
        include: {
          teacher: {
            select: { id: true, name: true, email: true }
          },
          _count: {
            select: {
              members: true,
              resources: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })
      rooms = teacherRooms
    } else {
      // Students: list rooms they are members of
      const memberRooms = await prisma.roomMember.findMany({
        where: { studentId: req.userId! },
        include: {
          room: {
            include: {
              teacher: {
                select: { id: true, name: true, email: true }
              },
              _count: {
                select: {
                  members: true,
                  resources: true
                }
              }
            }
          }
        },
        orderBy: { joinedAt: 'desc' }
      })

      rooms = memberRooms.map((m: any) => m.room)
    }

    res.json(rooms)
  } catch (error) {
    console.error('List rooms error:', error)
    res.status(500).json({ error: 'Failed to list rooms' })
  }
})

// 3. GET /:id — Get single room
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        teacher: {
          select: { id: true, name: true, email: true }
        },
        members: {
          include: {
            student: {
              select: { id: true, name: true, email: true, studentId: true }
            }
          }
        },
        resources: true
      }
    })

    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Check access
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isMember = !isTeacher && room.members.some((m: any) => m.studentId === req.userId)

    if (!isCreator && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Group resources by category
    const groupedResources = room.resources.reduce((acc: Record<string, any[]>, resource: any) => {
      const category = resource.category
      if (!acc[category]) acc[category] = []
      acc[category].push(resource)
      return acc
    }, {} as Record<string, any[]>)

    res.json({
      ...room,
      groupedResources
    })
  } catch (error) {
    console.error('Get room error:', error)
    res.status(500).json({ error: 'Failed to get room' })
  }
})

// 4. PUT /:id — Update room (Teacher only)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can update rooms' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can update' })
      return
    }

    const { name, description } = req.body

    const updatedRoom = await prisma.room.update({
      where: { id },
      data: {
        name: name || undefined,
        description: description !== undefined ? description : undefined,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    res.json(updatedRoom)
  } catch (error) {
    console.error('Update room error:', error)
    res.status(500).json({ error: 'Failed to update room' })
  }
})

// 5. DELETE /:id — Delete room (Teacher only)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can delete rooms' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can delete' })
      return
    }

    // Delete room and cascade (handled by Prisma onDelete)
    await prisma.room.delete({ where: { id } })

    // Also delete uploaded files
    const uploadDir = path.join(__dirname, '../../uploads/rooms', id)
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true })
    }

    res.json({ message: 'Room deleted' })
  } catch (error) {
    console.error('Delete room error:', error)
    res.status(500).json({ error: 'Failed to delete room' })
  }
})

// 6. POST /join — Join room by code only (no roomId needed, Student only)
router.post('/join', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can join rooms' })
      return
    }

    const { code } = req.body
    if (!code || code.length !== 6) {
      res.status(400).json({ error: 'Invalid join code' })
      return
    }

    const room = await prisma.room.findUnique({
      where: { joinCode: code.toUpperCase() },
      include: {
        teacher: { select: { id: true, name: true, email: true } }
      }
    })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Check if already a member
    const existing = await prisma.roomMember.findUnique({
      where: { roomId_studentId: { roomId: room.id, studentId: user.id } },
    })
    if (existing) {
      res.status(400).json({ error: 'Already a member of this room' })
      return
    }

    // Add as member
    await prisma.roomMember.create({
      data: { roomId: room.id, studentId: user.id },
    })

    // Create notification for other members
    const otherMembers = await prisma.roomMember.findMany({
      where: { roomId: room.id, studentId: { not: user.id } },
      select: { studentId: true }
    })
    const notificationPromises = otherMembers.map((m: any) =>
      prisma.roomNotification.create({
        data: {
          roomId: room.id,
          studentId: m.studentId,
          message: `${user.name} joined the room`,
        },
      })
    )
    await Promise.all(notificationPromises)

    res.json({ message: 'Joined room successfully', room })
  } catch (error) {
    console.error('Join room by code error:', error)
    res.status(500).json({ error: 'Failed to join room' })
  }
})

// 7. POST /:id/join — Join room by code + roomId (Student only)
router.post('/:id/join', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const { code } = req.body
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can join rooms' })
      return
    }

    if (!code) {
      res.status(400).json({ error: 'Join code is required' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.joinCode !== String(code).toUpperCase()) {
      res.status(400).json({ error: 'Invalid join code' })
      return
    }

    // Check if already a member
    const existingMember = await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (existingMember) {
      res.status(400).json({ error: 'Already a member of this room' })
      return
    }

    // Add as member
    const member = await prisma.roomMember.create({
      data: {
        roomId: id,
        studentId: req.userId!
      }
    })

    // Create notifications for all other members
    const allMembers = await prisma.roomMember.findMany({
      where: { roomId: id },
      select: { studentId: true }
    })

    const notificationPromises = allMembers
      .filter((m: any) => m.studentId !== req.userId)
      .map((m: any) =>
        prisma.roomNotification.create({
          data: {
            roomId: id,
            studentId: m.studentId,
            message: `${user.name} joined the room`
          }
        })
      )

    await Promise.all(notificationPromises)

    res.status(201).json({ message: 'Joined room successfully', member })
  } catch (error) {
    console.error('Join room error:', error)
    res.status(500).json({ error: 'Failed to join room' })
  }
})

// 7. POST /:id/leave — Leave room (Student only)
router.post('/:id/leave', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can leave rooms' })
      return
    }

    const member = await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (!member) {
      res.status(400).json({ error: 'Not a member of this room' })
      return
    }

    // Remove member
    await prisma.roomMember.delete({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    // Create notifications for all remaining members
    const allMembers = await prisma.roomMember.findMany({
      where: { roomId: id },
      select: { studentId: true }
    })

    const notificationPromises = allMembers.map((m: any) =>
      prisma.roomNotification.create({
        data: {
          roomId: id,
          studentId: m.studentId,
          message: `${user.name} left the room`
        }
      })
    )

    await Promise.all(notificationPromises)

    res.json({ message: 'Left room successfully' })
  } catch (error) {
    console.error('Leave room error:', error)
    res.status(500).json({ error: 'Failed to leave room' })
  }
})

// 8. GET /:id/members — List room members
router.get('/:id/members', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Check access
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isMember = !isTeacher && await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (!isCreator && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const members = await prisma.roomMember.findMany({
      where: { roomId: id },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            studentId: true,
          }
        }
      },
      orderBy: { joinedAt: 'asc' }
    })

    res.json(members.map((m: any) => m.student))
  } catch (error) {
    console.error('List members error:', error)
    res.status(500).json({ error: 'Failed to list members' })
  }
})

// 9. POST /:id/resources — Upload resource (Teacher only)
router.post('/:id/resources', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can upload resources' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can upload resources' })
      return
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    const { title, description, category } = req.body

    if (!title) {
      res.status(400).json({ error: 'Title is required' })
      return
    }

    const fileType = getFileType(req.file.originalname)
    const fileUrl = `/uploads/rooms/${id}/${req.file.filename}`

    const resource = await prisma.resource.create({
      data: {
        title,
        description: description || '',
        fileUrl,
        fileType,
        category: category || 'other',
        roomId: id,
        uploadedBy: req.userId!
      }
    })

    // Create notifications for all room members
    const allMembers = await prisma.roomMember.findMany({
      where: { roomId: id },
      select: { studentId: true }
    })

    const notificationPromises = allMembers.map((m: any) =>
      prisma.roomNotification.create({
        data: {
          roomId: id,
          studentId: m.studentId,
          message: `New ${category || 'other'}: ${title}`,
          resourceUrl: fileUrl
        }
      })
    )

    await Promise.all(notificationPromises)

    res.status(201).json(resource)
  } catch (error) {
    console.error('Upload resource error:', error)
    res.status(500).json({ error: 'Failed to upload resource' })
  }
})

// 10. GET /:id/resources — List resources
router.get('/:id/resources', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Check access
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isMember = !isTeacher && await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (!isCreator && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const resources = await prisma.resource.findMany({
      where: { roomId: id },
      include: {
        uploader: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Group by category
    const grouped = resources.reduce((acc: Record<string, any[]>, resource: any) => {
      const category = resource.category
      if (!acc[category]) acc[category] = []
      acc[category].push(resource)
      return acc
    }, {} as Record<string, any[]>)

    res.json(grouped)
  } catch (error) {
    console.error('List resources error:', error)
    res.status(500).json({ error: 'Failed to list resources' })
  }
})

// 11. DELETE /:id/resources/:resourceId — Delete resource (Teacher only)
router.delete('/:id/resources/:resourceId', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const resourceId = String(req.params.resourceId)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can delete resources' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can delete resources' })
      return
    }

    const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
    if (!resource || resource.roomId !== id) {
      res.status(404).json({ error: 'Resource not found' })
      return
    }

    // Delete file from disk
    const filePath = path.join(__dirname, '../..', resource.fileUrl)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // Delete resource record
    await prisma.resource.delete({ where: { id: resourceId } })

    res.json({ message: 'Resource deleted' })
  } catch (error) {
    console.error('Delete resource error:', error)
    res.status(500).json({ error: 'Failed to delete resource' })
  }
})

// 12. GET /notifications — Get student's notifications
router.get('/notifications/list', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const notifications = await prisma.roomNotification.findMany({
      where: { studentId: req.userId! },
      include: {
        room: {
          select: { id: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json(notifications)
  } catch (error) {
    console.error('Get notifications error:', error)
    res.status(500).json({ error: 'Failed to get notifications' })
  }
})

// 13. POST /notifications/:id/read — Mark notification as read
router.post('/notifications/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const notification = await prisma.roomNotification.findUnique({ where: { id } })
    if (!notification || notification.studentId !== req.userId) {
      res.status(404).json({ error: 'Notification not found' })
      return
    }

    await prisma.roomNotification.update({
      where: { id },
      data: { isRead: true }
    })

    res.json({ message: 'Notification marked as read' })
  } catch (error) {
    console.error('Mark notification read error:', error)
    res.status(500).json({ error: 'Failed to mark notification as read' })
  }
})

// 14. POST /import — Bulk import students (Teacher only, optional)
router.post('/import', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can import students' })
      return
    }

    const { roomId, rollNumbers } = req.body

    if (!roomId || !rollNumbers || !Array.isArray(rollNumbers)) {
      res.status(400).json({ error: 'roomId and rollNumbers array are required' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can import students' })
      return
    }

    // Find students by studentId (roll number)
    const students = await prisma.user.findMany({
      where: {
        studentId: { in: rollNumbers },
        role: 'STUDENT'
      }
    })

    // Filter out already existing members
    const existingMembers = await prisma.roomMember.findMany({
      where: {
        roomId,
        studentId: { in: students.map((s: any) => s.id) }
      }
    })

    const existingStudentIds = new Set(existingMembers.map((m: any) => m.studentId))
    const newStudents = students.filter((s: any) => !existingStudentIds.has(s.id))

    // Add new members
    const createdMembers = await prisma.roomMember.createMany({
      data: newStudents.map((s: any) => ({
        roomId,
        studentId: s.id
      }))
    })

    res.json({
      message: `Successfully imported ${createdMembers.count} students`,
      imported: createdMembers.count,
      skipped: rollNumbers.length - createdMembers.count
    })
  } catch (error) {
    console.error('Import students error:', error)
    res.status(500).json({ error: 'Failed to import students' })
  }
})

export default router