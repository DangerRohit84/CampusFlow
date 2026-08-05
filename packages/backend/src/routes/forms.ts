import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import ExcelJS from 'exceljs'

const router = Router()
router.use(authenticate)

// Create form (Teacher)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create forms' })
      return
    }

    const { title, description, fields, allowEdit, expiresAt, targetDepartments, targetYears, eligibilityEnabled, roomIds } = req.body

    const form = await prisma.form.create({
      data: {
        creatorId: req.userId!,
        collegeId: user.collegeId,
        title,
        description,
        status: 'ACTIVE',
        allowEdit: allowEdit || false,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        targetDepartments: JSON.stringify(targetDepartments || []),
        targetYears: JSON.stringify(targetYears || []),
        eligibilityEnabled: eligibilityEnabled || false,
        fields: {
          create: fields?.map((f: any, i: number) => ({
            label: f.label,
            type: f.type || 'TEXT',
            required: f.required || false,
            options: JSON.stringify(f.options || []),
            order: i,
          })) || [],
        },
      },
      include: { fields: { orderBy: { order: 'asc' } } },
    })

    // Link rooms to form if provided
    if (roomIds && Array.isArray(roomIds) && roomIds.length > 0) {
      for (const roomId of roomIds) {
        await prisma.formRoom.create({
          data: { formId: form.id, roomId }
        })
      }
    }

    res.status(201).json(form)
  } catch (error) {
    console.error('Create form error:', error)
    res.status(500).json({ error: 'Failed to create form' })
  }
})

// Get all forms (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    let forms: any[] = []

    if (user.role === 'SUPER_ADMIN') {
      forms = await prisma.form.findMany({
        include: { creator: { select: { name: true } }, fields: true, responses: true, formRooms: { include: { room: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
      })
    } else if (user.role === 'COLLEGE_ADMIN' || user.role === 'TEACHER') {
      forms = await prisma.form.findMany({
        where: {
          OR: [
            { creatorId: req.userId },
            { creator: { department: user.department } },
          ],
        },
        include: { creator: { select: { name: true, department: true } }, fields: true, responses: true, formRooms: { include: { room: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      forms = await prisma.form.findMany({
        where: {
          status: 'ACTIVE',
          creator: { department: user.department },
        },
        include: { creator: { select: { name: true, department: true } }, fields: true, responses: true, formRooms: { include: { room: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
      })
    }

    res.json(forms)
  } catch (error) {
    console.error('Get forms error:', error)
    res.status(500).json({ error: 'Failed to fetch forms' })
  }
})

// Update form (Teacher only)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can update forms' })
      return
    }

    // Check ownership for TEACHER role
    const existingForm = await prisma.form.findUnique({ where: { id: req.params.id } })
    if (!existingForm) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    if (user.role === 'TEACHER' && existingForm.creatorId !== req.userId) {
      res.status(403).json({ error: 'Can only update your own forms' })
      return
    }

    const { title, description, allowEdit, expiresAt, targetDepartments, targetYears, eligibilityEnabled } = req.body
    const form = await prisma.form.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(allowEdit !== undefined && { allowEdit }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(targetDepartments !== undefined && { targetDepartments: JSON.stringify(targetDepartments) }),
        ...(targetYears !== undefined && { targetYears: JSON.stringify(targetYears) }),
        ...(eligibilityEnabled !== undefined && { eligibilityEnabled }),
      },
    })
    res.json(form)
  } catch (error) {
    console.error('Update form error:', error)
    res.status(500).json({ error: 'Failed to update form' })
  }
})

// Get single form with fields
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const form = await prisma.form.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { name: true, email: true, empNumber: true } },
        fields: { orderBy: { order: 'asc' } },
        responses: {
          include: { user: { select: { name: true, email: true, department: true, studentId: true } } },
          orderBy: { submittedAt: 'desc' },
        },
        formRooms: {
          include: { room: { select: { id: true, name: true } } }
        },
      },
    })

    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    // Authorization check: Students can only see active forms
    if (user.role === 'STUDENT' && form.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Teachers can only see their own forms
    if (user.role === 'TEACHER' && form.creatorId !== req.userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    res.json(form)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch form' })
  }
})

// Submit form response (Student)
router.post('/:id/respond', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can submit responses' })
      return
    }

    const form = await prisma.form.findUnique({
      where: { id: req.params.id },
      include: { fields: true },
    })

    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    // Check room-based eligibility first
    const formRooms = await prisma.formRoom.findMany({
      where: { formId: req.params.id },
      select: { roomId: true }
    })

    if (formRooms.length > 0) {
      const isMember = await prisma.roomMember.findFirst({
        where: {
          studentId: req.userId!,
          roomId: { in: formRooms.map((fr: any) => fr.roomId) }
        }
      })
      if (!isMember) {
        res.status(403).json({ error: 'You are not eligible for this form' })
        return
      }
    }

    // Check eligibility if enabled
    if (form.eligibilityEnabled) {
      let targetDepts: string[] = []
      let targetYears: number[] = []
      try {
        targetDepts = JSON.parse(form.targetDepartments || '[]')
      } catch { targetDepts = [] }
      try {
        targetYears = JSON.parse(form.targetYears || '[]')
      } catch { targetYears = [] }

      // Must match department if targetDepartments specified
      if (targetDepts.length > 0 && (!user.departmentId || !targetDepts.includes(user.departmentId))) {
        res.status(403).json({ error: 'Your department is not eligible for this form' })
        return
      }

      // Must match year if targetYears specified
      if (targetYears.length > 0 && user.incomingYear) {
        const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
        if (!targetYears.includes(currentYear)) {
          res.status(403).json({ error: `Only year ${targetYears.join(', ')} students are eligible for this form` })
          return
        }
      }
    }

    // Check if form is expired
    if (form.expiresAt && new Date() > form.expiresAt) {
      res.status(400).json({ error: 'Form has expired' })
      return
    }

    // Check if already responded
    const existing = await prisma.formResponse.findUnique({
      where: { formId_userId: { formId: req.params.id, userId: req.userId! } },
    })

    // Enforce allowEdit setting
    if (!form.allowEdit && existing) {
      res.status(403).json({ error: 'This form does not allow editing responses' })
      return
    }

    if (existing) {
      // Update existing response
      const updated = await prisma.formResponse.update({
        where: { id: existing.id },
        data: { answers: JSON.stringify(req.body.answers) },
      })
      res.json(updated)
    } else {
      // Create new response
      const response = await prisma.formResponse.create({
        data: {
          formId: req.params.id,
          userId: req.userId!,
          answers: JSON.stringify(req.body.answers),
        },
      })
      res.status(201).json(response)
    }
  } catch (error) {
    console.error('Submit form error:', error)
    res.status(500).json({ error: 'Failed to submit response' })
  }
})

// Extend form expiration (Teacher only)
router.post('/:id/extend', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can extend forms' })
      return
    }

    const { expiresAt } = req.body
    if (!expiresAt) {
      res.status(400).json({ error: 'expiresAt is required' })
      return
    }

    const form = await prisma.form.findUnique({ where: { id: req.params.id } })
    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    // Check ownership for TEACHER role
    if (user.role === 'TEACHER' && form.creatorId !== req.userId) {
      res.status(403).json({ error: 'Can only extend your own forms' })
      return
    }

    const updated = await prisma.form.update({
      where: { id: req.params.id },
      data: { expiresAt: new Date(expiresAt) },
    })

    res.json(updated)
  } catch (error) {
    console.error('Extend form error:', error)
    res.status(500).json({ error: 'Failed to extend form' })
  }
})

// Export form responses to Excel
router.get('/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const form = await prisma.form.findUnique({
      where: { id: req.params.id },
      include: {
        fields: { orderBy: { order: 'asc' } },
        responses: {
          include: { user: { select: { name: true, email: true, department: true, studentId: true } } },
        },
      },
    })

    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    // Authorization check: Teachers can only export their own forms
    if (user.role === 'TEACHER' && form.creatorId !== req.userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'CampusFlow'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet(form.title.substring(0, 31))
    
    // Headers
    const columns = [
      { header: 'S.No', key: 'sno', width: 8 },
      { header: 'Roll No', key: 'rollNo', width: 15 },
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Submitted At', key: 'submittedAt', width: 20 },
    ]

    // Add form field columns
    for (const field of form.fields) {
      columns.push({ header: field.label, key: field.label, width: 25 })
    }

    sheet.columns = columns

    // Rows
    form.responses.forEach((resp, idx) => {
      let answers: any = {}
      try {
        answers = JSON.parse(resp.answers)
      } catch { answers = {} }
      const row: any = {
        sno: idx + 1,
        rollNo: resp.user.studentId || '',
        name: resp.user.name,
        email: resp.user.email,
        department: resp.user.department || '',
        submittedAt: resp.submittedAt.toLocaleDateString(),
      }

      // Add field answers
      for (const field of form.fields) {
        row[field.label] = answers[field.id] || ''
      }

      sheet.addRow(row)
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename=${form.title.replace(/\s+/g, '_')}_responses.xlsx`)
    
    const buffer = await workbook.xlsx.writeBuffer()
    res.send(Buffer.from(buffer as any))
  } catch (error) {
    console.error('Export form error:', error)
    res.status(500).json({ error: 'Failed to export' })
  }
})

// Delete form (Creator only)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const form = await prisma.form.findUnique({ where: { id: req.params.id } })
    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    if (form.creatorId !== req.userId) {
      res.status(403).json({ error: 'Can only delete your own forms' })
      return
    }

    await prisma.form.delete({ where: { id: req.params.id } })
    res.json({ message: 'Form deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete form' })
  }
})

export default router
