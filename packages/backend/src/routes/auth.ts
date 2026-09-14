import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import prisma from '../config/db'
import { config, getCookieMaxAgeMs } from '../config'
import { authenticate, AuthRequest, clearAuthorizeCache } from '../middleware/auth'
import { signJwtWithJti, signRefreshToken, verifyRefreshToken, generateCsrfToken, isLockedOut, recordFailedLogin, recordSuccessfulLogin, revokeJti, isCommonPassword, checkPasswordBreach, isRefreshTokenStaleAfterBulkReset, normalizeEmail, findUserByEmailInsensitive, emailsMatchInsensitive } from '../utils/authHardening'
import { verifyTurnstile } from '../utils/turnstile'
import { logger } from '../utils/logger'
import { toRoleEnum } from '../lib/enums'

const router = Router()

function buildAuthCookies(res: Response, token: string, refreshToken: string, csrfToken: string): void {
  const isProd = process.env.NODE_ENV === 'production'
  const maxAge = getCookieMaxAgeMs()
  // Access: HttpOnly Lax, derived from JWT_EXPIRES_IN (1d baseline, not hardcoded 7d)
  res.cookie('campusflow_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge,
    path: '/',
  })
  // Refresh: HttpOnly Strict, refresh-path only, 30d rotating
  res.cookie('cf_refresh', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/auth/refresh',
  })
  // CSRF double-submit: non-HttpOnly, echoed in X-CSRF-Token for mutations
  res.cookie('cf_csrf', csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax',
    maxAge,
    path: '/',
  })
}

function clearAuthCookies(res: Response): void {
  const isProd = process.env.NODE_ENV === 'production'
  // Must match buildAuthCookies attrs or browsers keep the cookie (I-5 fix)
  res.clearCookie('campusflow_token', { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' })
  res.clearCookie('cf_refresh', { path: '/api/auth/refresh', httpOnly: true, secure: isProd, sameSite: 'strict' })
  res.clearCookie('cf_csrf', { path: '/', secure: isProd, sameSite: 'lax' })
  // Legacy path clear (defense in depth for pre-fix cookies set with path '/')
  try { res.clearCookie('cf_refresh', { path: '/' }) } catch {}
}

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  // P0 SECURITY (F16): NIST 800-63 — min 8, max 72 (bcrypt truncates past 72B).
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters'),
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
    // HALF2: narrow existence check (was full row; only existence used)
    const exists = await (prisma as any).user.findFirst({ where: { username: candidate }, select: { id: true } }).catch(() => null)
    if (!exists) return candidate
    tries++
    candidate = `${base}${tries}`.slice(0, 20)
  }
  return `${base}_${Date.now().toString().slice(-4)}`.slice(0, 20)
}

const loginSchema = z.object({
  email: z.string().email(),
  // FS-M10: min(1) only — login must not enforce min 8 (would waste bcrypt
  // on empty + enable user enumeration via distinct errors). Generic 401 kept.
  password: z.string().min(1, 'Password is required').max(72),
})

// Register — brute-force safe (generic response, no enumeration) + per-email lockout.
// Returns generic failure when email exists (same 400 shape, no "already registered"
// detail) + records failed attempt for lockout. Turnstile verified when token
// provided (fail-closed prod, fail-open dev); authLimiter (10/15m) + lockout
// (5/15m) throttle enumeration regardless.
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body)
    // EMAIL-CASE FIX: normalize once (trim+lowercase) — Postgres @unique is
    // case-sensitive, so raw `Example@x.com` vs `example@x.com` were distinct
    // keys (login miss + duplicate accounts). All existence checks, writes,
    // lockout keys, and the college adminEmail comparison below share `email`.
    const email = normalizeEmail(body.email)

    // CAPTCHA/bot defense (I-3): optional during rollout, enforced in prod when secret set
    try {
      const captchaToken = (req.body as any)?.turnstileToken || (req.body as any)?.captchaToken
      const captchaOk = await verifyTurnstile(captchaToken, req.ip)
      if (!captchaOk) {
        res.status(403).json({ error: 'Bot verification failed, please retry' })
        return
      }
    } catch { /* verifyTurnstile never throws — fail-open dev, fail-closed prod inside */ }

    // Per-email lockout on register too (prevents enumeration sweeps).
    const preLock = isLockedOut(email)
    if (preLock.locked) {
      res.setHeader('Retry-After', String(preLock.retryAfterSec || 900))
      res.status(429).json({ error: 'Too many attempts, try again later' })
      return
    }

    // Weak/breached password gate (C3): common list + HIBP k-anonymity (offline-safe)
    if (isCommonPassword(body.password)) {
      res.status(400).json({ error: 'Password is too common, choose a stronger password' })
      return
    }
    try {
      const breach = await checkPasswordBreach(body.password)
      if (breach.breached) {
        res.status(400).json({ error: 'Password has appeared in a data breach, choose a different password' })
        return
      }
    } catch { /* checkPasswordBreach never throws — offline handled inside */ }

    const existingUser = await findUserByEmailInsensitive(prisma as any, email, { select: { id: true } }) // HALF2: narrow existence check (was full row incl. passwordHash). CASE-INSENSITIVE: findFirst mode:insensitive so legacy `Demo@gmail.com` collides with `demo@gmail.com` (exact findUnique missed → duplicate accounts).
    if (existingUser) {
      recordFailedLogin(email)
      // Generic — do not confirm existence (OWASP A07). Frontend shows
      // "Registration failed — if this email exists, please log in."
      res.status(400).json({ error: 'Registration failed. If this email is already registered, please log in.' })
      return
    }

    // SECURITY: public registration must not allow privilege escalation.
    // SUPER_ADMIN is platform owner (collegeId=null, global) and can only be created via admin panel/seed.
    // COLLEGE_ADMIN is created via college registration flow or super admin promotion.
    // Order 4: User.role is the native UserRole enum (UPPERCASE). Normalize
    // case-insensitively at the boundary so 'teacher' maps to TEACHER instead
    // of silently falling through to STUDENT; ghosts fall through to STUDENT
    // (safe default, never 500s) — privilege escalation still blocked below.
    const requestedRole = String((body.role as string) || 'STUDENT').trim().toUpperCase()
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
      const c = await prisma.college.findUnique({ where: { id: body.collegeId }, select: { id: true, status: true, adminEmail: true } }) // HALF2: narrow (was full row; only id/status/adminEmail used)
      if (!c) {
        res.status(400).json({ error: 'Invalid college' })
        return
      }
      // Allow if: (a) PENDING and email matches adminEmail (self-registration flow), or (b) APPROVED and email matches adminEmail (edge), else block
      const status = (c as any).status
      // EMAIL-CASE FIX (legacy-safe): emailsMatchInsensitive normalizes BOTH
      // sides via SSOT, so legacy mixed-case College.adminEmail still matches.
      // (Previous cut inlined normalizeEmail+===; helper is identical semantics.)
      const adminMatches = emailsMatchInsensitive((c as any).adminEmail, email)
      if (status === 'PENDING' && adminMatches) {
        isCollegeAdminViaPublicFlow = true
      } else if (status === 'APPROVED' && adminMatches) {
        // Allow APPROVED too for the immediate post-creation step before super admin explicitly approves (some deploys auto-approve)
        isCollegeAdminViaPublicFlow = true
      } else {
        res.status(403).json({ error: 'College admin registration must go through /register-college or admin panel' })
        return
      }
    }
    const safeRole = isCollegeAdminViaPublicFlow ? 'COLLEGE_ADMIN' : (requestedRole === 'TEACHER' ? 'TEACHER' : 'STUDENT')
    // Order 5 (V-03-CHECKs): mirror chk_user_role_fields — 400, not 500/P2000.
    {
      const { validateUserRoleFields } = await import('../lib/validators.js').catch(() => ({ validateUserRoleFields: null as any }))
      const roleErr = typeof validateUserRoleFields === 'function' ? (validateUserRoleFields as any)(safeRole, { studentId: (body as any).studentId, empNumber: (body as any).empNumber }) : null
      if (roleErr) {
        res.status(400).json({ error: roleErr })
        return
      }
    }

    // MEDIUM IDOR fix: validate collegeId on public registration — must exist and be APPROVED, except COLLEGE_ADMIN via pending flow (where PENDING is allowed)
    if (body.collegeId && !isCollegeAdminViaPublicFlow) {
      const college = await prisma.college.findUnique({ where: { id: body.collegeId }, select: { id: true, status: true } }) // HALF2: narrow (was full row)
      if (!college || (college as any).status !== 'APPROVED') {
        res.status(400).json({ error: 'Invalid college' })
        return
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 12)
    // HIBP enforced above via checkPasswordBreach (k-anonymity, offline-safe).
    // username: use provided or generate from name/email, ensure unique
    let username: string | undefined
    if ((body as any).username) {
      const s = sanitizeUsername(String((body as any).username))
      if (!isValidUsername(s)) {
        res.status(400).json({ error: 'Invalid username: 3-20 chars, letters/numbers/_.-, start/end alphanumeric' })
        return
      }
      const exists = await (prisma as any).user.findFirst({ where: { username: s }, select: { id: true } }).catch(() => null) // HALF2: narrow existence check (was full row)
      if (exists) {
        // Generic — do not confirm existence (I-2 username oracle fix, OWASP A07)
        recordFailedLogin(email)
        res.status(400).json({ error: 'Registration failed. If this email is already registered, please log in.' })
        return
      }
      username = s
    } else {
      username = await generateUniqueUsername(body.name, email)
    }

    let user: any
    try {
      user = await (prisma as any).user.create({
        data: {
          email,
          name: body.name,
          username,
          passwordHash,
          departmentId: body.departmentId || undefined,
          // safeRole is one of STUDENT/TEACHER/COLLEGE_ADMIN (validated above);
          // normalize via the REAL UserRole enum (throws on ghost — never
          // writes a raw string to the native enum column).
          role: toRoleEnum(safeRole),
          collegeId: body.collegeId,
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
            email,
            name: body.name,
            passwordHash,
            departmentId: body.departmentId || undefined,
            role: toRoleEnum(safeRole),
            collegeId: body.collegeId,
            empNumber: body.empNumber,
            studentId: body.studentId,
            incomingYear: body.incomingYear,
            outgoingYear: body.incomingYear ? body.incomingYear + 4 : undefined,
          },
        })
        username = undefined
      } else throw e
    }
    // Order 12 CTI dual-write (best-effort, pre-migration safe — never blocks
    // registration; User twins above remain the fallback truth until contract).
    try {
      const { dualWriteProfiles } = await import('../utils/userProfiles.js').catch(() => ({ dualWriteProfiles: null as any }))
      if (typeof dualWriteProfiles === 'function') {
        await (dualWriteProfiles as any)(prisma, {
          userId: user.id, role: safeRole,
          studentId: (body as any).studentId, empNumber: (body as any).empNumber,
          incomingYear: (body as any).incomingYear,
          outgoingYear: (body as any).incomingYear ? (body as any).incomingYear + 4 : undefined,
        })
      }
    } catch {}

    const token = signJwtWithJti(user.id).token
    const refresh = signRefreshToken(user.id)
    const csrfToken = generateCsrfToken()
    recordSuccessfulLogin(email)
    // HttpOnly migration (dual support, C2): same JWT as Secure/Lax HttpOnly
    // cookie (maxAge derived from JWT_EXPIRES_IN, 1d baseline) + rotating
    // refresh (Strict, /api/auth/refresh) + CSRF double-submit. JSON body keeps
    // { user, token } for mobile + web Bearer compat (see AUTH-HTTPONLY-PLAN.md).
    try {
      buildAuthCookies(res, token, refresh.token, csrfToken)
    } catch {}

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        username: (user as any).username || username,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: (user as any).department?.name ?? null,
        incomingYear: user.incomingYear,
        outgoingYear: user.outgoingYear,
        collegeId: user.collegeId,
        collegeName: (user as any).college?.name ?? null,
        portfolioUrl: (user as any).portfolioUrl || null,
      },
      token,
      csrfToken,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', code: 'INVALID_INPUT', requestId: req.requestId || undefined })
      return
    }
    logger.error({ requestId: (req as any).requestId, route: 'POST /api/auth/register' }, 'Register error')
    res.status(500).json({ error: 'Registration failed' })
  }
})

// Login — per-email lockout (5 fails/15m → 429) + generic 401 (no enumeration).
// Dual-issuance (C2): access cookie (1d) + rotating refresh (30d Strict) + CSRF.
// Bearer header still returned for mobile/web compat.
router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body)
    // EMAIL-CASE FIX (legacy-safe): same normalization as register, but the
    // DB lookup is case-INSENSITIVE (findFirst mode:insensitive) so legacy
    // mixed-case rows (`Demo@gmail.com`) are found via `demo@gmail.com`.
    // Exact findUnique missed them → 401 for valid users (reported bug).
    const email = normalizeEmail(body.email)

    try {
      const captchaToken = (req.body as any)?.turnstileToken || (req.body as any)?.captchaToken
      // Only enforce CAPTCHA on login when token present or prod-enforced; dev allows absent
      if (captchaToken || process.env.TURNSTILE_ENFORCE === 'true') {
        const captchaOk = await verifyTurnstile(captchaToken, req.ip)
        if (!captchaOk) {
          res.status(403).json({ error: 'Bot verification failed, please retry' })
          return
        }
      }
    } catch {}

    const lock = isLockedOut(email)
    if (lock.locked) {
      res.setHeader('Retry-After', String(lock.retryAfterSec || 900))
      res.status(429).json({ error: 'Too many failed attempts, try again later' })
      return
    }

    const user = await findUserByEmailInsensitive(prisma as any, email)
    if (!user) {
      recordFailedLogin(email)
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const validPassword = await bcrypt.compare(body.password, user.passwordHash)
    if (!validPassword) {
      recordFailedLogin(email)
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    recordSuccessfulLogin(email)
    // jti-embedded JWT (revocable via RevokedToken / in-memory set)
    const token = signJwtWithJti(user.id).token
    const refresh = signRefreshToken(user.id)
    const csrfToken = generateCsrfToken()
    // HttpOnly dual-issuance (C2): maxAge from config (1d), not hardcoded 7d.
    try {
      buildAuthCookies(res, token, refresh.token, csrfToken)
    } catch {}

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
    // Order 12 CTI read-new (profile-first, User fallback — IDENTICAL shape).
    // Best-effort: pre-migration DBs return nulls → User twins used verbatim.
    let _stud: any = null; let _emp: string | null = null
    try {
      const up = await import('../utils/userProfiles.js').catch(() => null) as any
      if (up?.getUserWithProfiles && up?.resolveStudentFields && up?.resolveStaffEmpNumber) {
        const merged = await up.getUserWithProfiles(prisma, user.id).catch(() => null)
        if (merged) {
          _stud = up.resolveStudentFields(merged.user, merged)
          _emp = up.resolveStaffEmpNumber(merged.user, merged)
        }
      }
    } catch {}
    const _inY = _stud?.incomingYear ?? (user as any).incomingYear ?? null
    const _outY = _stud?.outgoingYear ?? (user as any).outgoingYear ?? null
    const _sid = _stud?.studentId ?? (user as any).studentId ?? null

    // P1 shared-password import + bulk-password nudge (§10): surface flags for the
    // FE dismissible banner (NO route block — nudge only). Best-effort read so
    // pre-migration DBs / stale clients never break login (P2022-tolerant).
    let _mustChange = false
    let _nudge = false
    try {
      const flags = await (prisma as any).user.findUnique({
        where: { id: user.id },
        select: { mustChangePassword: true, passwordNudgeAt: true },
      })
      _mustChange = (flags as any)?.mustChangePassword === true
      _nudge = (flags as any)?.passwordNudgeAt != null
    } catch {}

    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: username || (user as any).username || null,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: (user as any).department?.name ?? null,
        department: userWithCollege?.department,
        incomingYear: _inY,
        outgoingYear: _outY,
        studentId: _sid,
        empNumber: _emp ?? (user as any).empNumber ?? null,
        college: userWithCollege?.college,
        collegeId: user.collegeId,
        portfolioUrl: (user as any).portfolioUrl || null,
        // Nudge-only flags (no login block): FE shows a dismissible banner.
        mustChangePassword: _mustChange,
        passwordNudge: _nudge,
      },
      token,
      csrfToken,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', code: 'INVALID_INPUT', requestId: req.requestId || undefined })
      return
    }
    logger.error({ requestId: (req as any).requestId, route: 'POST /api/auth/login' }, 'Login error')
    res.status(500).json({ error: 'Login failed' })
  }
})

// Change password — authenticated
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(72),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(72, 'New password must be at most 72 characters'),
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

    if (isCommonPassword(body.newPassword)) {
      res.status(400).json({ error: 'Password is too common, choose a stronger password' })
      return
    }
    try {
      const breach = await checkPasswordBreach(body.newPassword)
      if (breach.breached) {
        res.status(400).json({ error: 'Password has appeared in a data breach, choose a different password' })
        return
      }
    } catch {}

    const newHash = await bcrypt.hash(body.newPassword, 12)
    // Clear shared-password flags on successful change (import mustChange +
    // bulk-pw nudge) — best-effort with pre-migration fallback (P2022-tolerant).
    try {
      await (prisma as any).user.update({
        where: { id: req.userId },
        data: { passwordHash: newHash, mustChangePassword: false, passwordNudgeAt: null },
      })
    } catch (err: any) {
      if (err?.code === 'P2022' || /mustChangePassword|passwordNudgeAt/i.test(String(err?.message || ''))) {
        await prisma.user.update({ where: { id: req.userId }, data: { passwordHash: newHash } as any })
      } else throw err
    }
    // Revoke current jti so stolen-session replay ends on password change.
    try { if (req.jwtJti) revokeJti(req.jwtJti) } catch {}
    try { if (req.userId) clearAuthorizeCache(req.userId) } catch {}

    res.json({ message: 'Password updated successfully' })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', code: 'INVALID_INPUT', requestId: req.requestId || undefined })
      return
    }
    logger.error({ requestId: (req as any).requestId, route: 'POST /api/auth/change-password' }, 'Change password error')
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
    // Order 12 CTI read-new (profile-first, User fallback — IDENTICAL shape).
    let _mStud: any = null; let _mEmp: string | null = null
    try {
      const up = await import('../utils/userProfiles.js').catch(() => null) as any
      if (up?.getUserWithProfiles && up?.resolveStudentFields && up?.resolveStaffEmpNumber) {
        const merged = await up.getUserWithProfiles(prisma, (user as any).id).catch(() => null)
        if (merged) {
          _mStud = up.resolveStudentFields(merged.user, merged)
          _mEmp = up.resolveStaffEmpNumber(merged.user, merged)
        }
      }
    } catch {}

    // Nudge-only flags (same contract as login — no route block).
    let _mMustChange = false
    let _mNudge = false
    try {
      _mMustChange = (user as any)?.mustChangePassword === true
      _mNudge = (user as any)?.passwordNudgeAt != null
    } catch {}

    res.json({
      id: user.id,
      name: user.name,
      username: (user as any).username || null,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      department: user.department,
      incomingYear: _mStud?.incomingYear ?? (user as any).incomingYear ?? null,
      outgoingYear: _mStud?.outgoingYear ?? (user as any).outgoingYear ?? null,
      avatar: user.avatar,
      portfolioUrl: (user as any).portfolioUrl || null,
      studentId: _mStud?.studentId ?? (user as any).studentId ?? null,
      empNumber: _mEmp ?? (user as any).empNumber ?? null,
      college: user.college,
      mustChangePassword: _mMustChange,
      passwordNudge: _mNudge,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' })
  }
})

// Refresh — rotating refresh (cf_refresh Strict, /api/auth/refresh path) → new
// access + new refresh + new CSRF. Dual support: accepts refresh via cookie OR
// JSON body { refreshToken } (mobile has no cookie jar). Revokes old refresh jti.
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    let raw: string | undefined
    try {
      const cookieHeader = (req.headers as any).cookie as string | undefined
      if (cookieHeader) {
        const m = cookieHeader.match(/(?:^|;\s*)cf_refresh=([^;]+)/)
        if (m?.[1]) raw = decodeURIComponent(m[1].trim())
      }
      const parsed = (req as any).cookies?.cf_refresh as string | undefined
      if (!raw && parsed) raw = String(parsed)
    } catch {}
    if (!raw && (req.body as any)?.refreshToken) raw = String((req.body as any).refreshToken)
    if (!raw) {
      res.status(401).json({ error: 'No refresh token provided' })
      return
    }
    let decoded: { userId: string; jti: string }
    try {
      decoded = verifyRefreshToken(raw)
    } catch {
      res.status(401).json({ error: 'Invalid refresh token' })
      return
    }
    // Bulk-password mass revoke (follow-up 2026-09-14): reject refresh tokens
    // issued BEFORE the user's passwordNudgeAt (bulk reset marker). Reuses
    // revokeJti for the old refresh jti so replay dies. Nudge-only preserved:
    // fresh logins with the new shared pw (iat >= nudgeAt) pass with only the
    // banner — no login block. Best-effort read (pre-migration/P2022 → allow,
    // fail-open); never logs secrets (counts only).
    try {
      const decodedFull = (await import('jsonwebtoken')).default.decode(raw) as { iat?: number } | null
      const iat = typeof decodedFull?.iat === 'number' ? decodedFull.iat : undefined
      if (typeof iat === 'number') {
        let nudgeAt: unknown = null
        try {
          const row = await (prisma as any).user.findUnique({
            where: { id: (decoded as any).userId },
            select: { passwordNudgeAt: true },
          })
          nudgeAt = (row as any)?.passwordNudgeAt ?? null
        } catch {}
        if (isRefreshTokenStaleAfterBulkReset(iat, nudgeAt as any)) {
          try { revokeJti((decoded as any).jti) } catch {}
          res.status(401).json({ error: 'Invalid refresh token' })
          return
        }
      }
    } catch {}
    // Rotate: revoke old refresh jti, issue new pair
    try { revokeJti(decoded.jti) } catch {}
    const access = signJwtWithJti(decoded.userId)
    const refresh = signRefreshToken(decoded.userId)
    const csrfToken = generateCsrfToken()
    try {
      buildAuthCookies(res, access.token, refresh.token, csrfToken)
    } catch {}
    res.json({ token: access.token, refreshToken: refresh.token, csrfToken })
  } catch {
    res.status(500).json({ error: 'Refresh failed' })
  }
})

// CSRF token endpoint — returns fresh double-submit token (also set as cf_csrf cookie).
// Frontend stores in memory and echoes in X-CSRF-Token for POST/PUT/PATCH/DELETE
// when using cookie auth. Bearer-only clients may skip CSRF (not auto-sent).
router.get('/csrf', (_req: Request, res: Response) => {
  try {
    const csrfToken = generateCsrfToken()
    const isProd = process.env.NODE_ENV === 'production'
    res.cookie('cf_csrf', csrfToken, {
      httpOnly: false,
      secure: isProd,
      sameSite: 'lax',
      maxAge: getCookieMaxAgeMs(),
      path: '/',
    })
    res.json({ csrfToken })
  } catch {
    res.status(500).json({ error: 'Failed to issue CSRF token' })
  }
})

// Logout — revokes current jti (memory + best-effort RevokedToken persist).
// Clears ALL auth cookies with matching attrs (I-5 fix) — Bearer clients drop token client-side.
router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.jwtJti) revokeJti(req.jwtJti)
    // Also revoke refresh presented on logout (if any) to end long-lived session
    try {
      const cookieHeader = (req.headers as any).cookie as string | undefined
      const m = cookieHeader?.match(/(?:^|;\s*)cf_refresh=([^;]+)/)
      if (m?.[1]) {
        try { const d = verifyRefreshToken(decodeURIComponent(m[1].trim())); revokeJti(d.jti) } catch {}
      }
    } catch {}
    try { if (req.userId) clearAuthorizeCache(req.userId) } catch {}
    try { clearAuthCookies(res) } catch {}
    // X-CSRF-Token double-submit: clients must echo cf_csrf cookie value in this header
    // for cookie-authed mutations; Bearer-only requests skip the check (not auto-sent).
    res.json({ message: 'Logged out' })
  } catch {
    res.status(500).json({ error: 'Logout failed' })
  }
})

export default router