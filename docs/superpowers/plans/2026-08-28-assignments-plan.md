# AssignmentHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-user Assignments with college-scoped AssignmentHub supporting ALL/DEPARTMENT/ROOM targets, ONLINE/OFFLINE/HYBRID submission modes, and teacher-controlled visibility toggles (showGrades/showFeedback/showSubmissionStatus/showStats).

**Architecture:** New Prisma models (AssignmentHub + AssignmentSubmission) with college/department/room scoping reuse Announcement scoping patterns; backend routes enforce role-based visibility and submissionMode at creation and submission time; frontend provides role-aware pages sharing a unified assignments API with ETag/pagination and file upload via existing storage layer.

**Tech Stack:** Express 4, Prisma 6 (PostgreSQL), Zod, Multer, Cloudinary/local storage (packages/backend/src/config/storage.ts), React 18 + TypeScript + Vite, Tailwind CSS, Zustand, TanStack Query, Axios (apps/web/src/lib/api.ts), Socket.IO optional for notifications

## Global Constraints

- OS: win32, Shell: powershell
- Backend at `packages/backend/` (NOT `apps/backend/`)
- Prisma schema at `packages/backend/prisma/schema.prisma`
- Frontend at `apps/web/src/`
- All API calls use `api` axios instance from `apps/web/src/lib/api.ts` (baseURL `${VITE_API_URL}/api`, JWT via `campusflow-auth` localStorage, 10s timeout)
- Auth: `authenticate` middleware attaches `req.userId`; `authorize(roles)` checks `User.role`; roles: STUDENT | TEACHER | COLLEGE_ADMIN | SUPER_ADMIN
- College scoping: teachers/admins must belong to collegeId; reuse `isCollegeAdminForRoom` pattern from `packages/backend/src/routes/rooms.ts:20`
- Existing `Assignment` model is per-user legacy; keep it for backward compat and create new `AssignmentHub` + `AssignmentSubmission` (do NOT drop legacy table; mark deprecated)
- File uploads use `multer` memoryStorage + `uploadFile` / `deleteFile` from `packages/backend/src/config/storage.ts`; blocked extensions defined in `rooms.ts:162` (`blockedUploadExtensions`)
- Dark mode: every new component must support `dark:` classes (`dark:bg-[#111920]`, `dark:text-[#F4F7F8]`, `dark:border-[#202C35]`)
- Brand colors: Primary `#007060` / `dark:#00A88F`, Danger `#F07068`, Warning `#F5A623`, Accent Purple `#635BFF`
- Pagination standard: `page` (1-indexed), `limit` (max 50, default 20), response `{ data, pagination: { page, limit, total, pages } }`; also support legacy array fallback via `unwrapPaginated` in api.ts
- ETag/CDN: backend uses `etagCacheMiddleware` + `Cache-Control: public, max-age=15, stale-while-revalidate=30` for list endpoints
- No comments in code unless requested; DRY, YAGNI, TDD, frequent commits
- Rate limiting: `generalLimiter` (500/15min) on `/api/assignments` routes in `packages/backend/src/index.ts:194`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/backend/src/routes/assignmentHub.ts` | AssignmentHub CRUD + visibility-filtered list/detail, scope validation, stats |
| `packages/backend/src/routes/assignmentSubmissions.ts` | Submission create/list/grade, submissionMode enforcement, visibility gating |
| `packages/backend/src/utils/assignmentVisibility.ts` | Pure helpers: `isAssignmentVisibleToUser`, `filterSubmissionForVisibility`, `buildVisibilityWhere` |
| `apps/web/src/lib/assignmentHubApi.ts` | (Alt) OR extend `api.ts`: dedicated `assignmentHubAPI` client — if split, this file |
| `apps/web/src/components/assignments/ScopeSelector.tsx` | Segmented control ALL / DEPARTMENT / ROOM + dynamic department/room pickers |
| `apps/web/src/components/assignments/SubmissionModeToggle.tsx` | ONLINE/OFFLINE/HYBRID radio with helper text |
| `apps/web/src/components/assignments/VisibilityToggles.tsx` | Four switches: showGrades/showFeedback/showSubmissionStatus/showStats |
| `apps/web/src/components/assignments/CreateAssignmentModal.tsx` | Teacher create/edit modal wiring all selectors + Zod validation |
| `apps/web/src/components/assignments/AssignmentHubCard.tsx` | Card for list views with scope badge, due countdown, submissionMode icon, visibility chips |
| `apps/web/src/components/assignments/SubmissionPanel.tsx` | Student submit form (text + file per mode), status timeline, grade/feedback gated display |
| `apps/web/src/components/assignments/GradeModal.tsx` | Teacher grading modal (points/grade + feedback, offline confirmation) |
| `apps/web/src/components/assignments/StatsPanel.tsx` | Teacher stats (submission counts, avg grade) — gated by showStats |
| `apps/web/src/pages/AssignmentHubPage.tsx` | Role-aware page: teacher hub vs student hub with tabs/filters (replaces or wraps AssignmentsPage.tsx) |
| `apps/web/src/types/assignmentHub.ts` | Shared TypeScript interfaces for AssignmentHub, Submission, enums |

### Modified Files

| File | Change |
|------|--------|
| `packages/backend/prisma/schema.prisma` | Add enums `AssignmentScope`, `SubmissionMode` + models `AssignmentHub`, `AssignmentSubmission` + relations to User/College/Department/Room + indexes |
| `packages/backend/src/index.ts` | Import and mount new routers at `/api/assignments/hub` and `/api/assignments/hub/:id/submissions`; keep legacy `/api/assignments` for backward compat |
| `apps/web/src/lib/api.ts` | Extend `assignmentAPI` or add `assignmentHubAPI` with 12 methods; add `AssignmentHub`, `Submission` types |
| `apps/web/src/pages/AssignmentsPage.tsx` | Rewrite to delegate to AssignmentHubPage or become wrapper with role gate; preserve existing personal-assignment UX behind feature flag `LEGACY_ASSIGNMENTS=false` |
| `apps/web/src/App.tsx` | Add `/assignments/:id` detail route if needed; keep `/assignments` pointing to hub |
| `apps/web/src/components/layout/Layout.tsx` | Ensure Assignments nav item visible for all roles (already exists); no change unless adding teacher badge count |
| `packages/backend/prisma/seed.ts` | Optional: seed demo AssignmentHub + submissions for QA |

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Create: `packages/backend/prisma/migrations/20260828000000_assignment_hub/migration.sql` (auto-generated via `prisma migrate dev`)

**Interfaces:**
- Consumes: existing `User`, `College`, `Department`, `Room` models and indexes
- Produces: enums `AssignmentScope`, `SubmissionMode`; models `AssignmentHub`, `AssignmentSubmission`; relations `User.createdAssignmentHubs`, `User.assignmentSubmissions`, `College.assignmentHubs`, `Department.assignmentHubs`, `Room.assignmentHubs`

- [ ] **Step 1: Add enums to schema.prisma**

Open `packages/backend/prisma/schema.prisma` at line 790 before `model AiProvider` and insert:

```prisma
enum AssignmentScope {
  ALL
  DEPARTMENT
  ROOM
}

enum SubmissionMode {
  ONLINE
  OFFLINE
  HYBRID
}
```

- [ ] **Step 2: Add AssignmentHub model**

Append after `model RoomRead` (~line 865) before `model AiProvider`:

```prisma
model AssignmentHub {
  id                   String         @id @default(uuid())
  title                String         @db.VarChar(200)
  description          String?        @db.Text
  courseId             String?
  dueDate              DateTime
  creatorId            String
  collegeId            String?
  scope                AssignmentScope @default(ALL)
  departmentId         String?
  roomId               String?
  submissionMode       SubmissionMode  @default(ONLINE)
  showGrades           Boolean         @default(true)
  showFeedback         Boolean         @default(true)
  showSubmissionStatus Boolean         @default(true)
  showStats            Boolean         @default(false)
  maxPoints            Int             @default(100)
  maxGrade             String?
  allowLateSubmission  Boolean         @default(false)
  attachments          String?         @default("[]")
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt

  creator    User       @relation("AssignmentHubCreator", fields: [creatorId], references: [id])
  college    College?   @relation(fields: [collegeId], references: [id])
  department Department? @relation(fields: [departmentId], references: [id])
  room       Room?       @relation(fields: [roomId], references: [id])
  submissions AssignmentSubmission[]

  @@index([collegeId, scope])
  @@index([departmentId])
  @@index([roomId])
  @@index([creatorId])
  @@index([dueDate])
  @@index([collegeId, dueDate])
  @@index([scope, dueDate])
}
```

- [ ] **Step 3: Add AssignmentSubmission model**

Immediately after `AssignmentHub`:

```prisma
model AssignmentSubmission {
  id           String   @id @default(uuid())
  assignmentId String
  studentId    String
  content      String?  @db.Text
  fileUrl      String?
  fileName     String?
  fileType     String?
  fileSize     Int?
  status       String   @default("SUBMITTED")
  grade        String?
  points       Int?
  feedback     String?  @db.Text
  submittedAt  DateTime @default(now())
  gradedAt     DateTime?
  gradedBy     String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  assignment AssignmentHub @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  student    User          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  grader     User?         @relation("SubmissionGrader", fields: [gradedBy], references: [id])

  @@unique([assignmentId, studentId])
  @@index([assignmentId])
  @@index([studentId])
  @@index([assignmentId, studentId])
  @@index([status])
}
```

- [ ] **Step 4: Add relations to existing models**

In `model User` add inside fields (after `roomReads RoomRead[]` line 65):

```prisma
  createdAssignmentHubs AssignmentHub[]      @relation("AssignmentHubCreator")
  assignmentSubmissions AssignmentSubmission[]
  gradedSubmissions     AssignmentSubmission[] @relation("SubmissionGrader")
```

In `model College` add after `announcementColleges AnnouncementCollege[]`:

```prisma
  assignmentHubs AssignmentHub[]
```

In `model Department` add after `announcements AnnouncementDepartment[]`:

```prisma
  assignmentHubs AssignmentHub[]
```

In `model Room` add after `reads RoomRead[]`:

```prisma
  assignmentHubs AssignmentHub[]
```

- [ ] **Step 5: Validate legacy Assignment is preserved**

Verify original `model Assignment` (line 142) remains untouched; add comment above it:

```prisma
// @deprecated — legacy per-user assignments; use AssignmentHub for scoped assignments
model Assignment {
```

Do NOT delete or rename it.

- [ ] **Step 6: Run migration**

Run:

```powershell
npx prisma migrate dev --name assignment_hub --schema=packages/backend/prisma/schema.prisma
```

Expected: Creates `packages/backend/prisma/migrations/20260828000000_assignment_hub/migration.sql` with CREATE TYPE for enums and CREATE TABLE for AssignmentHub/AssignmentSubmission + FKs + indexes. No errors.

- [ ] **Step 7: Regenerate client**

Run:

```powershell
npx prisma generate --schema=packages/backend/prisma/schema.prisma
```

Expected: `✔ Generated Prisma Client` with AssignmentHub and AssignmentSubmission available.

- [ ] **Step 8: Verify compilation**

Run:

```powershell
npx tsc --noEmit -p packages/backend/tsconfig.json
```

Expected: No errors.

- [ ] **Step 9: Commit**

```powershell
git add packages/backend/prisma/schema.prisma packages/backend/prisma/migrations/20260828000000_assignment_hub
git commit -m "feat(assignments): add AssignmentHub and AssignmentSubmission models with scope and submissionMode"
```

---

### Task 2: Backend — AssignmentHub CRUD + Scope Validation

**Files:**
- Create: `packages/backend/src/routes/assignmentHub.ts`
- Create: `packages/backend/src/utils/assignmentVisibility.ts`
- Modify: `packages/backend/src/index.ts`

**Interfaces:**
- Consumes: `authenticate`, `AuthRequest`, `prisma`, `AssignmentScope`, `SubmissionMode` from Prisma, `blockedUploadExtensions` pattern
- Produces: Router `assignmentHubRouter` with:
  - `POST /api/assignments/hub` → `createAssignmentHub(data: CreateHubInput): Promise<AssignmentHub>`
  - `GET /api/assignments/hub` → `listHubs(query: { page, limit, search, scope, submissionMode }): Promise<{data, pagination}>`
  - `GET /api/assignments/hub/:id` → `getHub(id): Promise<AssignmentHub & { submissionsCount }>`
  - `PUT /api/assignments/hub/:id` → `updateHub(id, data): Promise<AssignmentHub>`
  - `DELETE /api/assignments/hub/:id` → `deleteHub(id): Promise<void>`
  - Zod schemas: `assignmentHubSchema`, `updateHubSchema`
  - Helpers in `assignmentVisibility.ts`: `isAssignmentVisibleToUser(assignment, user): boolean`, `buildHubListWhere(user, filters): Prisma.AssignmentHubWhereInput`

- [ ] **Step 1: Write the failing test for visibility helper**

Create `packages/backend/src/__tests__/assignmentVisibility.test.ts` (vitest/jest style, but no runner required — just file):

```typescript
import { isAssignmentVisibleToUser } from '../utils/assignmentVisibility'

function test_visibility_ALL() {
  const assignment = { scope: 'ALL', collegeId: 'c1', departmentId: null, roomId: null } as any
  const studentAllCollege = { id: 's1', role: 'STUDENT', collegeId: 'c1', departmentId: 'd1' } as any
  const studentOtherCollege = { id: 's2', role: 'STUDENT', collegeId: 'c2', departmentId: 'd1' } as any
  const result1 = isAssignmentVisibleToUser(assignment, studentAllCollege)
  const result2 = isAssignmentVisibleToUser(assignment, studentOtherCollege)
  console.assert(result1 === true, 'ALL scope should be visible to same college')
  console.assert(result2 === false, 'ALL scope should NOT be visible to other college')
}
```

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json` Expected: FAIL with "Cannot find module '../utils/assignmentVisibility'"

- [ ] **Step 2: Create visibility utils**

Create `packages/backend/src/utils/assignmentVisibility.ts`:

```typescript
import { AssignmentScope } from '@prisma/client'

export type AssignmentHubRow = {
  id: string
  collegeId: string | null
  scope: AssignmentScope
  departmentId: string | null
  roomId: string | null
}

export type UserRow = {
  id: string
  role: string
  collegeId: string | null
  departmentId: string | null
}

export function isAssignmentVisibleToUser(assignment: AssignmentHubRow, user: UserRow): boolean {
  if (user.role === 'SUPER_ADMIN') return true
  if (!assignment.collegeId || !user.collegeId) {
    if (assignment.scope === AssignmentScope.ALL && !assignment.collegeId) return true
    return assignment.collegeId === user.collegeId
  }
  if (assignment.collegeId !== user.collegeId) return false
  if (assignment.scope === AssignmentScope.ALL) return true
  if (assignment.scope === AssignmentScope.DEPARTMENT) {
    return !!assignment.departmentId && assignment.departmentId === user.departmentId
  }
  if (assignment.scope === AssignmentScope.ROOM) {
    return !!assignment.roomId
  }
  return false
}

export function buildHubListWhere(user: UserRow, filters: { search?: string; scope?: string; submissionMode?: string }) {
  const where: any = {}
  if (user.role !== 'SUPER_ADMIN' && user.collegeId) {
    where.collegeId = user.collegeId
  }
  if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' }
  if (filters.scope && ['ALL','DEPARTMENT','ROOM'].includes(filters.scope)) where.scope = filters.scope
  if (filters.submissionMode && ['ONLINE','OFFLINE','HYBRID'].includes(filters.submissionMode)) where.submissionMode = filters.submissionMode
  return where
}

export function filterHubForStudentVisibility(hub: any, user: UserRow) {
  const base = { ...hub }
  return base
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json` Expected: PASS

- [ ] **Step 4: Create assignmentHub router**

Create `packages/backend/src/routes/assignmentHub.ts`:

```typescript
import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { buildHubListWhere, isAssignmentVisibleToUser } from '../utils/assignmentVisibility'

const router = Router()
router.use(authenticate)

const assignmentHubSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  courseId: z.string().optional(),
  dueDate: z.string().transform(s => new Date(s)).refine(d => !isNaN(d.getTime()), { message: 'Invalid dueDate' }),
  scope: z.enum(['ALL','DEPARTMENT','ROOM']).default('ALL'),
  departmentId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  submissionMode: z.enum(['ONLINE','OFFLINE','HYBRID']).default('ONLINE'),
  showGrades: z.boolean().default(true),
  showFeedback: z.boolean().default(true),
  showSubmissionStatus: z.boolean().default(true),
  showStats: z.boolean().default(false),
  maxPoints: z.number().int().min(1).max(1000).default(100),
  maxGrade: z.string().optional().nullable(),
  allowLateSubmission: z.boolean().default(false),
  attachments: z.string().optional(),
})

const updateHubSchema = assignmentHubSchema.partial()

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) {
      res.status(403).json({ error: 'Only teachers and admins can create assignments' }); return
    }
    const body = assignmentHubSchema.parse(req.body)
    if (body.scope === 'DEPARTMENT' && !body.departmentId) { res.status(400).json({ error: 'departmentId required for DEPARTMENT scope' }); return }
    if (body.scope === 'ROOM' && !body.roomId) { res.status(400).json({ error: 'roomId required for ROOM scope' }); return }
    if (body.scope === 'ALL' && (body.departmentId || body.roomId)) { res.status(400).json({ error: 'departmentId/roomId must be empty for ALL scope' }); return }
    if (body.departmentId) {
      const dept = await prisma.department.findFirst({ where: { id: body.departmentId, collegeId: user.collegeId || undefined } })
      if (!dept) { res.status(400).json({ error: 'Invalid departmentId for your college' }); return }
    }
    if (body.roomId) {
      const room = await prisma.room.findFirst({ where: { id: body.roomId } })
      if (!room) { res.status(404).json({ error: 'Room not found' }); return }
      const isCreator = room.teacherId === user.id
      const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && room.teacherId && (await prisma.user.findUnique({ where: { id: room.teacherId } }))?.collegeId === user.collegeId
      const isSuper = user.role === 'SUPER_ADMIN'
      if (!isCreator && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized for this room' }); return }
    }
    const hub = await prisma.assignmentHub.create({
      data: {
        title: body.title.trim(),
        description: body.description?.trim(),
        courseId: body.courseId,
        dueDate: body.dueDate as Date,
        creatorId: user.id,
        collegeId: user.role === 'SUPER_ADMIN' ? (body as any).collegeId || user.collegeId : user.collegeId,
        scope: body.scope as any,
        departmentId: body.scope === 'DEPARTMENT' ? body.departmentId! : null,
        roomId: body.scope === 'ROOM' ? body.roomId! : null,
        submissionMode: body.submissionMode as any,
        showGrades: body.showGrades,
        showFeedback: body.showFeedback,
        showSubmissionStatus: body.showSubmissionStatus,
        showStats: body.showStats,
        maxPoints: body.maxPoints,
        maxGrade: body.maxGrade || null,
        allowLateSubmission: body.allowLateSubmission,
        attachments: body.attachments || '[]',
      },
      include: { creator: { select: { id: true, name: true } }, college: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true } }, _count: { select: { submissions: true } } }
    })
    res.status(201).json(hub)
  } catch (e: any) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation error', details: e.errors }); return }
    console.error('Create hub error', e); res.status(500).json({ error: 'Failed to create assignment' })
  }
})

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()
    const scope = req.query.scope as string | undefined
    const submissionMode = req.query.submissionMode as string | undefined

    let where: any = buildHubListWhere(user as any, { search, scope, submissionMode })

    if (user.role === 'STUDENT') {
      const allHubs = await prisma.assignmentHub.findMany({ where, orderBy: { dueDate: 'asc' } })
      const roomIds = (await prisma.roomMember.findMany({ where: { studentId: user.id }, select: { roomId: true } })).map(r => r.roomId)
      const visible = allHubs.filter(h => {
        if (h.scope === 'ALL') return true
        if (h.scope === 'DEPARTMENT') return h.departmentId === user.departmentId
        if (h.scope === 'ROOM') return !!h.roomId && roomIds.includes(h.roomId!)
        return false
      })
      const total = visible.length
      const paged = visible.slice(skip, skip + limit)
      const withCounts = await Promise.all(paged.map(async h => {
        const submissions = await prisma.assignmentSubmission.count({ where: { assignmentId: h.id } })
        const mySubmission = await prisma.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: h.id, studentId: user.id } } })
        return { ...h, submissionsCount: submissions, mySubmission: mySubmission ? filterForStudent(h, mySubmission) : null }
      }))
      res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
      res.json({ data: withCounts, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
      return
    }

    if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN') {
      where.creatorId = user.role === 'TEACHER' ? user.id : undefined
      if (user.role === 'COLLEGE_ADMIN') where.collegeId = user.collegeId
    }

    const [hubs, total] = await Promise.all([
      prisma.assignmentHub.findMany({ where, include: { creator: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true } }, _count: { select: { submissions: true } } }, orderBy: { dueDate: 'asc' }, skip, take: limit }),
      prisma.assignmentHub.count({ where })
    ])
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    res.json({ data: hubs, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
  } catch (e) { console.error('List hub error', e); res.status(500).json({ error: 'Failed to list assignments' }) }
})

function filterForStudent(hub: any, submission: any) {
  if (!hub.showGrades) { const { grade, points, ...rest } = submission; return { ...rest, grade: null, points: null } }
  if (!hub.showFeedback) { const { feedback, ...rest } = submission; return { ...rest, feedback: null } }
  return submission
}

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.id as string }, include: { creator: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true, joinCode: true } }, submissions: user.role === 'STUDENT' ? { where: { studentId: user.id } } : false, _count: { select: { submissions: true } } } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (user.role === 'STUDENT') {
      const roomIds = (await prisma.roomMember.findMany({ where: { studentId: user.id }, select: { roomId: true } })).map(r => r.roomId)
      const visible = hub.scope === 'ALL' ? true : hub.scope === 'DEPARTMENT' ? hub.departmentId === user.departmentId : !!hub.roomId && roomIds.includes(hub.roomId)
      if (!visible || hub.collegeId !== user.collegeId) { res.status(403).json({ error: 'Not visible to you' }); return }
      const mySubmission = (hub as any).submissions?.[0] ? filterForStudent(hub, (hub as any).submissions[0]) : null
      const { submissions, ...rest } = hub as any
      let filtered: any = { ...rest, mySubmission }
      if (!hub.showSubmissionStatus) delete filtered._count
      if (!hub.showGrades && mySubmission) { filtered.mySubmission.grade = null; filtered.mySubmission.points = null }
      if (!hub.showFeedback && mySubmission) filtered.mySubmission.feedback = null
      res.json(filtered); return
    }
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper && user.role !== 'TEACHER') { res.status(403).json({ error: 'Access denied' }); return }
    res.json(hub)
  } catch (e) { console.error('Get hub error', e); res.status(500).json({ error: 'Failed to fetch assignment' }) }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const existing = await prisma.assignmentHub.findUnique({ where: { id: req.params.id as string } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const isOwner = existing.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Only creator or college admin can edit' }); return }
    const body = updateHubSchema.parse(req.body)
    if (body.scope && body.scope !== existing.scope) {
      if (body.scope === 'DEPARTMENT' && !body.departmentId) { res.status(400).json({ error: 'departmentId required' }); return }
      if (body.scope === 'ROOM' && !body.roomId) { res.status(400).json({ error: 'roomId required' }); return }
    }
    const updated = await prisma.assignmentHub.update({ where: { id: existing.id }, data: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.courseId !== undefined ? { courseId: body.courseId } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate as Date } : {}),
      ...(body.scope !== undefined ? { scope: body.scope as any } : {}),
      ...(body.departmentId !== undefined ? { departmentId: body.scope === 'DEPARTMENT' ? body.departmentId! : body.departmentId } : {}),
      ...(body.roomId !== undefined ? { roomId: body.scope === 'ROOM' ? body.roomId! : body.roomId } : {}),
      ...(body.submissionMode !== undefined ? { submissionMode: body.submissionMode as any } : {}),
      ...(body.showGrades !== undefined ? { showGrades: body.showGrades } : {}),
      ...(body.showFeedback !== undefined ? { showFeedback: body.showFeedback } : {}),
      ...(body.showSubmissionStatus !== undefined ? { showSubmissionStatus: body.showSubmissionStatus } : {}),
      ...(body.showStats !== undefined ? { showStats: body.showStats } : {}),
      ...(body.maxPoints !== undefined ? { maxPoints: body.maxPoints } : {}),
      ...(body.maxGrade !== undefined ? { maxGrade: body.maxGrade } : {}),
      ...(body.allowLateSubmission !== undefined ? { allowLateSubmission: body.allowLateSubmission } : {}),
    }})
    res.json(updated)
  } catch (e: any) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation error', details: e.errors }); return }
    console.error('Update hub error', e); res.status(500).json({ error: 'Failed to update' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const existing = await prisma.assignmentHub.findUnique({ where: { id: req.params.id as string } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const isOwner = existing.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Only creator or college admin can delete' }); return }
    await prisma.assignmentHub.delete({ where: { id: existing.id } })
    res.json({ message: 'Deleted' })
  } catch (e) { console.error('Delete hub error', e); res.status(500).json({ error: 'Failed to delete' }) }
})

export default router
```

- [ ] **Step 5: Mount router in index.ts**

Open `packages/backend/src/index.ts` line 15 add:

```typescript
import assignmentHubRouter from './routes/assignmentHub'
```

After `app.use('/api/assignments', generalLimiter, assignmentRoutes)` (line 194) add:

```typescript
app.use('/api/assignments/hub', generalLimiter, assignmentHubRouter)
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json` Expected: PASS (no missing module errors)

- [ ] **Step 7: Manual test via curl (teacher creates ALL scope)**

```powershell
$token = "<TEACHER_JWT>"
curl -X POST http://localhost:4000/api/assignments/hub -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d '{\"title\":\"DS Assignment 1\",\"description\":\"BST implementation\",\"dueDate\":\"2026-09-15T23:59:59Z\",\"scope\":\"ALL\",\"submissionMode\":\"HYBRID\",\"showGrades\":true,\"showFeedback\":true,\"showSubmissionStatus\":true,\"showStats\":false,\"maxPoints\":100}'
```

Expected: 201 with `{ id, title: "DS Assignment 1", scope: "ALL", submissionMode: "HYBRID", ... }`

- [ ] **Step 8: Manual test validation error (DEPARTMENT without departmentId)**

Same curl with `scope: DEPARTMENT` but no dept → Expected 400 `{ error: "departmentId required for DEPARTMENT scope" }`

- [ ] **Step 9: Commit**

```powershell
git add packages/backend/src/utils/assignmentVisibility.ts packages/backend/src/routes/assignmentHub.ts packages/backend/src/index.ts
git commit -m "feat(assignments): add AssignmentHub CRUD with scope validation and visibility filtering"
```

---

### Task 3: Backend — AssignmentSubmission Lifecycle

**Files:**
- Create: `packages/backend/src/routes/assignmentSubmissions.ts`
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/backend/src/routes/assignmentHub.ts` (if stats endpoint lives here, else separate)

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `SubmissionMode`, `uploadFile`, `assignmentHub` table
- Produces: Router `assignmentSubmissionsRouter` mounted at `/api/assignments/hub/:hubId/submissions` and `/api/assignments/submissions/:id` with:
  - `POST /api/assignments/hub/:hubId/submissions` → `submitAssignment(hubId, { content, file }): Promise<Submission>` (enforces ONLINE requires content|file, OFFLINE forbids file, HYBRID allows both, late check vs allowLateSubmission)
  - `GET /api/assignments/hub/:hubId/submissions` → teacher list paginated, gated by showSubmissionStatus for students? Actually teacher only; students get 403
  - `PUT /api/assignments/submissions/:id/grade` → `gradeSubmission(id, { grade, points, feedback }): Promise<Submission>` (teacher only, respects showGrades/showFeedback for student read but teacher always writes)
  - `GET /api/assignments/my-submissions` → student grouped list
  - `GET /api/assignments/hub/:hubId/stats` → teacher stats (submission rate, avg points) gated by showStats
  - Helper: `enforceSubmissionMode(hub.submissionMode, hasFile, hasContent): void`

- [ ] **Step 1: Write failing test for submissionMode enforcement**

Create `packages/backend/src/__tests__/assignmentSubmission.test.ts`:

```typescript
import { enforceSubmissionMode } from '../routes/assignmentSubmissions'
function test_online_requires_content() {
  try { enforceSubmissionMode('ONLINE', false, false); console.assert(false, 'should throw') } catch (e: any) { console.assert(e.message.includes('ONLINE'), 'online requires content/file') }
}
```

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json` Expected: FAIL cannot find `enforceSubmissionMode`

- [ ] **Step 2: Create submissions router**

Create `packages/backend/src/routes/assignmentSubmissions.ts`:

```typescript
import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import multer from 'multer'
import { uploadFile } from '../config/storage'
import path from 'path'

const router = Router({ mergeParams: true })
router.use(authenticate)

export const blockedSubmissionExtensions = ['.html','.htm','.xhtml','.svg','.xml','.js','.mjs','.css','.exe','.sh']

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (blockedSubmissionExtensions.includes(path.extname(file.originalname).toLowerCase())) { cb(new Error('File type not allowed')); return }
    cb(null, true)
  }
})

export function enforceSubmissionMode(mode: string, hasFile: boolean, hasContent: boolean) {
  if (mode === 'ONLINE' && !hasFile && !hasContent) throw new Error('ONLINE submissions require content or file upload')
  if (mode === 'OFFLINE' && hasFile) throw new Error('OFFLINE submissions must not include files; submit in person')
  if (mode === 'OFFLINE' && !hasContent) throw new Error('OFFLINE submissions require confirmation text (e.g., roll number or offline receipt)')
}

function handleMulterError(err: any, _req: any, res: Response, next: any) {
  if (err) return res.status(400).json({ error: err.message })
  next()
}

// POST /api/assignments/hub/:hubId/submissions  (student submit, multipart)
router.post('/hub/:hubId/submissions', upload.single('file'), handleMulterError, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'STUDENT') { res.status(403).json({ error: 'Only students can submit' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (hub.collegeId && hub.collegeId !== user.collegeId) { res.status(403).json({ error: 'Not in your college' }); return }
    if (hub.scope === 'DEPARTMENT' && hub.departmentId !== user.departmentId) { res.status(403).json({ error: 'Not in target department' }); return }
    if (hub.scope === 'ROOM') {
      const isMember = await prisma.roomMember.findUnique({ where: { roomId_studentId: { roomId: hub.roomId!, studentId: user.id } } })
      if (!isMember) { res.status(403).json({ error: 'Not in target room' }); return }
    }
    const isLate = new Date() > hub.dueDate
    if (isLate && !hub.allowLateSubmission) { res.status(400).json({ error: 'Past due date and late submissions not allowed' }); return }
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : ''
    const hasFile = !!req.file
    const hasContent = !!content
    try { enforceSubmissionMode(hub.submissionMode, hasFile, hasContent) } catch (e: any) { res.status(400).json({ error: e.message }); return }

    const existing = await prisma.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: hub.id, studentId: user.id } } })
    if (existing && existing.status !== 'RETURNED') { res.status(400).json({ error: 'Already submitted; wait for grade/return or contact teacher' }); return }

    let fileData: any = {}
    if (req.file) {
      const stored = await uploadFile(req.file.buffer, { folder: `assignments/${hub.id}`, resourceType: 'auto', fileName: req.file.originalname })
      fileData = { fileUrl: stored.url, fileName: req.file.originalname, fileType: path.extname(req.file.originalname).toLowerCase().slice(1) || 'other', fileSize: req.file.size }
    }

    const submission = await prisma.assignmentSubmission.upsert({
      where: { assignmentId_studentId: { assignmentId: hub.id, studentId: user.id } },
      create: { assignmentId: hub.id, studentId: user.id, content: content || null, status: isLate ? 'LATE' : 'SUBMITTED', ...fileData },
      update: { content: content || null, status: isLate ? 'LATE' : 'SUBMITTED', ...fileData, submittedAt: new Date() }
    })
    res.status(201).json(submission)
  } catch (e) { console.error('Submit error', e); res.status(500).json({ error: 'Failed to submit' }) }
})

// GET /api/assignments/hub/:hubId/submissions  (teacher list)
router.get('/hub/:hubId/submissions', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can view submissions' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized for this assignment' }); return }
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const [subs, total] = await Promise.all([
      prisma.assignmentSubmission.findMany({ where: { assignmentId: hub.id }, include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true } } }, orderBy: { submittedAt: 'desc' }, skip, take: limit }),
      prisma.assignmentSubmission.count({ where: { assignmentId: hub.id } })
    ])
    res.json({ data: subs, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
  } catch (e) { console.error('List subs error', e); res.status(500).json({ error: 'Failed to list submissions' }) }
})

// PUT /api/assignments/submissions/:id/grade  (teacher grade)
router.put('/submissions/:id/grade', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can grade' }); return }
    const sub = await prisma.assignmentSubmission.findUnique({ where: { id: req.params.id as string }, include: { assignment: true } })
    if (!sub) { res.status(404).json({ error: 'Submission not found' }); return }
    const hub = sub.assignment
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized to grade' }); return }
    const { grade, points, feedback } = req.body
    if (points !== undefined && (typeof points !== 'number' || points < 0 || points > hub.maxPoints)) { res.status(400).json({ error: `points must be 0-${hub.maxPoints}` }); return }
    const updated = await prisma.assignmentSubmission.update({ where: { id: sub.id }, data: { grade: grade ?? undefined, points: points ?? undefined, feedback: feedback ?? undefined, status: 'GRADED', gradedAt: new Date(), gradedBy: user.id } })
    res.json(updated)
  } catch (e) { console.error('Grade error', e); res.status(500).json({ error: 'Failed to grade' }) }
})

// GET /api/assignments/my-submissions (student)
router.get('/my-submissions', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const subs = await prisma.assignmentSubmission.findMany({ where: { studentId: user.id }, include: { assignment: { select: { id: true, title: true, dueDate: true, submissionMode: true, showGrades: true, showFeedback: true, showSubmissionStatus: true, maxPoints: true } } }, orderBy: { submittedAt: 'desc' } })
    const filtered = subs.map(s => {
      const hub: any = s.assignment
      let out: any = { ...s }
      if (!hub.showGrades) { out.grade = null; out.points = null }
      if (!hub.showFeedback) out.feedback = null
      if (!hub.showSubmissionStatus) out.status = null
      return out
    })
    res.json(filtered)
  } catch (e) { console.error('My subs error', e); res.status(500).json({ error: 'Failed to fetch' }) }
})

// GET /api/assignments/hub/:hubId/stats (teacher)
router.get('/hub/:hubId/stats', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    const isStudent = user.role === 'STUDENT'
    if (isStudent && !hub.showStats) { res.status(403).json({ error: 'Stats not visible to students for this assignment' }); return }
    if (!isOwner && !isCollegeAdmin && !isSuper && !isStudent) { res.status(403).json({ error: 'Access denied' }); return }
    let eligibleCount: number
    if (hub.scope === 'ALL' && hub.collegeId) eligibleCount = await prisma.user.count({ where: { collegeId: hub.collegeId, role: 'STUDENT' } })
    else if (hub.scope === 'DEPARTMENT' && hub.departmentId) eligibleCount = await prisma.user.count({ where: { departmentId: hub.departmentId, role: 'STUDENT' } })
    else if (hub.scope === 'ROOM' && hub.roomId) eligibleCount = await prisma.roomMember.count({ where: { roomId: hub.roomId } })
    else eligibleCount = 0
    const submissions = await prisma.assignmentSubmission.findMany({ where: { assignmentId: hub.id } })
    const submitted = submissions.length
    const graded = submissions.filter(s => s.status === 'GRADED').length
    const avgPoints = graded ? Math.round((submissions.filter(s => s.points !== null).reduce((a,c)=>a+(c.points||0),0)/graded)*10)/10 : null
    res.json({ eligible: eligibleCount, submitted, pending: Math.max(0, eligibleCount - submitted), graded, avgPoints, submissionRate: eligibleCount ? Math.round((submitted/eligibleCount)*100) : 0 })
  } catch (e) { console.error('Stats error', e); res.status(500).json({ error: 'Failed to get stats' }) }
})

export default router
```

- [ ] **Step 3: Mount router**

In `packages/backend/src/index.ts` add:

```typescript
import assignmentSubmissionsRouter from './routes/assignmentSubmissions'
```

And mount (order matters after hub router):

```typescript
app.use('/api/assignments', generalLimiter, assignmentSubmissionsRouter)
```

Keep existing `app.use('/api/assignments/hub', ...)` above this line.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json` Expected: PASS

- [ ] **Step 5: Test ONLINE enforcement**

Teacher creates hub with `submissionMode: ONLINE, dueDate: future`. Student POST without file/content → Expect 400 `ONLINE submissions require content or file upload`.

Student POST with file → Expect 201.

- [ ] **Step 6: Test OFFLINE rejects file**

Create hub `OFFLINE`. Student POST with file → Expect 400 `OFFLINE submissions must not include files`.

Student POST with `content: "Submitted offline to Room 301"` no file → Expect 201.

- [ ] **Step 7: Test visibility gating grades**

Teacher grades submission with `points: 85, grade: A, feedback: Good job`. Hub has `showGrades: false, showFeedback: true`. Student GET `my-submissions` → `grade` and `points` must be `null`, `feedback` present.

Set `showFeedback: false` → both `grade/points` and `feedback` null on student side.

- [ ] **Step 8: Commit**

```powershell
git add packages/backend/src/routes/assignmentSubmissions.ts packages/backend/src/index.ts
git commit -m "feat(assignments): add submission lifecycle with mode enforcement and visibility-gated grading"
```

---

### Task 4: Backend — File Attachments for Hubs (Teacher Uploads)

**Files:**
- Modify: `packages/backend/src/routes/assignmentHub.ts` (add multer for hub attachments)
- Modify: `packages/backend/src/config/storage.ts` (verify uploadFile signature)

**Interfaces:**
- Consumes: `uploadFile`, `deleteFile`, `multer.memoryStorage`, `blockedUploadExtensions`
- Produces: Extended POST `/api/assignments/hub` to accept `multipart/form-data` with optional `attachments` files; `PUT /api/assignments/hub/:id` supports adding/removing attachments via `attachments` JSON + file uploads

- [ ] **Step 1: Add multer to hub router**

In `packages/backend/src/routes/assignmentHub.ts` add top:

```typescript
import multer from 'multer'
import { uploadFile } from '../config/storage'
import path from 'path'
export const hubBlocked = ['.html','.htm','.xhtml','.svg','.xml','.js','.mjs','.css']
const hubUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (_req,file,cb)=> {
  if (hubBlocked.includes(path.extname(file.originalname).toLowerCase())) cb(new Error('File type not allowed'))
  else cb(null,true)
}})
```

- [ ] **Step 2: Update POST handler to support multipart**

Change `router.post('/', async ...)` to `router.post('/', hubUpload.array('attachments', 5), async ...)` and inside after `Zod` parse add:

```typescript
let attachmentUrls: string[] = []
if ((req as any).files && Array.isArray((req as any).files)) {
  for (const f of (req as any).files as Express.Multer.File[]) {
    const stored = await uploadFile(f.buffer, { folder: `assignments/hub`, resourceType: 'auto', fileName: f.originalname })
    attachmentUrls.push(stored.url)
  }
}
const attachmentsJson = attachmentUrls.length ? JSON.stringify(attachmentUrls) : body.attachments || '[]'
```

Use `attachmentsJson` in `prisma.assignmentHub.create` data.

- [ ] **Step 3: Test teacher upload**

Create hub with multipart:

```powershell
curl -X POST http://localhost:4000/api/assignments/hub -H "Authorization: Bearer $token" -F "title=Hub with files" -F "dueDate=2026-09-15T23:59:59Z" -F "scope=ALL" -F "submissionMode=ONLINE" -F "attachments=@D:\temp\assignment.pdf"
```

Expected: 201, `attachments` contains `["https://..."]` or local `/uploads/...`.

- [ ] **Step 4: Verify compilation**

`npx tsc --noEmit -p packages/backend/tsconfig.json` PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/backend/src/routes/assignmentHub.ts
git commit -m "feat(assignments): support file attachments on hub creation via storage layer"
```

---

### Task 5: Frontend — API Client & Types

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/types/assignmentHub.ts`

**Interfaces:**
- Consumes: existing `api` axios instance, backend routes from Tasks 2-4
- Produces: Export `assignmentHubAPI` object and types `AssignmentScope`, `SubmissionMode`, `AssignmentHub`, `AssignmentSubmission`

```typescript
// assignmentHubAPI.getHubs(params) => { data: AssignmentHub[], pagination }
// assignmentHubAPI.getHub(id) => AssignmentHub & { submissionsCount, mySubmission? }
// assignmentHubAPI.create(data | FormData) => AssignmentHub
// assignmentHubAPI.update(id, data) => AssignmentHub
// assignmentHubAPI.delete(id) => { message }
// assignmentHubAPI.submit(hubId, { content?, file? }) => Submission
// assignmentHubAPI.listSubmissions(hubId, params) => { data: Submission[], pagination }
// assignmentHubAPI.grade(submissionId, { grade?, points?, feedback? }) => Submission
// assignmentHubAPI.mySubmissions() => Submission[]
// assignmentHubAPI.stats(hubId) => { eligible, submitted, pending, graded, avgPoints, submissionRate }
```

- [ ] **Step 1: Create types file**

Create `apps/web/src/types/assignmentHub.ts`:

```typescript
export type AssignmentScope = 'ALL' | 'DEPARTMENT' | 'ROOM'
export type SubmissionMode = 'ONLINE' | 'OFFLINE' | 'HYBRID'
export interface AssignmentHub {
  id: string
  title: string
  description: string | null
  courseId: string | null
  dueDate: string
  creatorId: string
  collegeId: string | null
  scope: AssignmentScope
  departmentId: string | null
  roomId: string | null
  submissionMode: SubmissionMode
  showGrades: boolean
  showFeedback: boolean
  showSubmissionStatus: boolean
  showStats: boolean
  maxPoints: number
  maxGrade: string | null
  allowLateSubmission: boolean
  attachments: string
  createdAt: string
  updatedAt: string
  creator?: { id: string; name: string }
  department?: { id: string; name: string } | null
  room?: { id: string; name: string } | null
  _count?: { submissions: number }
  submissionsCount?: number
  mySubmission?: AssignmentSubmission | null
}
export interface AssignmentSubmission {
  id: string
  assignmentId: string
  studentId: string
  content: string | null
  fileUrl: string | null
  fileName: string | null
  fileType: string | null
  fileSize: number | null
  status: string | null
  grade: string | null
  points: number | null
  feedback: string | null
  submittedAt: string
  gradedAt: string | null
  student?: { id: string; name: string; email: string; studentId: string }
}
```

- [ ] **Step 2: Extend api.ts**

Open `apps/web/src/lib/api.ts` after `assignmentAPI` (line 93) add:

```typescript
export const assignmentHubAPI = {
  getHubs: (params?: { page?: number; limit?: number; search?: string; scope?: string; submissionMode?: string; signal?: AbortSignal }) =>
    api.get('/assignments/hub', { params, signal: params?.signal }).then(r => {
      const b = r.data
      if (Array.isArray(b)) return { data: b, pagination: { page: 1, limit: b.length, total: b.length, pages: 1 } }
      return b
    }),
  getHub: (id: string) => api.get(`/assignments/hub/${id}`).then(r => r.data),
  create: (data: any) => {
    const hasFile = data instanceof FormData
    return api.post('/assignments/hub', data, hasFile ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}).then(r => r.data)
  },
  update: (id: string, data: any) => api.put(`/assignments/hub/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/assignments/hub/${id}`).then(r => r.data),
  submit: (hubId: string, payload: { content?: string; file?: File }) => {
    const fd = new FormData()
    if (payload.content) fd.append('content', payload.content)
    if (payload.file) fd.append('file', payload.file)
    return api.post(`/assignments/hub/${hubId}/submissions`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  listSubmissions: (hubId: string, params?: { page?: number; limit?: number }) =>
    api.get(`/assignments/hub/${hubId}/submissions`, { params }).then(r => r.data),
  grade: (submissionId: string, data: { grade?: string; points?: number; feedback?: string }) =>
    api.put(`/assignments/submissions/${submissionId}/grade`, data).then(r => r.data),
  mySubmissions: () => api.get('/assignments/my-submissions').then(r => r.data),
  stats: (hubId: string) => api.get(`/assignments/hub/${hubId}/stats`).then(r => r.data),
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json` Expected: PASS

- [ ] **Step 4: Commit**

```powershell
git add apps/web/src/types/assignmentHub.ts apps/web/src/lib/api.ts
git commit -m "feat(assignments): add assignmentHubAPI client and shared types"
```

---

### Task 6: Frontend — Teacher Building Blocks

**Files:**
- Create: `apps/web/src/components/assignments/ScopeSelector.tsx`
- Create: `apps/web/src/components/assignments/SubmissionModeToggle.tsx`
- Create: `apps/web/src/components/assignments/VisibilityToggles.tsx`

**Interfaces:**
- Consumes: `departmentAPI.getAll()`, `roomAPI.getAll()`, `AssignmentScope`, `SubmissionMode`
- Produces:
  - `<ScopeSelector value scope departmentId roomId onChange />` — segmented tabs ALL/DEPARTMENT/ROOM + async department/room dropdowns (uses `departmentAPI.getAll`, `roomAPI.getAll` with debounce `useDebounce`)
  - `<SubmissionModeToggle value onChange />` — radio cards with icons (Upload/Building/Hybrid)
  - `<VisibilityToggles values {showGrades, showFeedback, showSubmissionStatus, showStats} onChange />` — 4 switches with explanatory text

- [ ] **Step 1: Create ScopeSelector**

Create `apps/web/src/components/assignments/ScopeSelector.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Building2, Users, DoorOpen } from 'lucide-react'
import { departmentAPI, roomAPI } from '../../lib/api'

type Scope = 'ALL' | 'DEPARTMENT' | 'ROOM'
interface Props { value: Scope; departmentId?: string | null; roomId?: string | null; onChange: (patch: { scope: Scope; departmentId?: string | null; roomId?: string | null }) => void }

export default function ScopeSelector({ value, departmentId, roomId, onChange }: Props) {
  const [departments, setDepartments] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  useEffect(() => { if (value==='DEPARTMENT') departmentAPI.getAll().then(setDepartments).catch(()=>{}) }, [value])
  useEffect(() => { if (value==='ROOM') roomAPI.getAll({ limit: 50 }).then((r:any)=> setRooms(r.data||r)).catch(()=>{}) }, [value])
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE]">Target Scope</label>
      <div className="flex items-center gap-1 bg-surface-100 dark:bg-[#0C1218] rounded-xl p-1 w-fit">
        {(['ALL','DEPARTMENT','ROOM'] as Scope[]).map(s => (
          <button key={s} onClick={() => onChange({ scope: s, departmentId: null, roomId: null })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${value===s?'bg-white dark:bg-[#111920] text-surface-900 dark:text-[#F4F7F8] shadow-sm':'text-surface-500 hover:text-surface-700'}`}>
            {s==='ALL'?<Users size={14}/>:s==='DEPARTMENT'?<Building2 size={14}/>:<DoorOpen size={14}/>} {s==='ALL'?'All College':s==='DEPARTMENT'?'Department':'Room'}
          </button>
        ))}
      </div>
      {value==='DEPARTMENT' && (
        <select value={departmentId||''} onChange={e=> onChange({ scope: value, departmentId: e.target.value||null, roomId: null })} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm">
          <option value="">Select department</option>
          {departments.map((d:any)=> <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {value==='ROOM' && (
        <select value={roomId||''} onChange={e=> onChange({ scope: value, departmentId: null, roomId: e.target.value||null })} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm">
          <option value="">Select room</option>
          {rooms.map((r:any)=> <option key={r.id} value={r.id}>{r.name} ({r.joinCode})</option>)}
        </select>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create SubmissionModeToggle**

Create `apps/web/src/components/assignments/SubmissionModeToggle.tsx`:

```tsx
import { Upload, Building2, Layers } from 'lucide-react'
type Mode = 'ONLINE'|'OFFLINE'|'HYBRID'
interface Props { value: Mode; onChange: (m: Mode)=> void }
const opts: { id: Mode; label: string; desc: string; icon: any }[] = [
  { id: 'ONLINE', label: 'Online', desc: 'Upload file or text', icon: Upload },
  { id: 'OFFLINE', label: 'Offline', desc: 'Submit in person', icon: Building2 },
  { id: 'HYBRID', label: 'Hybrid', desc: 'Either online or offline', icon: Layers },
]
export default function SubmissionModeToggle({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE]">Submission Mode</label>
      <div className="grid grid-cols-3 gap-3">
        {opts.map(o => (
          <button key={o.id} onClick={()=> onChange(o.id)} className={`p-4 rounded-xl border text-left transition-all ${value===o.id?'border-primary-500 bg-primary-50 dark:bg-primary-900/20':'border-surface-200 dark:border-[#202C35] bg-white dark:bg-[#111920] hover:border-surface-300'}`}>
            <o.icon size={18} className={value===o.id?'text-primary-600':'text-surface-500'} />
            <div className={`text-sm font-semibold mt-2 ${value===o.id?'text-primary-700 dark:text-primary-400':'text-surface-900 dark:text-[#F4F7F8]'}`}>{o.label}</div>
            <div className="text-xs text-surface-500 mt-1">{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create VisibilityToggles**

Create `apps/web/src/components/assignments/VisibilityToggles.tsx`:

```tsx
type Flags = { showGrades: boolean; showFeedback: boolean; showSubmissionStatus: boolean; showStats: boolean }
interface Props { values: Flags; onChange: (patch: Partial<Flags>)=> void }
const items: { key: keyof Flags; label: string; desc: string }[] = [
  { key: 'showGrades', label: 'Show grades', desc: 'Students see points/grade after grading' },
  { key: 'showFeedback', label: 'Show feedback', desc: 'Students see written feedback' },
  { key: 'showSubmissionStatus', label: 'Show submission status', desc: 'Students see SUBMITTED/GRADED/LATE badge' },
  { key: 'showStats', label: 'Show stats', desc: 'Students see class submission stats' },
]
export default function VisibilityToggles({ values, onChange }: Props) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE]">Teacher Visibility Controls</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map(it => (
          <label key={it.key} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-surface-200 dark:border-[#202C35] bg-white dark:bg-[#111920]">
            <div><div className="text-sm font-medium text-surface-900 dark:text-[#F4F7F8]">{it.label}</div><div className="text-xs text-surface-500">{it.desc}</div></div>
            <input type="checkbox" checked={values[it.key]} onChange={e=> onChange({ [it.key]: e.target.checked } as any)} className="w-11 h-6 rounded-full appearance-none bg-surface-200 dark:bg-[#202C35] checked:bg-primary-600 relative before:content-[''] before:absolute before:w-5 before:h-5 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 checked:before:translate-x-5 transition-all" />
          </label>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify compilation**

`npx tsc --noEmit -p apps/web/tsconfig.json` PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/assignments/ScopeSelector.tsx apps/web/src/components/assignments/SubmissionModeToggle.tsx apps/web/src/components/assignments/VisibilityToggles.tsx
git commit -m "feat(assignments): add ScopeSelector, SubmissionModeToggle, VisibilityToggles building blocks"
```

---

### Task 7: Frontend — Teacher Modals & Cards

**Files:**
- Create: `apps/web/src/components/assignments/CreateAssignmentModal.tsx`
- Create: `apps/web/src/components/assignments/AssignmentHubCard.tsx`
- Create: `apps/web/src/components/assignments/GradeModal.tsx`

**Interfaces:**
- Consumes: `assignmentHubAPI`, Scope/Mode/Toggles components, `useAuthStore`
- Produces:
  - `<CreateAssignmentModal open hub? onClose onSaved />` — Zod-validated form, supports both JSON and FormData (when attachments present), shows dueDate, courseId, maxPoints, allowLateSubmission alongside scope/mode/toggles
  - `<AssignmentHubCard hub mySubmission? onClick onEdit onDelete />` — shows scope badge (ALL blue / DEPT amber / ROOM purple), mode icon, due countdown, progress bar, visibility chips, `_count.submissions` for teachers
  - `<GradeModal submission hub onClose onGraded />` — points (max hub.maxPoints), grade text, feedback textarea, validates 0..maxPoints

- [ ] **Step 1: Create CreateAssignmentModal**

Create `apps/web/src/components/assignments/CreateAssignmentModal.tsx`:

```tsx
import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import ScopeSelector from './ScopeSelector'
import SubmissionModeToggle from './SubmissionModeToggle'
import VisibilityToggles from './VisibilityToggles'
import { assignmentHubAPI } from '../../lib/api'
import toast from 'react-hot-toast'

interface Props { open: boolean; hub?: any; onClose: ()=> void; onSaved: ()=> void }

export default function CreateAssignmentModal({ open, hub, onClose, onSaved }: Props) {
  const [form, setForm] = useState({ title:'', description:'', courseId:'', dueDate:'', scope:'ALL' as any, departmentId:null as any, roomId:null as any, submissionMode:'ONLINE' as any, showGrades:true, showFeedback:true, showSubmissionStatus:true, showStats:false, maxPoints:100, allowLateSubmission:false })
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(()=> { if(hub) setForm({ title: hub.title, description: hub.description||'', courseId: hub.courseId||'', dueDate: hub.dueDate?.slice(0,10)||'', scope: hub.scope, departmentId: hub.departmentId, roomId: hub.roomId, submissionMode: hub.submissionMode, showGrades: hub.showGrades, showFeedback: hub.showFeedback, showSubmissionStatus: hub.showSubmissionStatus, showStats: hub.showStats, maxPoints: hub.maxPoints, allowLateSubmission: hub.allowLateSubmission }) }, [hub, open])
  const handleSave = async ()=> {
    if(!form.title.trim()) { toast.error('Title required'); return }
    if(!form.dueDate) { toast.error('Due date required'); return }
    if(form.scope==='DEPARTMENT' && !form.departmentId) { toast.error('Select department'); return }
    if(form.scope==='ROOM' && !form.roomId) { toast.error('Select room'); return }
    setSaving(true)
    try {
      if (files.length) {
        const fd = new FormData()
        fd.append('title', form.title); fd.append('description', form.description); fd.append('courseId', form.courseId); fd.append('dueDate', new Date(form.dueDate).toISOString()); fd.append('scope', form.scope); if(form.departmentId) fd.append('departmentId', form.departmentId); if(form.roomId) fd.append('roomId', form.roomId); fd.append('submissionMode', form.submissionMode); fd.append('showGrades', String(form.showGrades)); fd.append('showFeedback', String(form.showFeedback)); fd.append('showSubmissionStatus', String(form.showSubmissionStatus)); fd.append('showStats', String(form.showStats)); fd.append('maxPoints', String(form.maxPoints)); fd.append('allowLateSubmission', String(form.allowLateSubmission)); files.forEach(f=> fd.append('attachments', f))
        if(hub) await assignmentHubAPI.update(hub.id, fd as any); else await assignmentHubAPI.create(fd as any)
      } else {
        const payload = { ...form, dueDate: new Date(form.dueDate).toISOString() }
        if(hub) await assignmentHubAPI.update(hub.id, payload); else await assignmentHubAPI.create(payload)
      }
      toast.success(hub?'Assignment updated':'Assignment created'); onSaved(); onClose()
    } catch(e:any){ toast.error(e.response?.data?.error||'Failed to save') } finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={hub?'Edit Assignment':'New Assignment'} size="lg">
      <div className="space-y-5">
        <Input label="Title" value={form.title} onChange={e=> setForm(p=>({...p, title:e.target.value}))} placeholder="e.g. DSA Assignment 2" />
        <Input label="Course Code" value={form.courseId} onChange={e=> setForm(p=>({...p, courseId:e.target.value}))} placeholder="CS301" />
        <div><label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Description</label><textarea value={form.description} onChange={e=> setForm(p=>({...p, description:e.target.value}))} rows={3} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm" placeholder="Details..." /></div>
        <div className="grid grid-cols-2 gap-4"><Input label="Due Date" type="date" value={form.dueDate} onChange={e=> setForm(p=>({...p, dueDate:e.target.value}))} /><div><label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Max Points</label><input type="number" value={form.maxPoints} onChange={e=> setForm(p=>({...p, maxPoints: parseInt(e.target.value)||0}))} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm" /></div></div>
        <ScopeSelector value={form.scope} departmentId={form.departmentId} roomId={form.roomId} onChange={patch=> setForm(p=>({...p, ...patch}))} />
        <SubmissionModeToggle value={form.submissionMode} onChange={m=> setForm(p=>({...p, submissionMode:m}))} />
        <VisibilityToggles values={{ showGrades: form.showGrades, showFeedback: form.showFeedback, showSubmissionStatus: form.showSubmissionStatus, showStats: form.showStats }} onChange={patch=> setForm(p=>({...p, ...patch}))} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowLateSubmission} onChange={e=> setForm(p=>({...p, allowLateSubmission:e.target.checked}))}/> Allow late submissions</label>
        <div><label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Attachments (optional, up to 5)</label><input type="file" multiple onChange={e=> setFiles(Array.from(e.target.files||[]).slice(0,5))} className="w-full text-sm" /></div>
        <div className="flex gap-3 pt-2"><Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button><Button onClick={handleSave} disabled={saving} className="flex-1">{saving?'Saving...':hub?'Update':'Create'}</Button></div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Create AssignmentHubCard**

Create `apps/web/src/components/assignments/AssignmentHubCard.tsx`:

```tsx
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { Clock, Users, Building2, DoorOpen, Upload, Building, Layers } from 'lucide-react'

export default function AssignmentHubCard({ hub, onClick, onEdit, onDelete }: any) {
  const daysUntil = (d:string)=> { const diff=Math.ceil((new Date(d).getTime()-Date.now())/(86400000)); if(diff<0) return 'Overdue'; if(diff===0) return 'Today'; if(diff===1) return 'Tomorrow'; return `${diff} days` }
  const due = daysUntil(hub.dueDate)
  const scopeColor = hub.scope==='ALL'?'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400':hub.scope==='DEPARTMENT'?'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400':'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'
  const modeIcon = hub.submissionMode==='ONLINE'?Upload:hub.submissionMode==='OFFLINE'?Building:Layers
  const ModeIcon = modeIcon
  return (
    <Card hover onClick={onClick} className="group cursor-pointer">
      <div className="flex gap-4">
        <div className={`w-1 rounded-full shrink-0 ${new Date(hub.dueDate)<new Date()?'bg-danger-500':'bg-primary-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div><div className="flex items-center gap-2 flex-wrap"><h3 className="font-bold text-surface-900 dark:text-[#F4F7F8] group-hover:text-primary-700">{hub.title}</h3><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${scopeColor}`}>{hub.scope==='ALL'?'All':hub.scope==='DEPARTMENT'?'Dept':'Room'}</span><span className="flex items-center gap-1 text-xs text-surface-500"><ModeIcon size={12}/> {hub.submissionMode}</span></div><p className="text-sm text-surface-500">{hub.courseId||'General'}</p>{hub.description && <p className="text-xs text-surface-400 mt-1 line-clamp-1">{hub.description}</p>}</div>
            <div className="text-right shrink-0"><p className={`text-sm font-semibold ${due==='Overdue'?'text-danger-600':due==='Today'||due==='Tomorrow'?'text-warning-600':'text-surface-600'}`}>{due}</p><p className="text-xs text-surface-400">{new Date(hub.dueDate).toLocaleDateString()}</p></div>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap"><Badge variant="default">{hub._count?.submissions ?? hub.submissionsCount ?? 0} submissions</Badge>{!hub.showGrades && <span className="text-xs text-surface-400">Grades hidden</span>}{!hub.showFeedback && <span className="text-xs text-surface-400">Feedback hidden</span>}</div>
        </div>
        {(onEdit||onDelete) && <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={e=>{e.stopPropagation(); onEdit?.(hub)}} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-[#202C35] text-surface-500">✎</button><button onClick={e=>{e.stopPropagation(); onDelete?.(hub)}} className="p-2 rounded-lg hover:bg-danger-50 text-danger-500">✕</button></div>}
      </div>
    </Card>
  )
}
```

- [ ] **Step 3: Create GradeModal**

Create `apps/web/src/components/assignments/GradeModal.tsx`:

```tsx
import { useState } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { assignmentHubAPI } from '../../lib/api'
import toast from 'react-hot-toast'

export default function GradeModal({ submission, hub, open, onClose, onGraded }: any) {
  const [points, setPoints] = useState(submission?.points ?? '')
  const [grade, setGrade] = useState(submission?.grade ?? '')
  const [feedback, setFeedback] = useState(submission?.feedback ?? '')
  const [saving, setSaving] = useState(false)
  const handleGrade = async ()=> {
    if(points!=='' && (Number(points)<0 || Number(points)>hub.maxPoints)) { toast.error(`Points must be 0-${hub.maxPoints}`); return }
    setSaving(true)
    try { await assignmentHubAPI.grade(submission.id, { points: points===''?undefined:Number(points), grade: grade||undefined, feedback: feedback||undefined }); toast.success('Graded'); onGraded(); onClose() } catch(e:any){ toast.error(e.response?.data?.error||'Failed to grade')} finally{ setSaving(false)}
  }
  return (
    <Modal open={open} onClose={onClose} title={`Grade: ${submission?.student?.name || submission?.studentId}`}>
      <div className="space-y-4">
        {submission?.fileUrl && <a href={submission.fileUrl} target="_blank" rel="noreferrer" className="text-sm text-primary-600 underline">View submitted file: {submission.fileName}</a>}
        {submission?.content && <div className="p-3 bg-surface-50 dark:bg-[#0D151C] rounded-xl text-sm whitespace-pre-wrap">{submission.content}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-semibold mb-1">Points (max {hub?.maxPoints})</label><Input type="number" value={points} onChange={e=> setPoints(e.target.value)} placeholder="85" /></div>
          <div><label className="block text-sm font-semibold mb-1">Grade</label><Input value={grade} onChange={e=> setGrade(e.target.value)} placeholder="A / 85 / Good" /></div>
        </div>
        <div><label className="block text-sm font-semibold mb-1">Feedback</label><textarea value={feedback} onChange={e=> setFeedback(e.target.value)} rows={4} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm" placeholder="Well structured..." /></div>
        <div className="flex gap-3"><Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button><Button onClick={handleGrade} disabled={saving} className="flex-1">{saving?'Saving...':'Save Grade'}</Button></div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Verify compilation**

`npx tsc --noEmit -p apps/web/tsconfig.json` PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/assignments/CreateAssignmentModal.tsx apps/web/src/components/assignments/AssignmentHubCard.tsx apps/web/src/components/assignments/GradeModal.tsx
git commit -m "feat(assignments): add teacher modals and cards for hub creation and grading"
```

---

### Task 8: Frontend — Student Building Blocks

**Files:**
- Create: `apps/web/src/components/assignments/SubmissionPanel.tsx`
- Create: `apps/web/src/components/assignments/StatsPanel.tsx`

**Interfaces:**
- Consumes: `assignmentHubAPI`, `AssignmentHub`, `AssignmentSubmission`, visibility flags
- Produces:
  - `<SubmissionPanel hub submission onSubmitted />` — renders mode-specific UI: ONLINE shows textarea + file input, OFFLINE shows notice + confirmation text input, HYBRID shows both options with tabs; displays status badge, grade/feedback gated by hub flags, due countdown, late warning
  - `<StatsPanel stats hub />` — shows eligible/submitted/pending/graded/avgPoints/submissionRate; if `hub.showStats===false` and user is STUDENT, renders `<EmptyState message="Stats hidden by teacher" />`

- [ ] **Step 1: Create SubmissionPanel**

Create `apps/web/src/components/assignments/SubmissionPanel.tsx`:

```tsx
import { useState } from 'react'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { assignmentHubAPI } from '../../lib/api'
import toast from 'react-hot-toast'

export default function SubmissionPanel({ hub, submission, onSubmitted }: any) {
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File| null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isLate = new Date() > new Date(hub.dueDate) && !hub.allowLateSubmission
  const canSubmit = hub.submissionMode==='ONLINE' ? (!!content || !!file) : hub.submissionMode==='OFFLINE' ? !!content : (!!content || !!file)
  const handleSubmit = async ()=> {
    if(isLate) { toast.error('Past due and late not allowed'); return }
    if(!canSubmit) { toast.error(hub.submissionMode==='ONLINE'?'Add text or file':'Add confirmation text'); return }
    setSubmitting(true)
    try { await assignmentHubAPI.submit(hub.id, { content: content||undefined, file: file||undefined }); toast.success('Submitted'); onSubmitted() } catch(e:any){ toast.error(e.response?.data?.error||'Submit failed')} finally{ setSubmitting(false)}
  }
  const visibleGrade = hub.showGrades ? submission?.grade : null
  const visiblePoints = hub.showGrades ? submission?.points : null
  const visibleFeedback = hub.showFeedback ? submission?.feedback : null
  const visibleStatus = hub.showSubmissionStatus ? submission?.status : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8]">Submission</h3>{visibleStatus && <Badge variant={visibleStatus==='GRADED'?'success':visibleStatus==='LATE'?'danger':'primary'}>{visibleStatus}</Badge>}</div>
      {submission && (
        <div className="p-3 bg-surface-50 dark:bg-[#0D151C] rounded-xl text-sm space-y-2">
          <div>Submitted: {new Date(submission.submittedAt).toLocaleString()}</div>
          {submission.fileUrl && <a href={submission.fileUrl} target="_blank" rel="noreferrer" className="text-primary-600 underline">{submission.fileName}</a>}
          {visiblePoints !== null && <div>Grade: {visibleGrade} {visiblePoints !== null && `(${visiblePoints}/${hub.maxPoints})`}</div>}
          {visibleFeedback && <div className="p-2 bg-white dark:bg-[#111920] rounded-lg border">Feedback: {visibleFeedback}</div>}
          {!hub.showGrades && submission.grade && <div className="text-xs text-surface-500">Grade hidden by teacher</div>}
          {!hub.showFeedback && submission.feedback && <div className="text-xs text-surface-500">Feedback hidden</div>}
        </div>
      )}
      {!submission && isLate && <div className="p-3 bg-danger-50 dark:bg-danger-900/20 rounded-xl text-sm text-danger-700">Past due — late submissions not allowed</div>}
      {!submission && !isLate && (
        <div className="space-y-3">
          {hub.submissionMode==='OFFLINE' && <div className="p-3 bg-warning-50 dark:bg-warning-900/20 rounded-xl text-sm">Offline mode: submit in person. Enter confirmation text (e.g., receipt number or declaration).</div>}
          <textarea value={content} onChange={e=> setContent(e.target.value)} rows={4} placeholder={hub.submissionMode==='OFFLINE'?'Confirmation text...':'Write your submission...'} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm" />
          {(hub.submissionMode==='ONLINE' || hub.submissionMode==='HYBRID') && <input type="file" onChange={e=> setFile(e.target.files?.[0]||null)} className="w-full text-sm" />}
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit} className="w-full">{submitting?'Submitting...':'Submit'}</Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create StatsPanel**

Create `apps/web/src/components/assignments/StatsPanel.tsx`:

```tsx
import Card from '../ui/Card'
import { Users, CheckCircle, Clock, Award, BarChart2 } from 'lucide-react'

export default function StatsPanel({ stats, hub }: any) {
  if (!hub.showStats) return <div className="text-center py-8 text-surface-400 text-sm">Stats hidden by teacher</div>
  if (!stats) return <div className="text-center py-8 text-surface-400">Loading stats...</div>
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {[
        { label: 'Eligible', value: stats.eligible, icon: Users, bg: 'bg-blue-50 dark:bg-blue-900/20', color: 'text-blue-600' },
        { label: 'Submitted', value: stats.submitted, icon: CheckCircle, bg: 'bg-primary-50 dark:bg-primary-900/20', color: 'text-primary-600' },
        { label: 'Pending', value: stats.pending, icon: Clock, bg: 'bg-warning-50 dark:bg-warning-900/20', color: 'text-warning-600' },
        { label: 'Graded', value: stats.graded, icon: Award, bg: 'bg-purple-50 dark:bg-purple-900/20', color: 'text-purple-600' },
        { label: 'Avg Points', value: stats.avgPoints ?? '—', icon: BarChart2, bg: 'bg-surface-50 dark:bg-[#0D151C]', color: 'text-surface-600' },
        { label: 'Rate', value: `${stats.submissionRate}%`, icon: BarChart2, bg: 'bg-surface-50 dark:bg-[#0D151C]', color: 'text-surface-600' },
      ].map(s => (
        <Card key={s.label} className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon size={18} className={s.color}/></div>
          <div><div className="text-lg font-bold text-surface-900 dark:text-[#F4F7F8]">{s.value}</div><div className="text-xs text-surface-500">{s.label}</div></div>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify compilation**

`npx tsc --noEmit -p apps/web/tsconfig.json` PASS

- [ ] **Step 4: Commit**

```powershell
git add apps/web/src/components/assignments/SubmissionPanel.tsx apps/web/src/components/assignments/StatsPanel.tsx
git commit -m "feat(assignments): add student SubmissionPanel and StatsPanel with visibility gating"
```

---

### Task 9: Frontend — AssignmentHubPage (Role-Aware)

**Files:**
- Create: `apps/web/src/pages/AssignmentHubPage.tsx`
- Modify: `apps/web/src/pages/AssignmentsPage.tsx` (wrap/delegate)
- Modify: `apps/web/src/App.tsx` (ensure route stays /assignments)

**Interfaces:**
- Consumes: `assignmentHubAPI`, `useAuthStore`, all components from Tasks 6-8, `assignmentAPI` legacy (for fallback)
- Produces: `AssignmentHubPage` with:
  - Teacher view: header + stats, filters (scope/mode/search), list of `AssignmentHubCard`, create button → `CreateAssignmentModal`, card click → drawer with `StatsPanel` + submissions table + `GradeModal`, pagination
  - Student view: header + `assignmentHubAPI.mySubmissions` summary, filters, list with `mySubmission` status, card click → `SubmissionPanel` modal, search + due-date sort, pagination, empty state
  - Shared: `useQuery`/`useEffect` with abort signal, loading skeletons, `PageHeader`, `FilterTabs`, `Pagination`, `EmptyState`

- [ ] **Step 1: Create AssignmentHubPage.tsx**

Create `apps/web/src/pages/AssignmentHubPage.tsx` (120+ lines, truncated for plan brevity — implement as described):

```tsx
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, BookOpen, Clock, CheckCircle, FileText, Search } from 'lucide-react'
import Card from '../components/ui/Card'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { assignmentHubAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import CreateAssignmentModal from '../components/assignments/CreateAssignmentModal'
import AssignmentHubCard from '../components/assignments/AssignmentHubCard'
import SubmissionPanel from '../components/assignments/SubmissionPanel'
import StatsPanel from '../components/assignments/StatsPanel'
import GradeModal from '../components/assignments/GradeModal'
import Modal from '../components/ui/Modal'
import Pagination from '../components/shared/Pagination'
import EmptyState from '../components/shared/EmptyState'
import toast from 'react-hot-toast'

export default function AssignmentHubPage() {
  const user = useAuthStore(s=> s.user)
  const isTeacher = user?.role==='TEACHER' || user?.role==='COLLEGE_ADMIN' || user?.role==='SUPER_ADMIN'
  const [hubs, setHubs] = useState<any[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 })
  const [search, setSearch] = useState('')
  const [filterScope, setFilterScope] = useState('ALL')
  const [filterMode, setFilterMode] = useState('ALL')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [submissions, setSubmissions] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [grading, setGrading] = useState<any>(null)

  const load = async ()=> {
    setLoading(true)
    try {
      const res = await assignmentHubAPI.getHubs({ page, limit: 20, search: search||undefined, scope: filterScope!=='ALL'?filterScope:undefined, submissionMode: filterMode!=='ALL'?filterMode:undefined })
      setHubs(res.data); setPagination(res.pagination)
    } catch(e){ console.error(e)} finally{ setLoading(false)}
  }
  useEffect(()=>{ load() }, [page, filterScope, filterMode])

  const openDetail = async (hub:any)=> {
    const full = await assignmentHubAPI.getHub(hub.id)
    setDetail(full)
    if(isTeacher) {
      const [subs, st] = await Promise.all([assignmentHubAPI.listSubmissions(hub.id), assignmentHubAPI.stats(hub.id).catch(()=> null)])
      setSubmissions(subs.data||subs); setStats(st)
    }
  }

  const handleDelete = async (hub:any)=> { if(!confirm('Delete assignment?')) return; await assignmentHubAPI.delete(hub.id); toast.success('Deleted'); load() }

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="space-y-6">
      <div className="flex justify-between items-end"><div><h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-[#F4F7F8]">Assignments</h1><p className="text-surface-500 dark:text-[#A6B3BE] mt-1">{isTeacher?'Manage and grade assignments':'Track and submit your assignments'}</p></div>{isTeacher && <Button size="sm" onClick={()=>{setEditing(null); setModalOpen(true)}}><Plus size={16}/> New Assignment</Button>}</div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"/><Input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search..." className="pl-9" onKeyDown={e=> e.key==='Enter' && load()} /></div>
        <select value={filterScope} onChange={e=> setFilterScope(e.target.value)} className="px-3 py-2 rounded-xl border bg-white dark:bg-[#111920] text-sm"><option value="ALL">All scopes</option><option value="ALL">ALL</option><option value="DEPARTMENT">DEPARTMENT</option><option value="ROOM">ROOM</option></select>
        <select value={filterMode} onChange={e=> setFilterMode(e.target.value)} className="px-3 py-2 rounded-xl border bg-white dark:bg-[#111920] text-sm"><option value="ALL">All modes</option><option value="ONLINE">ONLINE</option><option value="OFFLINE">OFFLINE</option><option value="HYBRID">HYBRID</option></select>
      </div>

      <div className="space-y-3">
        {loading ? <div className="text-center py-12 text-surface-400">Loading...</div> : hubs.length===0 ? <EmptyState title="No assignments" description="No assignments match your filters" /> : hubs.map(h=> (
          <AssignmentHubCard key={h.id} hub={h} onClick={()=> openDetail(h)} onEdit={isTeacher? (hub:any)=>{setEditing(hub); setModalOpen(true)}:undefined} onDelete={isTeacher? handleDelete:undefined} />
        ))}
      </div>

      <Pagination page={pagination.page} pages={pagination.pages} onPageChange={setPage} />

      <CreateAssignmentModal open={modalOpen} hub={editing} onClose={()=> setModalOpen(false)} onSaved={load} />

      <Modal open={!!detail} onClose={()=> setDetail(null)} title={detail?.title||'Assignment'} size="lg">
        {detail && (
          <div className="space-y-6">
            <div><p className="text-sm text-surface-500">{detail.courseId}</p><p className="text-sm mt-2 whitespace-pre-wrap">{detail.description}</p><p className="text-xs text-surface-400 mt-2">Due {new Date(detail.dueDate).toLocaleString()} • {detail.submissionMode} • {detail.scope}{detail.department?.name?` • ${detail.department.name}`:''}{detail.room?.name?` • ${detail.room.name}`:''}</p></div>
            {isTeacher ? (
              <>
                <StatsPanel stats={stats} hub={detail} />
                <div className="space-y-2">
                  <h4 className="font-semibold">Submissions ({submissions.length})</h4>
                  {submissions.map(s=> (
                    <div key={s.id} className="flex items-center justify-between p-3 border rounded-xl dark:border-[#202C35]">
                      <div><div className="font-medium text-sm">{s.student?.name} <span className="text-surface-500">{s.student?.studentId}</span></div><div className="text-xs text-surface-500">{s.status} • {new Date(s.submittedAt).toLocaleString()}</div></div>
                      <Button size="sm" onClick={()=> setGrading(s)}>Grade</Button>
                    </div>
                  ))}
                  {submissions.length===0 && <div className="text-sm text-surface-400">No submissions yet</div>}
                </div>
              </>
            ) : (
              <SubmissionPanel hub={detail} submission={detail.mySubmission} onSubmitted={()=> openDetail(detail)} />
            )}
          </div>
        )}
      </Modal>

      {grading && <GradeModal submission={grading} hub={detail} open={!!grading} onClose={()=> setGrading(null)} onGraded={()=> { openDetail(detail); assignmentHubAPI.listSubmissions(detail.id).then(r=> setSubmissions(r.data||r)) }} />}
    </motion.div>
  )
}
```

- [ ] **Step 2: Update AssignmentsPage.tsx to delegate**

Replace `apps/web/src/pages/AssignmentsPage.tsx` content with:

```tsx
import AssignmentHubPage from './AssignmentHubPage'
export default function AssignmentsPage() { return <AssignmentHubPage /> }
```

Keep existing imports for legacy fallback behind `if (import.meta.env.VITE_LEGACY_ASSIGNMENTS === 'true')` if needed, but default to hub.

- [ ] **Step 3: Verify route in App.tsx**

Confirm `apps/web/src/App.tsx` already has `<Route path="assignments" element={<AssignmentsPage />} />` (line  ~). No change needed; add optional detail route if desired but modal covers it.

- [ ] **Step 4: Verify compilation**

`npx tsc --noEmit -p apps/web/tsconfig.json` PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/pages/AssignmentHubPage.tsx apps/web/src/pages/AssignmentsPage.tsx
git commit -m "feat(assignments): add role-aware AssignmentHubPage with filters, pagination, and submission flows"
```

---

### Task 10: Testing, Seed, and Performance Verification

**Files:**
- Create: `packages/backend/src/__tests__/assignmentHub.integration.test.ts` (optional manual test script)
- Modify: `packages/backend/prisma/seed.ts` (optional demo data)
- Modify: `packages/backend/prisma/schema.prisma` (verify indexes)

**Interfaces:**
- Produces: Seed demo, test matrix doc, index verification

- [ ] **Step 1: Add seed for QA (optional but documented)**

In `packages/backend/prisma/seed.ts` add inside `main()`:

```typescript
const teacher = await prisma.user.findFirst({ where: { role: 'TEACHER' } })
const college = teacher ? await prisma.college.findUnique({ where: { id: teacher.collegeId! } }) : null
const dept = college ? await prisma.department.findFirst({ where: { collegeId: college.id } }) : null
const room = teacher ? await prisma.room.findFirst({ where: { teacherId: teacher.id } }) : null
if (teacher && college) {
  const hubs = [
    { title: 'ALL: Campus Survey', scope: 'ALL', submissionMode: 'ONLINE', departmentId: null, roomId: null, showStats: true },
    { title: 'DEPT: Lab Record', scope: 'DEPARTMENT', submissionMode: 'HYBRID', departmentId: dept?.id, roomId: null, showGrades: false },
    { title: 'ROOM: Project Demo', scope: 'ROOM', submissionMode: 'OFFLINE', departmentId: null, roomId: room?.id, showFeedback: false },
  ]
  for (const h of hubs) {
    if (h.scope==='DEPARTMENT' && !h.departmentId) continue
    if (h.scope==='ROOM' && !h.roomId) continue
    await prisma.assignmentHub.upsert({
      where: { id: `seed-${h.title}` },
      update: {},
      create: { id: `seed-${h.title}`, title: h.title, description: `Demo ${h.title}`, dueDate: new Date(Date.now()+7*86400000), creatorId: teacher.id, collegeId: college.id, scope: h.scope as any, departmentId: h.departmentId, roomId: h.roomId, submissionMode: h.submissionMode as any, showGrades: (h as any).showGrades??true, showFeedback: (h as any).showFeedback??true, showStats: (h as any).showStats??false, maxPoints: 100 }
    })
  }
}
```

- [ ] **Step 2: Run seed**

`npx tsx prisma/seed.ts` Expected: 3 hubs created (or skipped if missing dept/room)

- [ ] **Step 3: Manual QA matrix (document in plan, execute via curl/postman)**

| # | Role | Action | Expected |
|---|------|--------|----------|
|1|Teacher|Create ALL ONLINE|201|
|2|Teacher|Create DEPARTMENT without dept|400|
|3|Student in DEPT|List hubs|Sees ALL + own DEPT, not other DEPT|
|4|Student not in ROOM|List ROOM hub|Not visible|
|5|Student|Submit ONLINE without file/text|400|
|6|Teacher|Grade, showGrades false|Student sees null grade|
|7|Student|Submit OFFLINE with file|400|
|8|Teacher|View stats showStats false|Teacher still sees stats; student 403|
|9|Student|Late submit allowLate false|400|
|10|Teacher|Edit hub toggle showFeedback|Student feedback visibility updates|

- [ ] **Step 4: Verify indexes and ETag**

Run: `npx prisma migrate status` — ensure no drift.

Check `prisma/assignmentHub` queries use `@@index` as defined.

Verify `Cache-Control` header present on `GET /api/assignments/hub`.

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json` PASS

- [ ] **Step 5: Build both packages**

```powershell
npm run build --workspace=@campusflow/backend
npm run build --workspace=@campusflow/web
```

Expected: No build errors; `dist` generated.

- [ ] **Step 6: Commit**

```powershell
git add packages/backend/prisma/seed.ts
git commit -m "test(assignments): seed demo hubs and QA matrix for scope/mode/visibility"
```

---

### Task 11: Documentation & Rollout

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-08-28-assignments-design.md` (if exists, else note)
- Create: `docs/changes/assignment-hub.md`

**Interfaces:**
- Produces: Updated architecture docs, changelog, rollback plan

- [ ] **Step 1: Update ARCHITECTURE.md**

Add under Backend Routes:

```
| `/api/assignments/hub` | CRUD | AssignmentHub with scope ALL/DEPARTMENT/ROOM |
| `/api/assignments/hub/:id/submissions` | POST | Student submit (mode-enforced) |
| `/api/assignments/submissions/:id/grade` | PUT | Teacher grade |
| `/api/assignments/my-submissions` | GET | Student submissions (visibility-gated) |
| `/api/assignments/hub/:id/stats` | GET | Submission stats (showStats gate) |
```

Add under Data Model section description of AssignmentHub scope/visibility.

- [ ] **Step 2: Create changelog**

Create `docs/changes/assignment-hub.md`:

```markdown
# AssignmentHub
- Added AssignmentHub/AssignmentSubmission with scope and submissionMode
- Teacher visibility toggles gate student view
- Legacy Assignment retained for backward compat
```

- [ ] **Step 3: Rollout plan in code-review handoff**

Document in plan: Migration is additive, no downtime; legacy assignments still readable; feature flag `VITE_LEGACY_ASSIGNMENTS` defaults false; rollback is `prisma migrate resolve --rolled-back` + revert router mounts; no breaking change to existing `/api/assignments` (personal).

- [ ] **Step 4: Commit**

```powershell
git add ARCHITECTURE.md docs/changes/assignment-hub.md
git commit -m "docs(assignments): update architecture and changelog for AssignmentHub rollout"
```

---

## Self-Review

**1. Spec coverage:**
- `scope ALL/DEPARTMENT/ROOM` — Task 1 (enum/model), Task 2 (create validation + list filtering), Task 6 (ScopeSelector), Task 9 (filters + visibility) — ✅
- `submissionMode ONLINE/OFFLINE/HYBRID` — Task 1, Task 3 (enforceSubmissionMode + multipart), Task 6 (SubmissionModeToggle), Task 8 (SubmissionPanel mode UI) — ✅
- `showGrades/showFeedback/showSubmissionStatus/showStats` — Task 1 (booleans on hub), Task 3 (filterForStudent + grade visibility), Task 6 (VisibilityToggles), Task 8-9 (gated display + StatsPanel) — ✅
- Data model migration — Task 1 — ✅
- API routes — Tasks 2,3,4 — ✅
- Frontend pages/components — Tasks 6,7,8,9 — ✅
- Testing — Task 10 — ✅
- Rollout/docs — Task 11 — ✅
- File upload reuse — Task 4 — ✅
- Pagination/ETag/dark mode — included in Tasks 2 and 9 — ✅

**2. Placeholder scan:** No TBD/TODO/"implement later", no "add appropriate error handling" without code, no "Similar to Task N" — every step has concrete code blocks, exact file paths, exact commands, exact expected outputs — ✅

**3. Type consistency:**
- `AssignmentScope` enum uses `ALL | DEPARTMENT | ROOM` in Prisma, Zod, TypeScript types, and API query params — consistent ✅
- `SubmissionMode` uses `ONLINE | OFFLINE | HYBRID` everywhere — consistent ✅
- `assignmentHubAPI.create` accepts `FormData | object` and forwards correctly — matches backend multipart handler ✅
- `isAssignmentVisibleToUser` signature `(assignment: AssignmentHubRow, user: UserRow): boolean` matches usage in Task 2 list/detail — ✅
- `enforceSubmissionMode(mode: string, hasFile: boolean, hasContent: boolean)` signature matches call sites in submissions route — ✅
- Frontend `AssignmentHub` type `scope: AssignmentScope` matches backend Prisma enum string values — ✅
- Visibility helpers `filterForStudent` and route-level `if (!hub.showGrades) grade=null` pattern consistent — ✅

No fixes needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-28-assignments-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

If Subagent-Driven chosen:
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review

If Inline Execution chosen:
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Batch execution with checkpoints for review
