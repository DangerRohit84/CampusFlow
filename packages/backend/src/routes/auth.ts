import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import prisma from '../config/db'
import { config } from '../config'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(6),
  username: z.string().min(3).max(20).optional(),
  departmentId: z.string().optional(),
  department: z.string().optional(),
  role: z.string().optional(),
  collegeId: z.string().uuid().optional(),
  college: z.string().optional(),
  empNumber: z.string().optional(),
  studentId: z.string().optional(),
  incomingYear: z.number().optional(),
})

function sanitizeUsername(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, '').replace(/^[._-]+/, '').slice(0, 20)
}
function isValidUsername(u: string): boolean {
  return /^[a-z0-9]([a-z0-9._-]{1,18}[a-z0-9])?$/.test(u) && u.length >= 3 && u.length <= 20
}
function suggestBase(name: string, email: string): string {
  const base = sanitizeUsername(name.replace(/\s+/g, '_')) || sanitizeUsername(email.split('@')[0]) || 'user'
  let s = base
  if (s.length < 3) s = (s + 'user').slice(0, 20)
  return s
}
function normalizePortfolioUrlForAuth(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  let candidate = raw
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.toString()
  } catch { return null }
}
async function generateUniqueUsername(name: string, email: string): Promise<string> {
  let base = suggestBase(name, email)
  let candidate = base
  let tries = 0
  while (tries < 20) {
    const exists = await (prisma as any).user.findFirst({ where: { username: candidate } }).catch(() => null)
    if (!exists) return candidate
    tries++
    candidate = `${base}${tries}`.slice(0, 20)
  }
  return `${base}_${Date.now().toString().slice(-4)}`.slice(0, 20)
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

// Register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body)

    const existingUser = await prisma.user.findUnique({ where: { email: body.email } })
    if (existingUser) {
      res.status(400).json({ error: 'Email already registered' })
      return
    }

    // SECURITY: public registration must not allow privilege escalation.
    // SUPER_ADMIN is platform owner (collegeId=null, global) and can only be created via admin panel/seed.
    // COLLEGE_ADMIN is created via college registration flow or super admin promotion.
    const requestedRole = (body.role as string) || 'STUDENT'
    if (requestedRole === 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin accounts can only be created by existing super admins' })
      return
    }
    // COLLEGE_ADMIN via public /register-college flow: allow if college exists and email matches adminEmail (PENDING college) or college is APPROVED (promotion via super admin is separate)
    // This unblocks the two-step college registration: POST /api/colleges/register (creates PENDING college) -> POST /api/auth/register {role:COLLEGE_ADMIN, collegeId}
    let isCollegeAdminViaPublicFlow = false
    if (requestedRole === 'COLLEGE_ADMIN') {
      if (!body.collegeId) {
        res.status(400).json({ error: 'College ID is required for college admin registration' })
        return
      }
      const c = await prisma.college.findUnique({ where: { id: body.collegeId } })
      if (!c) {
        res.status(400).json({ error: 'Invalid college' })
        return
      }
      // Allow if: (a) PENDING and email matches adminEmail (self-registration flow), or (b) APPROVED and email matches adminEmail (edge), else block
      const status = (c as any).status
      const adminEmail = (c as any).adminEmail?.toLowerCase?.()
      const reqEmail = String(body.email || '').toLowerCase()
      if (status === 'PENDING' && adminEmail && adminEmail === reqEmail) {
        isCollegeAdminViaPublicFlow = true
      } else if (status === 'APPROVED' && adminEmail && adminEmail === reqEmail) {
        // Allow APPROVED too for the immediate post-creation step before super admin explicitly approves (some deploys auto-approve)
        isCollegeAdminViaPublicFlow = true
      } else {
        res.status(403).json({ error: 'College admin registration must go through /register-college or admin panel' })
        return
      }
    }
    const safeRole = isCollegeAdminViaPublicFlow ? 'COLLEGE_ADMIN' : (requestedRole === 'TEACHER' ? 'TEACHER' : 'STUDENT')

    // MEDIUM IDOR fix: validate collegeId on public registration — must exist and be APPROVED, except COLLEGE_ADMIN via pending flow (where PENDING is allowed)
    if (body.collegeId && !isCollegeAdminViaPublicFlow) {
      const college = await prisma.college.findUnique({ where: { id: body.collegeId } })
      if (!college || (college as any).status !== 'APPROVED') {
        res.status(400).json({ error: 'Invalid college' })
        return
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 10)
    // username: use provided or generate from name/email, ensure unique
    let username: string | undefined
    if ((body as any).username) {
      const s = sanitizeUsername(String((body as any).username))
      if (!isValidUsername(s)) {
        res.status(400).json({ error: 'Invalid username: 3-20 chars, letters/numbers/_.-, start/end alphanumeric' })
        return
      }
      const exists = await (prisma as any).user.findFirst({ where: { username: s } }).catch(() => null)
      if (exists) {
        res.status(400).json({ error: 'Username already taken' })
        return
      }
      username = s
    } else {
      username = await generateUniqueUsername(body.name, body.email)
    }

    let user: any
    try {
      user = await (prisma as any).user.create({
        data: {
          email: body.email,
          name: body.name,
          username,
          passwordHash,
          departmentId: body.departmentId || undefined,
          departmentName: body.department || undefined,
          role: safeRole as any,
          collegeId: body.collegeId,
          collegeName: body.college,
          empNumber: body.empNumber,
          studentId: body.studentId,
          incomingYear: body.incomingYear,
          outgoingYear: body.incomingYear ? body.incomingYear + 4 : undefined,
        },
      })
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('username') || msg.includes('Unknown argument') || msg.includes('column') || msg.includes('field')) {
        // fallback for DB not yet migrated (leave dirty mode) — create without username
        user = await prisma.user.create({
          data: {
            email: body.email,
            name: body.name,
            passwordHash,
            departmentId: body.departmentId || undefined,
            departmentName: body.department || undefined,
            role: safeRole as any,
            collegeId: body.collegeId,
            collegeName: body.college,
            empNumber: body.empNumber,
            studentId: body.studentId,
            incomingYear: body.incomingYear,
            outgoingYear: body.incomingYear ? body.incomingYear + 4 : undefined,
          },
        })
        username = undefined
      } else throw e
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any })

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        username: (user as any).username || username,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: user.departmentName,
        incomingYear: user.incomingYear,
        outgoingYear: user.outgoingYear,
        collegeId: user.collegeId,
        collegeName: user.collegeName,
        portfolioUrl: (user as any).portfolioUrl || null,
      },
      token,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    console.error('Register error:', error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const validPassword = await bcrypt.compare(body.password, user.passwordHash)
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any })

    const userWithCollege = await prisma.user.findUnique({
      where: { id: user.id },
      include: { college: { select: { id: true, name: true } }, department: true },
    })

    // backfill username if missing (legacy users)
    let username = (user as any).username
    if (!username) {
      try {
        username = await generateUniqueUsername(user.name, user.email)
        await (prisma as any).user.update({ where: { id: user.id }, data: { username } as any })
      } catch {}
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: username || (user as any).username || null,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: user.departmentName,
        department: userWithCollege?.department,
        incomingYear: user.incomingYear,
        outgoingYear: user.outgoingYear,
        studentId: user.studentId,
        empNumber: user.empNumber,
        college: userWithCollege?.college,
        collegeId: user.collegeId,
        portfolioUrl: (user as any).portfolioUrl || null,
      },
      token,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    console.error('Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Change password — authenticated
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
})

router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const body = changePasswordSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const valid = await bcrypt.compare(body.currentPassword, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' })
      return
    }

    if (body.currentPassword === body.newPassword) {
      res.status(400).json({ error: 'New password must be different from current password' })
      return
    }

    const newHash = await bcrypt.hash(body.newPassword, 10)
    await prisma.user.update({ where: { id: req.userId }, data: { passwordHash: newHash } as any })

    res.json({ message: 'Password updated successfully' })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    console.error('Change password error:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
})

// Get current user
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { college: { select: { id: true, name: true } }, department: true },
    })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({
      id: user.id,
      name: user.name,
      username: (user as any).username || null,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      department: user.department,
      incomingYear: user.incomingYear,
      outgoingYear: user.outgoingYear,
      avatar: user.avatar,
      portfolioUrl: (user as any).portfolioUrl || null,
      studentId: user.studentId,
      empNumber: user.empNumber,
      college: user.college,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' })
  }
})

export default router