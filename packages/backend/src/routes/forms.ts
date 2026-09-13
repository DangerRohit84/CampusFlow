import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import ExcelJS from 'exceljs'
import { notifyUsers } from '../services/notificationService'
import { broadcastFormMutation } from '../services/socket'
import { canAccessCollege, deriveCollegeId, getSuperAdminTargetCollegeId, safeFilename, escapeExcelValue, contentDisposition } from '../utils/roles'
import { logger } from '../utils/logger'
import {
  parseFieldLogic,
  computeScore,
  validateAnswers,
  computeDropoff,
  computeTimeStats,
  computeScoreStats,
  coerceDurationMs,
  type LogicFieldLike,
} from '../utils/formLogic'
import {
  parseFieldOptionsInput,
  buildFormAnswerRows,
  resolveAnswersMap,
  answerToStoredValue,
} from '../utils/childTables'

const router = Router()
router.use(authenticate)

// --- Helpers for form analytics (parity with assignmentHub) ---
function parseJsonArraySafe(value: unknown): string[] {
  try {
    if (!value) return []
    if (Array.isArray(value)) return value as string[]
    if (typeof value === 'string') {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    }
    return []
  } catch { return [] }
}
function parseJsonNumberArraySafe(value: unknown): number[] {
  try {
    if (!value) return []
    if (Array.isArray(value)) return (value as any[]).map(Number).filter(n=> !isNaN(n))
    if (typeof value === 'string') {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(Number).filter(n=> !isNaN(n))
      return []
    }
    return []
  } catch { return [] }
}

// --- Order 10 (V-13-full/V-14): dual-write helpers (expand phase of P5) ---
// Writers fill BOTH the legacy blob AND the 4NF child rows. Best-effort
// try/catch: the child tables may predate migration on some deploys
// (SQLite dev, rolling update) — the blob remains the fallback truth until
// the contract phase drops it (later order, reconciliation-gated).
async function syncFieldOptionRows(fieldId: string, optionsRaw: unknown) {
  try {
    const rows = parseFieldOptionsInput(optionsRaw)
    await (prisma as any).formFieldOption.deleteMany({ where: { fieldId } })
    if (rows.length > 0) {
      await (prisma as any).formFieldOption.createMany({
        data: rows.map((r) => ({ fieldId, value: r.value, label: r.label, points: r.points, order: r.order })),
      })
    }
  } catch (err) {
    logger.debug({ err }, '[forms] field-options dual-write non-fatal')
  }
}

async function syncResponseAnswerRows(responseId: string, storedAnswers: Record<string, unknown>) {
  try {
    const rows = buildFormAnswerRows(storedAnswers)
    await (prisma as any).formAnswer.deleteMany({ where: { responseId } })
    if (rows.length > 0) {
      await (prisma as any).formAnswer.createMany({
        data: rows.map((r) => ({ responseId, fieldId: r.fieldId, value: r.value })),
      })
    }
  } catch (err) {
    logger.debug({ err }, '[forms] answers dual-write non-fatal')
  }
}

// --- #9 Forms logic-lite: sanitize per-question rules + per-option points ---
// Additive + defensive: corrupt/oversized input degrades to "{}" (no rules /
// unscored) instead of 500. Caps keep rows small (logic ≤ ~4KB, scoreMap ≤ 50 entries).
const LOGIC_MAX_CONDITIONS = 5
const LOGIC_MAX_JUMPS = 10
const LOGIC_MAX_STR = 500
const SCORE_MAX_ENTRIES = 50

function clampStr(v: unknown, max = LOGIC_MAX_STR): string {
  const s = String(v ?? '')
  return s.length > max ? s.slice(0, max) : s
}

function sanitizeCondition(raw: any): any | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: any = {}
  const field = raw.fieldId ?? raw.field
  if (typeof field === 'string' && field.trim()) out.field = field.trim().slice(0, 100)
  else if (field !== undefined) return null // condition without source field is meaningless
  else return null
  if (raw.equals !== undefined && raw.equals !== null) out.equals = clampStr(raw.equals)
  if (raw.notEquals !== undefined && raw.notEquals !== null) out.notEquals = clampStr(raw.notEquals)
  if (Array.isArray(raw.in)) out.in = raw.in.slice(0, 20).map((v: any) => clampStr(v))
  if (Array.isArray(raw.notIn)) out.notIn = raw.notIn.slice(0, 20).map((v: any) => clampStr(v))
  if (typeof raw.contains === 'string' && raw.contains) out.contains = clampStr(raw.contains, 200)
  if (raw.notEmpty === true) out.notEmpty = true
  if (raw.empty === true) out.empty = true
  if (Object.keys(out).length <= 1) return null // bare {field} = truthy check — allow
  return out
}

function sanitizeConditionList(raw: unknown): any[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw) ? raw : [raw]
  const out = list.map(sanitizeCondition).filter(Boolean).slice(0, LOGIC_MAX_CONDITIONS)
  return out.length > 0 ? out : undefined
}

function sanitizeJumpRule(raw: any): any | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const to = typeof raw.to === 'string' ? raw.to.trim().slice(0, 100) : ''
  if (!to) return null
  const out: any = { to }
  if (raw.if && typeof raw.if === 'object') {
    const c = sanitizeCondition(raw.if)
    if (c) out.if = c
    else return null
  } else {
    if (raw.equals !== undefined && raw.equals !== null) out.equals = clampStr(raw.equals)
    if (raw.notEquals !== undefined && raw.notEquals !== null) out.notEquals = clampStr(raw.notEquals)
    if (Array.isArray(raw.in)) out.in = raw.in.slice(0, 20).map((v: any) => clampStr(v))
    if (Array.isArray(raw.notIn)) out.notIn = raw.notIn.slice(0, 20).map((v: any) => clampStr(v))
    if (typeof raw.contains === 'string' && raw.contains) out.contains = clampStr(raw.contains, 200)
    if (raw.notEmpty === true) out.notEmpty = true
    if (raw.empty === true) out.empty = true
  }
  return out
}

/** Whitelist logic JSON; invalid → {} object (Order 9 Json col). Never throws. */
export function sanitizeFieldLogic(input: unknown): Record<string, unknown> {
  try {
    if (input === undefined || input === null || input === '') return {}
    const raw: any = typeof input === 'string' ? JSON.parse(input) : input
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: any = {}
    const showIf = sanitizeConditionList(raw.showIf)
    const hideIf = sanitizeConditionList(raw.hideIf)
    const requireIf = sanitizeConditionList(raw.requireIf)
    if (showIf) out.showIf = showIf
    if (hideIf) out.hideIf = hideIf
    if (requireIf) out.requireIf = requireIf
    if (raw.jumpTo !== undefined && raw.jumpTo !== null) {
      const rules = (Array.isArray(raw.jumpTo) ? raw.jumpTo : [raw.jumpTo])
        .map(sanitizeJumpRule).filter(Boolean).slice(0, LOGIC_MAX_JUMPS)
      if (rules.length > 0) out.jumpTo = rules
    }
    const s = JSON.stringify(out)
    return s.length > 4096 ? {} : out
  } catch { return {} }
}

/** Extract {label->points} from options shaped as [{label,points}]. */
function extractPointsFromOptions(options: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  try {
    const arr: any = typeof options === 'string' ? JSON.parse(options) : options
    if (!Array.isArray(arr)) return out
    for (const o of arr) {
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const label = (o as any).label ?? (o as any).value ?? (o as any).text
        const pts = Number((o as any).points ?? (o as any).score)
        if (label !== undefined && label !== null && Number.isFinite(pts)) {
          out[String(label)] = Math.max(-10000, Math.min(10000, pts))
        }
      }
    }
  } catch { /* ignore */ }
  return out
}

/** Whitelist scoreMap JSON; merges inline {label,points} options (explicit wins). Never throws. */
export function sanitizeScoreMap(input: unknown, options?: unknown): Record<string, number> {
  try {
    const merged: Record<string, number> = extractPointsFromOptions(options)
    let raw: any = null
    if (input !== undefined && input !== null && input !== '') {
      raw = typeof input === 'string' ? JSON.parse(input) : input
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      let n = 0
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (n >= SCORE_MAX_ENTRIES) break
        const num = Number(v)
        if (!Number.isFinite(num)) continue
        merged[String(k).slice(0, 200)] = Math.max(-10000, Math.min(10000, num))
        n += 1
      }
    }
    const keys = Object.keys(merged).slice(0, SCORE_MAX_ENTRIES)
    const capped: Record<string, number> = {}
    for (const k of keys) capped[k] = merged[k]
    return capped
  } catch {
    try { return extractPointsFromOptions(options) } catch { return {} }
  }
}

/** Normalize stored options to labels for export/compat (objects → labels). */
function optionsToLabels(optionsRaw: unknown): string[] {
  try {
    const arr: any = typeof optionsRaw === 'string' ? JSON.parse(optionsRaw || '[]') : optionsRaw
    if (!Array.isArray(arr)) return []
    return arr.map((o: any) => {
      if (typeof o === 'string') return o
      if (o && typeof o === 'object') return String(o.label ?? o.value ?? o.text ?? '')
      return String(o ?? '')
    }).filter((s: string) => s !== '')
  } catch { return [] }
}

/** Parse submitted answers (object or JSON string) into a plain map. Never throws. */
function parseAnswersInput(input: unknown): Record<string, unknown> {
  try {
    if (!input) return {}
    if (typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
    if (typeof input === 'string') {
      const p = JSON.parse(input)
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
    }
    return {}
  } catch { return {} }
}

/**
 * #9 builder support: new forms reference questions by client-side `clientId`
 * (e.g. "tmp-0") because real ids don't exist until creation. After the
 * fields are created, rewrite those refs to real ids. Unknown refs are kept
 * as-is (sanitize + visibility helpers ignore dangling targets safely).
 */
function rewriteLogicClientRefs(logicJson: unknown, idByClientId: Map<string, string>): Record<string, unknown> {
  try {
    if (!logicJson || idByClientId.size === 0) return (typeof logicJson === 'object' && logicJson !== null && !Array.isArray(logicJson) ? logicJson : {}) as Record<string, unknown>
    let _lj: any = logicJson
    if (typeof _lj === 'string') { if (_lj === '{}' || !_lj.trim()) return {} as Record<string, unknown>; try { _lj = JSON.parse(_lj) } catch { return {} as Record<string, unknown> } }
    const logic: any = _lj
    if (!logic || typeof logic !== 'object') return (typeof logicJson === 'object' && logicJson !== null ? logicJson : {}) as Record<string, unknown>
    const mapRef = (v: unknown) => {
      if (typeof v !== 'string') return v
      return idByClientId.get(v) ?? v
    }
    const rewriteCond = (c: any) => {
      if (!c || typeof c !== 'object') return
      if (typeof c.field === 'string') c.field = mapRef(c.field) as string
      if (typeof c.fieldId === 'string') c.fieldId = mapRef(c.fieldId) as string
    }
    for (const k of ['showIf', 'hideIf', 'requireIf'] as const) {
      const v = (logic as any)[k]
      if (Array.isArray(v)) v.forEach(rewriteCond)
      else if (v && typeof v === 'object') rewriteCond(v)
    }
    const rules = (logic as any).jumpTo
    const list = Array.isArray(rules) ? rules : rules ? [rules] : []
    for (const r of list) {
      if (!r || typeof r !== 'object') continue
      if (typeof r.to === 'string' && r.to !== '__END__') r.to = mapRef(r.to) as string
      if (r.if && typeof r.if === 'object') rewriteCond(r.if)
    }
    return logic as Record<string, unknown>
  } catch { return (typeof logicJson === 'object' && logicJson !== null ? logicJson : {}) as Record<string, unknown> }
}

/** Best-effort FormView logging — never fails the response (table may predate migration). */
async function logFieldViews(formId: string, userId: string | null, fieldIds: unknown, knownIds: Set<string>) {
  try {
    const list = Array.isArray(fieldIds) ? fieldIds : fieldIds ? [fieldIds] : []
    const clean = [...new Set(list.map((v) => String(v).trim()).filter((v) => v && (v === '__OPEN__' || knownIds.has(v))))].slice(0, 100)
    if (clean.length === 0) return 0
    await prisma.formView.createMany({
      data: clean.map((fid) => ({
        formId,
        fieldId: fid === '__OPEN__' ? null : fid,
        userId: userId || null,
      })),
    })
    return clean.length
  } catch (err) {
    logger.debug({ err }, '[forms] view log non-fatal')
    return 0
  }
}
async function fetchEligibleFormStudents(form: any) {
  const baseSelect = { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true, collegeId: true } as const
  // 1) Room-linked: distinct members across all linked rooms
  const linkRows: { roomId: string }[] = await prisma.formRoom.findMany({ where: { formId: form.id }, select: { roomId: true } })
  const linkedRoomIds = linkRows.map(r=> r.roomId)
  if (linkedRoomIds.length > 0) {
    const members = await prisma.roomMember.findMany({
      where: { roomId: { in: linkedRoomIds } },
      include: { student: { select: baseSelect } }
    })
    const map = new Map<string, any>()
    for (const m of members) {
      const s: any = (m as any).student
      if (s && s.role !== 'STUDENT' && !s.studentId) {
        // still include if role STUDENT check fails due to missing role in select? We selected collegeId but not role — fetch role via extra query if needed
        // fallback: include based on presence
      }
      if (s && !map.has(s.id)) map.set(s.id, s)
    }
    // Ensure we only return students (filter role if available, otherwise keep)
    // Fetch role for deduped ids to filter non-students if college open
    const ids = Array.from(map.keys())
    if (ids.length) {
      const users = await prisma.user.findMany({ where: { id: { in: ids }, role: 'STUDENT' }, select: baseSelect })
      return users
    }
    return Array.from(map.values())
  }
  // 2) Eligibility-enabled department/year targeting
  if (form.eligibilityEnabled) {
    const targetDeptIds = parseJsonArraySafe(form.targetDepartments)
    const targetYears = parseJsonNumberArraySafe(form.targetYears)
    // if no targeting but eligibilityEnabled, treat as no eligible (avoid platform-wide leak)
    if (targetDeptIds.length === 0 && targetYears.length === 0) return []
    // Build base candidate set by department + college
    const where: any = { role: 'STUDENT' as const }
    if (form.collegeId) where.collegeId = form.collegeId
    if (targetDeptIds.length > 0) where.departmentId = { in: targetDeptIds }
    const candidates = await prisma.user.findMany({ where, select: baseSelect })
    if (targetYears.length === 0) return candidates
    // Filter by computed current year
    const nowYear = new Date().getFullYear()
    return candidates.filter((u:any)=> {
      if (!u.incomingYear) return false
      const currentYear = Math.min(nowYear - u.incomingYear + 1, 4)
      return targetYears.includes(currentYear)
    })
  }
  // 3) Open form: all students in same college
  if (form.collegeId) {
    return prisma.user.findMany({ where: { role: 'STUDENT', collegeId: form.collegeId }, select: baseSelect })
  }
  return []
}

// Create form (Teacher)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    const { title, description, fields, allowEdit, expiresAt, targetDepartments, targetYears, eligibilityEnabled, roomIds, collegeId: bodyCollegeId } = req.body
    const derivedCollegeId = deriveCollegeId(user as any, bodyCollegeId as string | null | undefined, req)

    const isCR = user?.role === 'STUDENT' && roomIds?.length > 0 && await prisma.roomMember.findFirst({
      where: {
        studentId: req.userId!,
        isCR: true,
        roomId: { in: roomIds },
      }
    })

    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN' && !isCR)) {
      res.status(403).json({ error: 'Only teachers or CRs can create forms' })
      return
    }

    // SECURITY: validate authority over EVERY requested room before creating the form.
    // The isCR gate above only proves CR status in at least one room; without this
    // per-room check a single CR membership would authorize linking arbitrary rooms,
    // and teachers/admins could target rooms outside their ownership/college.
    let authorizedRoomIds: string[] = []
    if (roomIds && Array.isArray(roomIds) && roomIds.length > 0) {
      const requestedRoomIds = [...new Set<string>(roomIds)]

      const rooms = await prisma.room.findMany({
        where: { id: { in: requestedRoomIds } },
        select: { id: true, teacherId: true, teacher: { select: { collegeId: true } } },
      })
      const roomById = new Map(rooms.map(r => [r.id, r]))

      // Batch-fetch CR memberships once instead of querying per room
      let crRoomIds: string[] = []
      if (user.role === 'STUDENT') {
        crRoomIds = (await prisma.roomMember.findMany({
          where: { studentId: req.userId!, isCR: true, roomId: { in: requestedRoomIds } },
          select: { roomId: true },
        })).map(m => m.roomId)
      }

      authorizedRoomIds = requestedRoomIds.filter((roomId) => {
        const room = roomById.get(roomId)
        if (!room) return false // requested room does not exist
        switch (user.role) {
          case 'SUPER_ADMIN':
            return true
          case 'TEACHER':
            return room.teacherId === user.id
          case 'COLLEGE_ADMIN':
            return room.teacher?.collegeId === user.collegeId
          case 'STUDENT':
            return crRoomIds.includes(roomId)
          default:
            return false
        }
      })

      if (authorizedRoomIds.length !== requestedRoomIds.length) {
        res.status(403).json({
          error: 'You are not authorized to post to one or more selected rooms',
          unauthorizedCount: requestedRoomIds.length - authorizedRoomIds.length,
        })
        return
      }
    }

    const form = await prisma.form.create({
      data: {
        creatorId: req.userId!,
        collegeId: derivedCollegeId,
        title,
        description,
        status: 'ACTIVE',
        allowEdit: allowEdit || false,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        // Order 3: canonical Json arrays (helpers accept array or legacy JSON-string).
        targetDepartments: parseJsonArraySafe(targetDepartments) as any,
        targetYears: parseJsonNumberArraySafe(targetYears) as any,
        eligibilityEnabled: eligibilityEnabled || false,
        fields: {
          create: fields?.map((f: any, i: number) => ({
            label: f.label,
            type: f.type || 'TEXT',
            required: f.required || false,
            options: JSON.stringify(f.options || []),
            order: i,
            logic: sanitizeFieldLogic(f.logic) as any,
            scoreMap: sanitizeScoreMap(f.scoreMap, f.options) as any,
          })) || [],
        },
      },
      include: { fields: { orderBy: { order: 'asc' } } },
    })

    // #9: resolve builder clientId refs (tmp-*) to real field ids (single pass).
    try {
      const inputFields: any[] = Array.isArray(fields) ? fields : []
      const hasClientRefs = inputFields.some((f: any) => typeof f?.clientId === 'string' && f.clientId.startsWith('tmp-'))
      if (hasClientRefs && (form as any).fields?.length === inputFields.length) {
        const idByClientId = new Map<string, string>()
        inputFields.forEach((f: any, i: number) => {
          if (typeof f?.clientId === 'string' && (form as any).fields[i]?.id) {
            idByClientId.set(f.clientId, (form as any).fields[i].id)
          }
        })
        if (idByClientId.size > 0) {
          await Promise.all(
            (form as any).fields.map((created: any, i: number) => {
              const rawLogic = sanitizeFieldLogic(inputFields[i]?.logic)
              const rewritten = rewriteLogicClientRefs(rawLogic, idByClientId)
              if (JSON.stringify(rewritten) === JSON.stringify((created as any).logic)) return Promise.resolve(created)
              return prisma.formField.update({ where: { id: created.id }, data: { logic: rewritten as any } }).catch(() => created)
            }),
          )
          const refreshed = await prisma.form.findUnique({ where: { id: form.id }, include: { fields: { orderBy: { order: 'asc' } } } })
          if (refreshed) (form as any).fields = (refreshed as any).fields
        }
      }
    } catch (err) { logger.debug({ err }, '[forms] clientId rewrite non-fatal') }

    // Order 10: dual-write options blob → FormFieldOption rows (best-effort).
    try {
      const inputFields: any[] = Array.isArray(fields) ? fields : []
      await Promise.all(
        ((form as any).fields || []).map((created: any, i: number) =>
          syncFieldOptionRows(created.id, inputFields[i]?.options),
        ),
      )
    } catch (err) { logger.debug({ err }, '[forms] create options dual-write non-fatal') }

    // Link rooms to form if provided (only authority-validated rooms)
    // HALF1: single createMany (was N+1 sequential creates in loop).
    if (authorizedRoomIds.length > 0) {
      await prisma.formRoom.createMany({
        data: authorizedRoomIds.map((roomId) => ({ formId: form.id, roomId })),
        skipDuplicates: true,
      })
    }

    // Notify target students (fire-and-forget)
    try {
      const creatorName = user.name
      let targetUserIds: string[] = []

      if (authorizedRoomIds.length > 0) {
        // Form linked to rooms — notify all members of those rooms, excluding creator
        const members = await prisma.roomMember.findMany({
          where: { roomId: { in: authorizedRoomIds }, studentId: { not: req.userId! } },
          select: { studentId: true },
        })
        targetUserIds = members.map((m: any) => m.studentId)
      } else {
        // No rooms — notify all STUDENT users of the same college, excluding creator.
        // SUPER_ADMIN uses derivedCollegeId (target college), not own null.
        const notifyCollegeId = derivedCollegeId || user.collegeId
        const students = notifyCollegeId
          ? await prisma.user.findMany({
              where: { role: 'STUDENT', collegeId: notifyCollegeId, id: { not: req.userId! } },
              select: { id: true },
            })
          : []
        targetUserIds = students.map((s: any) => s.id)
      }

      if (targetUserIds.length > 0) {
        await notifyUsers(targetUserIds, {
          title: 'New Form Posted',
          message: `${creatorName} posted a new form: ${title}`,
          type: 'FORM',
          source: form.id,
        })
      }
    } catch (err) {
      logger.error({ err: err }, 'Form notification error:')
    }

    try { broadcastFormMutation(form.id, (form as { collegeId?: string | null }).collegeId ?? null) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.status(201).json(form)
  } catch (error) {
    logger.error({ err: error }, 'Create form error:')
    res.status(500).json({ error: 'Failed to create form' })
  }
})

// Get all forms (paginated, trimmed counts, indexed)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()

    // Build role-based where — SUPER_ADMIN scoped to ?collegeId= when inside a college workspace
    let where: any = undefined
    let includeFields = false // only include fields/response counts, not full blobs

    if (user.role === 'SUPER_ADMIN') {
      const scopedCollegeId = getSuperAdminTargetCollegeId(req)
      where = scopedCollegeId ? { collegeId: scopedCollegeId } : {}
    } else if (user.role === 'COLLEGE_ADMIN' || user.role === 'TEACHER') {
      const teacherRoomIds = (await prisma.room.findMany({
        where: { teacherId: req.userId },
        select: { id: true },
      })).map((r) => r.id)
      const deptBranch = user.collegeId && user.departmentId
        ? [{ collegeId: user.collegeId, creator: { departmentId: user.departmentId } }]
        : []
      where = {
        OR: [
          { creatorId: req.userId },
          ...deptBranch,
          { formRooms: { some: { roomId: { in: teacherRoomIds } } } },
        ],
      }
    } else {
      const studentRoomIds = (await prisma.roomMember.findMany({
        where: { studentId: req.userId },
        select: { roomId: true },
      })).map((m) => m.roomId)
      const deptBranch = user.collegeId && user.departmentId
        ? [{ collegeId: user.collegeId, creator: { departmentId: user.departmentId } }]
        : []
      const studentClauses = [
        ...deptBranch,
        { formRooms: { some: { roomId: { in: studentRoomIds } } } },
      ]
      if (studentClauses.length === 0) {
        res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
        res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } })
        return
      }
      where = { status: 'ACTIVE', OR: studentClauses }
    }

    if (search) {
      const s: any = { contains: search, mode: 'insensitive' }
      const searchClause = { OR: [{ title: s }, { description: s }] }
      where = where ? { AND: [where, searchClause] } : searchClause
    }

    // Trimmed: creators minimal, _count for responses/fields, no full answer blobs
    const [forms, total] = await Promise.all([
      prisma.form.findMany({
        where,
        include: {
          creator: { select: { name: true } },
          _count: { select: { fields: true, responses: true } },
          formRooms: { include: { room: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.form.count({ where }),
    ])

    // Attach per-user myResponse for student card tags (Submitted/Pending) — parity with assignmentHub
    let myResponseMap = new Map<string, any>()
    if (user.role === 'STUDENT' && forms.length > 0) {
      const myResponses = await prisma.formResponse.findMany({
        where: { userId: req.userId!, formId: { in: forms.map((f: any) => f.id) } },
        select: { formId: true, id: true, submittedAt: true },
      })
      myResponseMap = new Map(myResponses.map((r: any) => [r.formId, r]))
    }

    const data = forms.map((f: any) => ({
      ...f,
      fields: Array(f._count.fields).fill({}),
      responses: Array(f._count.responses).fill({}),
      responsesCount: f._count.responses,
      fieldsCount: f._count.fields,
      myResponse: myResponseMap.get(f.id) || null,
      _count: undefined,
    }))

    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (error) {
    logger.error({ err: error }, 'Get forms error:')
    res.status(500).json({ error: 'Failed to fetch forms' })
  }
})

// Update form (Teacher or CR of linked room)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const existingForm = await prisma.form.findUnique({ where: { id: req.params.id as string } })
    if (!existingForm) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    // SECURITY: tenant isolation — global (collegeId=null) only SUPER_ADMIN may edit; tenants need exact match (canAccessCollege)
    if (!canAccessCollege(user as any, existingForm.collegeId)) {
      res.status(403).json({ error: 'You do not have permission to edit this form' })
      return
    }

    const isOwner = user.role === 'TEACHER' && existingForm.creatorId === req.userId
    const isAdmin = user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCRofLinkedRoom = user.role === 'STUDENT' && await prisma.formRoom.findFirst({
      where: {
        formId: req.params.id as string,
        room: { members: { some: { studentId: req.userId!, isCR: true } } },
      }
    })

    if (!isOwner && !isAdmin && !isCRofLinkedRoom) {
      res.status(403).json({ error: 'You do not have permission to edit this form' })
      return
    }

    const { title, description, allowEdit, expiresAt, targetDepartments, targetYears, eligibilityEnabled } = req.body
    const form = await prisma.form.update({
      where: { id: req.params.id as string },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(allowEdit !== undefined && { allowEdit }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        // Order 3: canonical Json arrays (local helpers accept array-or-String).
        ...(targetDepartments !== undefined && { targetDepartments: parseJsonArraySafe(targetDepartments) as any }),
        ...(targetYears !== undefined && { targetYears: parseJsonNumberArraySafe(targetYears) as any }),
        ...(eligibilityEnabled !== undefined && { eligibilityEnabled }),
      },
    })
    try { broadcastFormMutation(form.id, (form as { collegeId?: string | null }).collegeId ?? null) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json(form)
  } catch (error) {
    logger.error({ err: error }, 'Update form error:')
    res.status(500).json({ error: 'Failed to update form' })
  }
})

// Update form fields (Teacher or CR of linked room)
router.put('/:id/fields', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const existingForm = await prisma.form.findUnique({ where: { id: req.params.id as string } })
    if (!existingForm) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    if (!canAccessCollege(user as any, existingForm.collegeId)) {
      res.status(403).json({ error: 'You do not have permission to edit this form' })
      return
    }

    const isOwner = user.role === 'TEACHER' && existingForm.creatorId === req.userId
    const isAdmin = user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCRofLinkedRoom = user.role === 'STUDENT' && await prisma.formRoom.findFirst({
      where: {
        formId: req.params.id as string,
        room: { members: { some: { studentId: req.userId!, isCR: true } } },
      }
    })

    if (!isOwner && !isAdmin && !isCRofLinkedRoom) {
      res.status(403).json({ error: 'You do not have permission to edit this form' })
      return
    }

    const { fields } = req.body
    if (!Array.isArray(fields)) {
      res.status(400).json({ error: 'Fields must be an array' })
      return
    }

    // Delete existing fields and recreate
    await prisma.formField.deleteMany({ where: { formId: req.params.id as string } })

    const created = await Promise.all(
      fields.map((f: any, i: number) =>
        prisma.formField.create({
          data: {
            formId: req.params.id as string,
            label: f.label,
            type: f.type || 'TEXT',
            required: f.required || false,
            options: JSON.stringify(f.options || []),
            order: i,
            logic: sanitizeFieldLogic(f.logic) as any,
            scoreMap: sanitizeScoreMap(f.scoreMap, f.options) as any,
          },
        })
      )
    )

    // Order 10: dual-write options blob → FormFieldOption rows (best-effort).
    // Placed before the logic-ref remap so both return paths stay covered
    // (remap only touches `logic`, never options).
    try {
      const inputFields: any[] = Array.isArray(fields) ? fields : []
      await Promise.all(
        (created as any[]).map((row: any, i: number) =>
          syncFieldOptionRows(row.id, inputFields[i]?.options),
        ),
      )
    } catch (err) { logger.debug({ err }, '[forms] fields-save options dual-write non-fatal') }

    // #9: remap logic refs after delete+recreate (old real ids + tmp clientIds → new ids).
    // Without this, every fields-save would orphan showIf/jumpTo targets.
    try {
      const refMap = new Map<string, string>()
      fields.forEach((f: any, i: number) => {
        const newId = (created as any[])[i]?.id
        if (!newId) return
        if (typeof f?.id === 'string' && f.id) refMap.set(f.id, newId)
        if (typeof f?.clientId === 'string' && f.clientId) refMap.set(f.clientId, newId)
      })
      if (refMap.size > 0) {
        const needsRewrite = fields.some((f: any) => {
          const _s: any = sanitizeFieldLogic(f?.logic)
          const _ss = typeof _s === 'string' ? _s : JSON.stringify(_s)
          return _ss !== '{}' && [...refMap.keys()].some((k) => _ss.includes(k))
        })
        if (needsRewrite) {
          await Promise.all(
            (created as any[]).map((row: any, i: number) => {
              const rewritten = rewriteLogicClientRefs(sanitizeFieldLogic((fields as any[])[i]?.logic), refMap)
              if (JSON.stringify(rewritten) === JSON.stringify((row as any).logic)) return Promise.resolve(row)
              return prisma.formField.update({ where: { id: row.id }, data: { logic: rewritten as any } }).catch(() => row)
            }),
          )
          const refreshed = await prisma.formField.findMany({ where: { formId: req.params.id as string }, orderBy: { order: 'asc' } })
          try { broadcastFormMutation(req.params.id as string) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
          res.json(refreshed)
          return
        }
      }
    } catch (err) { logger.debug({ err }, '[forms] fields ref remap non-fatal') }

    try { broadcastFormMutation(req.params.id as string) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json(created)
  } catch (error) {
    logger.error({ err: error }, 'Update fields error:')
    res.status(500).json({ error: 'Failed to update fields' })
  }
})

// Stats for a form — eligible / submitted / pending / rate (teacher/CR only)
router.get('/:id/stats', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: user + form independent → Promise.all (was sequential).
    const [user, form] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }), // NARROW-READ half1
      prisma.form.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    if (!form) { res.status(404).json({ error: 'Form not found' }); return }
    if (!canAccessCollege(user as any, form.collegeId)) {
      res.status(403).json({ error: 'Access denied' }); return
    }
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCR = user.role === 'STUDENT' && await prisma.formRoom.findFirst({ where: { formId: form.id, room: { members: { some: { studentId: req.userId!, isCR: true } } } } })
    if (!isTeacher && !isCR) { res.status(403).json({ error: 'Only teachers/CRs can view stats' }); return }
    // HALF1: eligible list + submitted count independent → Promise.all (was sequential).
    const [eligibleList, submitted] = await Promise.all([
      fetchEligibleFormStudents(form),
      prisma.formResponse.count({ where: { formId: form.id } }),
    ])
    const eligible = eligibleList.length
    const pending = Math.max(0, eligible - submitted)
    const submissionRate = eligible ? Math.round((submitted/eligible)*100) : 0
    // CACHE-ALL: aggregate counts only (no respondent PII) — private edge SWR.
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({ eligible, submitted, pending, submissionRate, pendingCount: pending, eligibleCount: eligible })
  } catch (e) { logger.error({ err: e }, 'Form stats error'); res.status(500).json({ error: 'Failed to get stats' }) }
})

// Pending students for a form — eligible minus submitted
router.get('/:id/pending', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: user + form independent → Promise.all (was sequential).
    const [user, form] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }), // NARROW-READ half1
      prisma.form.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    if (!form) { res.status(404).json({ error: 'Form not found' }); return }
    if (!canAccessCollege(user as any, form.collegeId)) {
      res.status(403).json({ error: 'Access denied' }); return
    }
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCR = user.role === 'STUDENT' && await prisma.formRoom.findFirst({ where: { formId: form.id, room: { members: { some: { studentId: req.userId!, isCR: true } } } } })
    if (!isTeacher && !isCR) { res.status(403).json({ error: 'Only teachers/CRs can view pending' }); return }
    // HALF1: eligible + responses independent → Promise.all (was sequential).
    const [eligible, responses] = await Promise.all([
      fetchEligibleFormStudents(form),
      prisma.formResponse.findMany({ where: { formId: form.id }, select: { userId: true } }),
    ])
    const submittedIds = new Set(responses.map(r=> r.userId))
    const pending = eligible.filter((u:any)=> !submittedIds.has(u.id))
    pending.sort((a:any,b:any)=> (a.name||'').localeCompare(b.name||''))
    res.json({ data: pending, total: pending.length, count: pending.length })
  } catch (e) { logger.error({ err: e }, 'Form pending error'); res.status(500).json({ error: 'Failed to get pending' }) }
})

// #9 Forms logic-lite analytics — drop-off per question + time-to-complete + scores.
// Teacher/CR only (same gate as /stats). Views come from FormView logs; when the
// migration hasn't applied yet the endpoint degrades (views fallback to totals).
router.get('/:id/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const [user, form] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }),
      prisma.form.findUnique({ where: { id: req.params.id as string }, include: { fields: { orderBy: { order: 'asc' } } } }),
    ])
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    if (!form) { res.status(404).json({ error: 'Form not found' }); return }
    if (!canAccessCollege(user as any, (form as any).collegeId)) {
      res.status(403).json({ error: 'Access denied' }); return
    }
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCR = user.role === 'STUDENT' && await prisma.formRoom.findFirst({ where: { formId: (form as any).id, room: { members: { some: { studentId: req.userId!, isCR: true } } } } })
    if (!isTeacher && !isCR) { res.status(403).json({ error: 'Only teachers/CRs can view analytics' }); return }

    const fields = ((form as any).fields || []).map((f: any) => ({
      id: f.id, label: f.label, type: f.type, required: !!f.required,
      options: f.options, logic: (f as any).logic ?? '{}', scoreMap: (f as any).scoreMap ?? '{}', order: f.order ?? 0,
    })) as LogicFieldLike[]

    let responses: any[] = []
    try {
      responses = await prisma.formResponse.findMany({
        where: { formId: (form as any).id },
        select: { id: true, answers: true, score: true, durationMs: true, submittedAt: true },
      })
    } catch (err) {
      logger.debug({ err }, '[forms] analytics responses fallback (pre-migration columns?)')
      responses = await prisma.formResponse.findMany({ where: { formId: (form as any).id }, select: { id: true, answers: true } as any }) as any[]
    }

    let viewCounts: Record<string, number> = {}
    let viewsDegraded = false
    try {
      const grouped: Array<{ fieldId: string | null; _count: { fieldId: number } }> = await (prisma as any).formView.groupBy({
        by: ['fieldId'],
        where: { formId: (form as any).id, fieldId: { not: null } },
        _count: { fieldId: true },
      })
      for (const g of grouped) {
        if (g.fieldId) viewCounts[g.fieldId] = (g as any)._count?.fieldId ?? 0
      }
    } catch (err) {
      viewsDegraded = true
      logger.debug({ err }, '[forms] analytics views fallback (FormView pre-migration)')
    }

    const dropoff = computeDropoff(fields, responses as any, viewCounts)
    const time = computeTimeStats(responses.map((r: any) => (r as any).durationMs))
    const scores = computeScoreStats(responses.map((r: any) => typeof (r as any).score === 'number' ? (r as any).score : null))

    // Order 10 (V-14): per-option distribution — SQL GROUP BY on FormAnswer
    // when child rows exist, blob fallback otherwise. Capped at 200 distinct
    // values per field (TEXT fields stay unbounded; truncated flag marks it).
    const DISTRIBUTION_CAP = 200
    let answersSource: 'child' | 'blob' | 'empty' = responses.length === 0 ? 'empty' : 'blob'
    let distributions: Array<{ fieldId: string; label: string; total: number; counts: Record<string, number>; truncated: boolean; source: 'child' | 'blob' }> = []
    try {
      const responseIds = responses.map((r: any) => r.id).filter(Boolean)
      let childGroups: Array<{ fieldId: string; value: string; _count: number }> = []
      if (responseIds.length > 0) {
        try {
          const raw: any[] = await (prisma as any).formAnswer.groupBy({
            by: ['fieldId', 'value'],
            where: { responseId: { in: responseIds } },
            _count: true,
          })
          childGroups = raw.map((g: any) => ({
            fieldId: String(g.fieldId),
            value: String(g.value ?? ''),
            _count: typeof g._count === 'number' ? g._count : Number(g?._count?._all ?? 0),
          }))
        } catch (err) {
          logger.debug({ err }, '[forms] analytics child groupBy fallback (FormAnswer pre-migration)')
          childGroups = []
        }
      }
      if (childGroups.length > 0) {
        answersSource = 'child'
        const byField = new Map<string, Array<{ value: string; n: number }>>()
        for (const g of childGroups) {
          if (!byField.has(g.fieldId)) byField.set(g.fieldId, [])
          byField.get(g.fieldId)!.push({ value: g.value, n: g._count })
        }
        distributions = fields.map((f: any) => {
          const list = (byField.get(f.id) || []).sort((a, b) => b.n - a.n)
          const total = list.reduce((s, e) => s + e.n, 0)
          const truncated = list.length > DISTRIBUTION_CAP
          const counts: Record<string, number> = {}
          for (const e of list.slice(0, DISTRIBUTION_CAP)) counts[e.value] = e.n
          return { fieldId: f.id, label: f.label || f.id, total, counts, truncated, source: 'child' as const }
        })
      } else if (responses.length > 0) {
        answersSource = 'blob'
        const parsed = responses.map((r: any) => resolveAnswersMap({ answers: (r as any)?.answers }))
        distributions = fields.map((f: any) => {
          const counts: Record<string, number> = {}
          for (const a of parsed) {
            const v = answerToStoredValue((a as any)[f.id])
            if (!v) continue
            counts[v] = (counts[v] ?? 0) + 1
          }
          const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
          const total = keys.reduce((s, k) => s + counts[k], 0)
          const truncated = keys.length > DISTRIBUTION_CAP
          const capped: Record<string, number> = {}
          for (const k of keys.slice(0, DISTRIBUTION_CAP)) capped[k] = counts[k]
          return { fieldId: f.id, label: f.label || f.id, total, counts: capped, truncated, source: 'blob' as const }
        })
      }
    } catch (err) {
      logger.debug({ err }, '[forms] analytics distributions non-fatal')
      distributions = []
    }

    const maxScore = fields.reduce((sum, f) => {
      try {
        const raw: any = typeof (f as any).scoreMap === 'string' ? JSON.parse((f as any).scoreMap || '{}') : ((f as any).scoreMap || {})
        const vals = Object.values(raw).map(Number).filter(Number.isFinite) as number[]
        // Checkbox multi-select can earn the sum of all positive options.
        const positives = vals.filter((v) => v > 0)
        if (String((f as any).type).toUpperCase() === 'CHECKBOX') return sum + positives.reduce((a, b) => a + b, 0)
        return sum + (vals.length ? Math.max(...vals, 0) : 0)
      } catch { return sum }
    }, 0)

    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({
      formId: (form as any).id,
      totalResponses: responses.length,
      dropoff,
      time: { ...time, medianMs: time.medianMs },
      scores: { ...scores, maxScore },
      viewsDegraded,
      // Order 10 (V-14): per-option counts now SQL-queryable. Read-new with
      // blob fallback: FormAnswer GROUP BY when child rows exist, otherwise
      // the same canonical counting over the blob (parity by construction —
      // both sides use answerToStoredValue).
      distributions,
      answersSource,
    })
  } catch (e) { logger.error({ err: e }, 'Form analytics error'); res.status(500).json({ error: 'Failed to get analytics' }) }
})

// #9 log question views for drop-off analytics (fire-and-forget from respondent UI).
// Body: { fieldId?: string, fieldIds?: string[] } — capped, validated against form fields.
router.post('/:id/view', async (req: AuthRequest, res: Response) => {
  try {
    const form = await prisma.form.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, fields: { select: { id: true } } },
    })
    if (!form) { res.status(404).json({ error: 'Form not found' }); return }
    const knownIds = new Set<string>(((form as any).fields || []).map((f: any) => String(f.id)))
    const input = (req.body as any)?.fieldIds ?? (req.body as any)?.viewedFieldIds ?? (req.body as any)?.fieldId
    const logged = await logFieldViews(req.params.id as string, req.userId || null, input, knownIds)
    res.json({ logged })
  } catch (e) {
    logger.debug({ err: e }, '[forms] view log failed')
    res.json({ logged: 0 })
  }
})

// Get single form with fields
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // 10k scale: responses cursor pagination (take:50 max) + count.
    // BEFORE: unbounded include.responses (10k rows + user joins in one payload).
    // AFTER: form fetched without responses; responses fetched separately with
    // take:50 + count. Same shape (form.responses array) + form.responsesPagination
    // meta for compat (old clients ignore the extra field).
    const responsesLimitParam = parseInt(String(req.query.responsesLimit || req.query.limit || '50'), 10)
    const responsesLimit = Number.isFinite(responsesLimitParam) ? Math.min(50, Math.max(1, responsesLimitParam)) : 50
    const responsesPage = Math.max(1, parseInt(String(req.query.responsesPage || req.query.page || '1'), 10) || 1)
    const responsesCursor = req.query.responsesCursor
      ? String(req.query.responsesCursor)
      : req.query.cursor
        ? String(req.query.cursor)
        : null
    const form = await prisma.form.findUnique({
      where: { id: req.params.id as string },
      include: {
        creator: { select: { name: true, email: true, empNumber: true } },
        fields: { orderBy: { order: 'asc' } },
        formRooms: {
          include: { room: { select: { id: true, name: true } } }
        },
      },
    })

    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    // Teachers/College Admin: must be creator OR form linked to their rooms
    if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN') {
      const isCreator = form.creatorId === req.userId
      if (!isCreator) {
        const teacherRoomIds = (await prisma.room.findMany({
          where: { teacherId: req.userId },
          select: { id: true },
        })).map(r => r.id)
        const linkedToMyRoom = form.formRooms?.some((fr: any) => teacherRoomIds.includes(fr.roomId))
        if (!linkedToMyRoom) {
          res.status(403).json({ error: 'Access denied' })
          return
        }
      }
    }

    // Students: must be active + linked to their room or same department
    if (user.role === 'STUDENT') {
      if (form.status !== 'ACTIVE') {
        res.status(403).json({ error: 'Access denied' })
        return
      }
      const studentRoomIds = (await prisma.roomMember.findMany({
        where: { studentId: req.userId },
        select: { roomId: true },
      })).map(m => m.roomId)
      const linkedToMyRoom = form.formRooms?.some((fr: any) => studentRoomIds.includes(fr.roomId))
      let sameDept = false
      // Order 3: canonical Json (local helper accepts Json or legacy String).
      {
        const targetDepts = parseJsonArraySafe((form as any).targetDepartments)
        sameDept = !!user.departmentId && Array.isArray(targetDepts) && targetDepts.includes(user.departmentId)
      }
      // SECURITY: an "open" form is only open within its own college —
      // never platform-wide. (This branch is STUDENT-only; SUPER_ADMIN
      // bypasses it entirely above.)
      const _td = (form as any).targetDepartments
      const isEmptyTarget = Array.isArray(_td) ? _td.length === 0 : (!_td || _td === '[]')
      const noRestrictions =
        !form.eligibilityEnabled &&
        isEmptyTarget &&
        form.collegeId === user.collegeId
      if (!linkedToMyRoom && !sameDept && !noRestrictions) {
        res.status(403).json({ error: 'Access denied' })
        return
      }
    }

    const responsesWhere: any = { formId: (form as any).id }
    const responsesCursorClause: any = responsesCursor
      ? { cursor: { id: responsesCursor }, skip: 1 }
      : { skip: (responsesPage - 1) * responsesLimit }
    const [responses, responsesTotal] = await Promise.all([
      prisma.formResponse.findMany({
        where: responsesWhere,
        include: { user: { select: { id: true, name: true, email: true, studentId: true, departmentId: true, incomingYear: true, collegeId: true, department: { select: { name: true } } } } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: responsesLimit,
        ...responsesCursorClause,
      }),
      prisma.formResponse.count({ where: responsesWhere }),
    ])
    const responsesPages = Math.ceil(responsesTotal / responsesLimit)
    const responsesNextCursor =
      responses.length === responsesLimit ? (responses[responses.length - 1] as any)?.id ?? null : null
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({
      ...(form as any),
      responses,
      responsesCount: responsesTotal,
      responsesPagination: {
        page: responsesPage,
        limit: responsesLimit,
        total: responsesTotal,
        pages: responsesPages,
        nextCursor: responsesNextCursor,
      },
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch form' })
  }
})

// Submit form response (Student)
router.post('/:id/respond', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can submit responses' })
      return
    }

    const form = await prisma.form.findUnique({
      where: { id: req.params.id as string },
      include: { fields: true },
    })

    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    // Check room-based eligibility first
    const formRooms = await prisma.formRoom.findMany({
      where: { formId: req.params.id as string },
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

    // SECURITY: a form with no room links and no eligibility rules is open to
    // every student *within its college* — never platform-wide. (This handler
    // is STUDENT-only; SUPER_ADMIN is rejected above.)
    if (formRooms.length === 0 && !form.eligibilityEnabled && form.collegeId !== user.collegeId) {
      res.status(403).json({ error: 'You are not eligible for this form' })
      return
    }

    // Check eligibility if enabled — AI codes (CSE/IT/ALL) resolve to departmentIds
    if (form.eligibilityEnabled) {
      // Order 3: canonical Json (local helpers accept Json or legacy String).
      const targetDepts = parseJsonArraySafe((form as any).targetDepartments)
      const targetYears = parseJsonNumberArraySafe((form as any).targetYears)

      // Must match department if targetDepartments specified (handles AI codes + UUIDs + ALL)
      if (targetDepts.length > 0) {
        const { isDepartmentEligible, getCollegeDepartments } = await import('../utils/eligibility')
        const collegeDepts = await getCollegeDepartments(form.collegeId || user.collegeId)
        if (!isDepartmentEligible(targetDepts, user.departmentId, collegeDepts)) {
          res.status(403).json({ error: 'Your department is not eligible for this form' })
          return
        }
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

    // #9 logic-lite: hidden-aware validation + server-computed score.
    // Hidden (showIf/hideIf/jumpTo-skipped) questions are NEVER required and
    // their answers are stripped before storage so skipped branches don't
    // pollute analytics/scoring. Score is always recomputed server-side.
    const rawAnswers = parseAnswersInput(req.body.answers)
    const logicFields = ((form as any).fields || []).map((f: any) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: !!f.required,
      options: f.options,
      logic: (f as any).logic ?? '{}',
      scoreMap: (f as any).scoreMap ?? '{}',
      order: f.order ?? 0,
    })) as LogicFieldLike[]
    const validation = validateAnswers(logicFields, rawAnswers)
    if (!validation.ok) {
      const firstKey = Object.keys(validation.errors)[0]
      res.status(400).json({ error: validation.errors[firstKey], errors: validation.errors, hiddenIds: validation.hiddenIds })
      return
    }
    const hiddenSet = new Set(validation.hiddenIds)
    const storedAnswers: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rawAnswers)) {
      if (!hiddenSet.has(k)) storedAnswers[k] = v
    }
    const { total: computedScore } = computeScore(logicFields, rawAnswers)
    const durationMs = coerceDurationMs((req.body as any).durationMs, (req.body as any).startedAt)
    let startedAt: Date | null = null
    try {
      if ((req.body as any).startedAt) {
        const t = new Date((req.body as any).startedAt)
        if (Number.isFinite(t.getTime()) && t.getTime() <= Date.now()) startedAt = t
      }
    } catch { startedAt = null }
    const knownIds = new Set(logicFields.map((f) => (f as any).id))

    // Check if already responded
    const existing = await prisma.formResponse.findUnique({
      where: { formId_userId: { formId: req.params.id as string, userId: req.userId! } },
    })

    // Enforce allowEdit setting
    if (!form.allowEdit && existing) {
      res.status(403).json({ error: 'This form does not allow editing responses' })
      return
    }

    let finalResponse: any
    if (existing) {
      // Update existing response (recompute score/duration; keep original startedAt if already set)
      finalResponse = await prisma.formResponse.update({
        where: { id: existing.id },
        data: {
          answers: JSON.stringify(storedAnswers),
          score: Math.round(computedScore),
          ...(durationMs !== null ? { durationMs } : {}),
          ...(!((existing as any).startedAt) && startedAt ? { startedAt } : {}),
        },
      })
      // Order 10: dual-write blob → FormAnswer rows (best-effort, then reply).
      await syncResponseAnswerRows(finalResponse.id, storedAnswers)
      res.json(finalResponse)
    } else {
      // Create new response
      finalResponse = await prisma.formResponse.create({
        data: {
          formId: req.params.id as string,
          userId: req.userId!,
          answers: JSON.stringify(storedAnswers),
          score: Math.round(computedScore),
          ...(startedAt ? { startedAt } : {}),
          ...(durationMs !== null ? { durationMs } : {}),
        },
      })
      // Order 10: dual-write blob → FormAnswer rows (best-effort, then reply).
      await syncResponseAnswerRows(finalResponse.id, storedAnswers)
      res.status(201).json(finalResponse)
    }
    // Best-effort view logging for drop-off analytics (never fails the submit).
    try {
      const viewed = (req.body as any).viewedFieldIds ?? (req.body as any).fieldViews ?? (req.body as any).views
      if (viewed !== undefined) await logFieldViews(req.params.id as string, req.userId || null, viewed, knownIds)
    } catch (err) { logger.debug({ err }, '[forms] post-submit view log non-fatal') }
    try { broadcastFormMutation(req.params.id as string) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
  } catch (error) {
    logger.error({ err: error }, 'Submit form error:')
    res.status(500).json({ error: 'Failed to submit response' })
  }
})

// Extend form expiration (Teacher only)
router.post('/:id/extend', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can extend forms' })
      return
    }

    const { expiresAt } = req.body
    if (!expiresAt) {
      res.status(400).json({ error: 'expiresAt is required' })
      return
    }

    const form = await prisma.form.findUnique({ where: { id: req.params.id as string } })
    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    if (!canAccessCollege(user as any, form.collegeId)) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }

    // Check ownership for TEACHER role
    if (user.role === 'TEACHER' && form.creatorId !== req.userId) {
      res.status(403).json({ error: 'Can only extend your own forms' })
      return
    }

    const updated = await prisma.form.update({
      where: { id: req.params.id as string },
      data: { expiresAt: new Date(expiresAt) },
    })

    try { broadcastFormMutation(updated.id, (updated as { collegeId?: string | null }).collegeId ?? null) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Extend form error:')
    res.status(500).json({ error: 'Failed to extend form' })
  }
})

// Export form responses to Excel
router.get('/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const form = await prisma.form.findUnique({
      where: { id: req.params.id as string },
      include: {
        fields: { orderBy: { order: 'asc' } },
        responses: {
          include: {
            user: { select: { name: true, email: true, studentId: true, department: { select: { name: true } } } },
            // Order 10: read-new (child rows) with blob fallback in the loop
            // below. If the table predates migration this include throws —
            // retry without it (blob-only) instead of 500ing the export.
            answerRows: true,
          },
        },
      },
    }).catch(async () => prisma.form.findUnique({
      where: { id: req.params.id as string },
      include: {
        fields: { orderBy: { order: 'asc' } },
        responses: {
          include: { user: { select: { name: true, email: true, studentId: true, department: { select: { name: true } } } } },
        },
      },
    }))

    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    if (!canAccessCollege(user as any, form.collegeId)) {
      res.status(403).json({ error: 'Access denied' })
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
    
    // Headers (#9: Score column for quiz-style scoring)
    const columns = [
      { header: 'S.No', key: 'sno', width: 8 },
      { header: 'Roll No', key: 'rollNo', width: 15 },
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Submitted At', key: 'submittedAt', width: 20 },
      { header: 'Score', key: 'score', width: 10 },
    ]

    // Add form field columns
    for (const field of form.fields) {
      columns.push({ header: field.label, key: field.label, width: 25 })
    }

    sheet.columns = columns

    // Rows — F27: escape every user-controlled cell (formula injection).
    form.responses.forEach((resp, idx) => {
      // Order 10: child rows win when present, else the legacy blob
      // (byte-identical blob path — no display drift during transition).
      let answers: any = {}
      const childMap = resolveAnswersMap(resp as any)
      if (Object.keys(childMap).length > 0 || (resp as any).answerRows?.length > 0) {
        answers = childMap
      } else {
        try {
          answers = JSON.parse(resp.answers)
        } catch { answers = {} }
      }
      const row: any = {
        sno: idx + 1,
        rollNo: escapeExcelValue(resp.user.studentId || ''),
        name: escapeExcelValue(resp.user.name),
        email: escapeExcelValue(resp.user.email),
        department: escapeExcelValue(((resp.user as any).department?.name || '')),
        submittedAt: resp.submittedAt.toLocaleDateString(),
        score: typeof (resp as any).score === 'number' ? (resp as any).score : 0,
      }

      // Add field answers
      for (const field of form.fields) {
        row[field.label] = escapeExcelValue(answers[field.id] || '')
      }

      sheet.addRow(row)
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    // F17: sanitize title (strip CR/LF/quotes) + RFC5987 filename*.
    res.setHeader('Content-Disposition', contentDisposition(`${safeFilename(form.title, 'form')}_responses.xlsx`))
    
    const buffer = await workbook.xlsx.writeBuffer()
    res.send(Buffer.from(buffer as any))
  } catch (error) {
    logger.error({ err: error }, 'Export form error:')
    res.status(500).json({ error: 'Failed to export' })
  }
})

// Delete form (Creator only)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: form + user independent → Promise.all (was sequential).
    const [form, user] = await Promise.all([
      prisma.form.findUnique({ where: { id: req.params.id as string } }),
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true } }), // NARROW-READ half1
    ])
    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    if (user && !canAccessCollege(user as any, form.collegeId)) {
      res.status(403).json({ error: 'You do not have permission to delete this form' })
      return
    }
    const isOwner = form.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
    const isCRofLinkedRoom = user?.role === 'STUDENT' && await prisma.formRoom.findFirst({
      where: {
        formId: req.params.id as string,
        room: { members: { some: { studentId: req.userId!, isCR: true } } },
      }
    })

    if (!isOwner && !isAdmin && !isCRofLinkedRoom) {
      res.status(403).json({ error: 'You do not have permission to delete this form' })
      return
    }

    await prisma.form.delete({ where: { id: req.params.id as string } })
    try { broadcastFormMutation(req.params.id as string) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: 'Form deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete form' })
  }
})

export default router
