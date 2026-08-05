# Department System + Hackathon Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured departments to colleges, link them to students/teachers, and enable hackathon eligibility targeting by department and year of study.

**Architecture:** New `Department` model linked to College. Users reference departments via FK. Students get `incomingYear`/`outgoingYear` with computed `currentYear`. Hackathons get `targetDepartments`, `targetYears`, `eligibilityEnabled` fields. Eligibility checked at registration time.

**Tech Stack:** Prisma + SQLite (backend), React + Tailwind (frontend), existing patterns

## Global Constraints

- SQLite database (no raw SQL, use Prisma migrations)
- Existing API patterns: Express Router + `authenticate` middleware
- Frontend: React + Tailwind + Framer Motion + lucide-react icons
- Role-based access: COLLEGE_ADMIN can manage their college's departments
- Backward compatible: existing users with free-text department should migrate gracefully

---

## File Structure

| File | Purpose |
|------|---------|
| `packages/backend/prisma/schema.prisma` | Add Department model, update User/Hackathon |
| `packages/backend/prisma/migrations/` | Migration for new tables/columns |
| `packages/backend/src/routes/departments.ts` | Department CRUD routes |
| `packages/backend/src/index.ts` | Register department routes |
| `packages/backend/src/routes/admin.ts` | Update user creation to use departmentId |
| `packages/backend/src/routes/hackathons.ts` | Add eligibility check on registration |
| `apps/web/src/lib/api.ts` | Department API functions, updated payloads |
| `apps/web/src/pages/AdminPage.tsx` | New Departments tab |
| `apps/web/src/pages/AddStudentPage.tsx` | Department dropdown, incoming year |
| `apps/web/src/pages/AddTeacherPage.tsx` | Department dropdown |
| `apps/web/src/pages/HackathonsPage.tsx` | Create form: dept/year multi-select |
| `apps/web/src/pages/HackathonDetailPage.tsx` | Show targeted dept/year badges |

---

### Task 1: Database Schema — Department Model + User/Hackathon Changes

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `Department` model, `User.departmentId`/`incomingYear`/`outgoingYear` fields, `Hackathon.targetDepartments`/`targetYears`/`eligibilityEnabled` fields

- [ ] **Step 1: Add Department model to schema.prisma**

Add after the `College` model (around line 231):

```prisma
model Department {
  id        String   @id @default(uuid())
  name      String
  collegeId String
  createdAt DateTime @default(now())

  college College @relation(fields: [collegeId], references: [id], onDelete: Cascade)
  users   User[]

  @@unique([collegeId, name])
}
```

- [ ] **Step 2: Update College model to include departments relation**

In the `College` model, add:

```prisma
  departments Department[]
```

- [ ] **Step 3: Update User model — add departmentId FK, incomingYear, outgoingYear**

Replace the `department` field and add new fields:

```diff
-  department   String?
+  departmentId String?
+  incomingYear Int?
+  outgoingYear Int?
```

Add relations:

```prisma
  department   Department? @relation(fields: [departmentId], references: [id])
```

Remove `year` and `semester` fields:

```diff
-  year         Int?
-  semester     Int?
```

- [ ] **Step 4: Update Hackathon model — add targeting fields**

Add after `highlights`:

```diff
+  targetDepartments  String?  @default("[]")
+  targetYears        String?  @default("[]")
+  eligibilityEnabled Boolean  @default(false)
```

- [ ] **Step 5: Generate Prisma client and create migration**

Run:
```bash
cd packages/backend
npx prisma generate
npx prisma migrate dev --name add_department_system
```

- [ ] **Step 6: Update seed.ts — create sample departments and fix user creation**

In `packages/backend/prisma/seed.ts`, add departments for the MIT college and link existing users.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/prisma/
git commit -m "feat: add Department model, update User/Hackathon schema"
```

---

### Task 2: Backend — Department CRUD Routes

**Files:**
- Create: `packages/backend/src/routes/departments.ts`
- Modify: `packages/backend/src/index.ts:~line 30` (register routes)

**Interfaces:**
- Consumes: `prisma` client, `authenticate` middleware, `AuthRequest` type
- Produces: `GET /api/departments`, `POST /api/departments`, `PUT /api/departments/:id`, `DELETE /api/departments/:id`

- [ ] **Step 1: Create departments.ts with all CRUD routes**

```typescript
import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

// List departments for user's college
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !user.collegeId) {
      res.status(403).json({ error: 'College access required' })
      return
    }
    const departments = await prisma.department.findMany({
      where: { collegeId: user.collegeId },
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    })
    res.json(departments)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch departments' })
  }
})

// Create department (college admin only)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'College admin access required' })
      return
    }
    const { name } = req.body
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Department name is required' })
      return
    }
    const existing = await prisma.department.findFirst({
      where: { collegeId: user.collegeId, name: { equals: name.trim(), mode: 'insensitive' } },
    })
    if (existing) {
      res.status(400).json({ error: 'Department already exists' })
      return
    }
    const dept = await prisma.department.create({
      data: { name: name.trim(), collegeId: user.collegeId! },
    })
    res.status(201).json(dept)
  } catch (error) {
    res.status(500).json({ error: 'Failed to create department' })
  }
})

// Rename department
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'College admin access required' })
      return
    }
    const { name } = req.body
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Department name is required' })
      return
    }
    const dept = await prisma.department.findUnique({ where: { id: req.params.id } })
    if (!dept || dept.collegeId !== user.collegeId) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    const updated = await prisma.department.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    })
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update department' })
  }
})

// Delete department
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'College admin access required' })
      return
    }
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    })
    if (!dept || dept.collegeId !== user.collegeId) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    if (dept._count.users > 0) {
      res.status(400).json({ error: `Cannot delete: ${dept._count.users} users belong to this department` })
      return
    }
    await prisma.department.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete department' })
  }
})

export default router
```

- [ ] **Step 2: Register route in index.ts**

In `packages/backend/src/index.ts`, add after existing route imports:

```typescript
import departmentRoutes from './routes/departments'
```

And after the existing `app.use('/api/hackathons', ...)`:

```typescript
app.use('/api/departments', departmentRoutes)
```

- [ ] **Step 3: Test routes manually**

Start backend, test with curl:
```bash
# Login as college admin
curl -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@university.edu","password":"password123"}'

# List departments
curl http://localhost:4000/api/departments -H "Authorization: Bearer <token>"

# Create department
curl -X POST http://localhost:4000/api/departments -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d '{"name":"Computer Science"}'
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/departments.ts packages/backend/src/index.ts
git commit -m "feat: add department CRUD routes"
```

---

### Task 3: Backend — Update User Creation to Use departmentId

**Files:**
- Modify: `packages/backend/src/routes/admin.ts:270-316` (add teacher)
- Modify: `packages/backend/src/routes/admin.ts:318-358` (add student)
- Modify: `packages/backend/src/routes/admin.ts:364-405` (bulk teachers)
- Modify: `packages/backend/src/routes/admin.ts:410-453` (bulk students)

**Interfaces:**
- Consumes: `Department` model, `departmentId` from request body
- Produces: Updated user creation with `departmentId`, `incomingYear`, `outgoingYear`

- [ ] **Step 1: Update add teacher route**

In the `POST '/users/teacher'` route, change:

```diff
-    const { email, name, password, department, empNumber } = req.body
+    const { email, name, password, departmentId, empNumber } = req.body

     // Validate departmentId exists if provided
+    if (departmentId) {
+      const dept = await prisma.department.findUnique({ where: { id: departmentId } })
+      if (!dept || dept.collegeId !== user.collegeId) {
+        res.status(400).json({ error: 'Invalid department' })
+        return
+      }
+    }

     const newUser = await prisma.user.create({
       data: {
         // ... existing fields
-        department,
+        departmentId: departmentId || undefined,
       },
     })
```

- [ ] **Step 2: Update add student route**

In the `POST '/users/student'` route, change:

```diff
-    const { email, name, password, department, studentId, year, semester } = req.body
+    const { email, name, password, departmentId, studentId, incomingYear } = req.body

+    // Validate departmentId
+    if (departmentId) {
+      const dept = await prisma.department.findUnique({ where: { id: departmentId } })
+      if (!dept || dept.collegeId !== user.collegeId) {
+        res.status(400).json({ error: 'Invalid department' })
+        return
+      }
+    }

     const newUser = await prisma.user.create({
       data: {
         // ... existing fields
-        department,
-        year: year ? parseInt(year) : undefined,
-        semester: semester ? parseInt(semester) : undefined,
+        departmentId: departmentId || undefined,
+        incomingYear: incomingYear ? parseInt(incomingYear) : undefined,
+        outgoingYear: incomingYear ? parseInt(incomingYear) + 4 : undefined,
       },
     })
```

- [ ] **Step 3: Update bulk teacher route**

In `POST '/users/teachers/bulk'`, change the map function:

```diff
-        department: t.department,
+        departmentId: undefined, // will be resolved below
       },
     }))

+    // Resolve department names to IDs
+    const departments = await prisma.department.findMany({
+      where: { collegeId: user.collegeId },
+    })
+    const deptMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]))
+
+    for (const u of userData) {
+      if (u.department) {
+        const deptId = deptMap.get(u.department.toLowerCase())
+        if (deptId) u.departmentId = deptId
+        delete u.department
+      }
+    }
```

- [ ] **Step 4: Update bulk student route**

Similar to bulk teachers, resolve department names to IDs. Also convert `year` to `incomingYear`:

```diff
+    // After resolving departments, convert year to incomingYear
+    for (const u of userData) {
+      if (u.year && !u.incomingYear) {
+        u.incomingYear = new Date().getFullYear() - parseInt(u.year) + 1
+        u.outgoingYear = u.incomingYear + 4
+      }
+    }
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/admin.ts
git commit -m "feat: update user creation to use departmentId"
```

---

### Task 4: Backend — Hackathon Targeting + Eligibility Check

**Files:**
- Modify: `packages/backend/src/routes/hackathons.ts` (create + register routes)

**Interfaces:**
- Consumes: `targetDepartments`, `targetYears`, `eligibilityEnabled` from request body
- Produces: Eligibility check function, updated hackathon creation

- [ ] **Step 1: Add eligibility check helper function**

At the top of `hackathons.ts`, add:

```typescript
function computeCurrentYear(incomingYear: number): number {
  const currentYear = new Date().getFullYear()
  const year = currentYear - incomingYear + 1
  return Math.min(Math.max(year, 1), 4)
}

async function checkEligibility(userId: string, hackathonId: string): Promise<{ allowed: boolean; reason?: string }> {
  const hackathon = await prisma.hackathon.findUnique({ where: { id: hackathonId } })
  if (!hackathon || !hackathon.eligibilityEnabled) return { allowed: true }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return { allowed: false, reason: 'User not found' }

  const targetDepts: string[] = JSON.parse(hackathon.targetDepartments || '[]')
  const targetYears: number[] = JSON.parse(hackathon.targetYears || '[]')

  if (targetDepts.length > 0 && user.departmentId && !targetDepts.includes(user.departmentId)) {
    return { allowed: false, reason: 'Your department is not eligible for this hackathon' }
  }

  if (targetYears.length > 0 && user.incomingYear) {
    const currentYear = computeCurrentYear(user.incomingYear)
    if (!targetYears.includes(currentYear)) {
      return { allowed: false, reason: 'Your year of study is not eligible for this hackathon' }
    }
  }

  return { allowed: true }
}
```

- [ ] **Step 2: Update hackathon creation to accept targeting fields**

In the `POST '/'` (create hackathon) route, add to the destructured body:

```diff
-  const { title, description, url, ... } = req.body
+  const { title, description, url, targetDepartments, targetYears, eligibilityEnabled, ... } = req.body
```

And in the create data:

```diff
     data: {
       // ... existing fields
+      targetDepartments: JSON.stringify(targetDepartments || []),
+      targetYears: JSON.stringify(targetYears || []),
+      eligibilityEnabled: eligibilityEnabled || false,
     },
```

- [ ] **Step 3: Add eligibility check to registration route**

In the `POST '/:id/register'` route, add before the registration create:

```typescript
    const eligibility = await checkEligibility(req.userId!, req.params.id)
    if (!eligibility.allowed) {
      res.status(403).json({ error: eligibility.reason })
      return
    }
```

- [ ] **Step 4: Update hackathon detail to include targeting fields**

In the `GET '/:id'` route, ensure `targetDepartments`, `targetYears`, `eligibilityEnabled` are returned (they should be by default since Prisma returns all fields).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/hackathons.ts
git commit -m "feat: add hackathon targeting and eligibility check"
```

---

### Task 5: Frontend — API Functions for Departments

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces: `departmentAPI` object with `getAll`, `create`, `update`, `delete`

- [ ] **Step 1: Add departmentAPI to api.ts**

After the existing `formAPI`, add:

```typescript
export const departmentAPI = {
  getAll: async () => {
    const res = await api.get('/departments')
    return res.data
  },
  create: async (name: string) => {
    const res = await api.post('/departments', { name })
    return res.data
  },
  update: async (id: string, name: string) => {
    const res = await api.put(`/departments/${id}`, { name })
    return res.data
  },
  delete: async (id: string) => {
    const res = await api.delete(`/departments/${id}`)
    return res.data
  },
}
```

- [ ] **Step 2: Update adminAPI user creation payloads**

Find `addTeacher` and `addStudent` in api.ts, change `department` to `departmentId`:

```diff
-  addTeacher: async (data: { email: string; name: string; password: string; department: string; empNumber: string }) => {
+  addTeacher: async (data: { email: string; name: string; password: string; departmentId: string; empNumber: string }) => {

-  addStudent: async (data: { email: string; name: string; password: string; department: string; studentId: string; year: string; semester: string }) => {
+  addStudent: async (data: { email: string; name: string; password: string; departmentId: string; studentId: string; incomingYear: string }) => {
```

- [ ] **Step 3: Update bulk upload functions**

Find `bulkAddTeachers` and `bulkAddStudents`, update the type definitions similarly.

- [ ] **Step 4: Update hackathonAPI.create to accept targeting fields**

```diff
-  create: async (data: any) => {
+  create: async (data: any & { targetDepartments?: string[]; targetYears?: number[]; eligibilityEnabled?: boolean }) => {
     const res = await api.post('/hackathons', data)
     return res.data
   },
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat: add department API functions and update user/hackathon payloads"
```

---

### Task 6: Frontend — Department Management Tab in AdminPage

**Files:**
- Modify: `apps/web/src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `departmentAPI` from api.ts
- Produces: Departments tab with list, add, rename, delete

- [ ] **Step 1: Add state and load function**

Add state:
```typescript
const [departments, setDepartments] = useState<any[]>([])
const [newDeptName, setNewDeptName] = useState('')
const [editingDept, setEditingDept] = useState<string | null>(null)
const [editDeptName, setEditDeptName] = useState('')
```

Add load function:
```typescript
const loadDepartments = async () => {
  try {
    const data = await departmentAPI.getAll()
    setDepartments(data)
  } catch (err) {
    console.error('Failed to load departments')
  }
}
```

Call in useEffect alongside existing loads.

- [ ] **Step 2: Add "Departments" tab button**

In the tab bar, add after "Colleges" tab:

```tsx
<button
  onClick={() => setActiveTab('departments')}
  className={clsx(
    'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
    activeTab === 'departments' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
  )}
>
  <Building2 size={16} />
  Departments
</button>
```

Add `Building2` to the lucide-react imports.

- [ ] **Step 3: Add departments tab content**

After the existing tab content sections, add:

```tsx
{activeTab === 'departments' && (
  <div className="space-y-4">
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={newDeptName}
        onChange={(e) => setNewDeptName(e.target.value)}
        placeholder="Department name"
        className="flex-1 px-4 py-2 border border-surface-200 rounded-xl text-sm"
        onKeyDown={(e) => e.key === 'Enter' && handleAddDept()}
      />
      <button
        onClick={handleAddDept}
        disabled={!newDeptName.trim()}
        className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 disabled:opacity-50"
      >
        Add
      </button>
    </div>

    <div className="space-y-2">
      {departments.map((dept) => (
        <div key={dept.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-surface-100">
          {editingDept === dept.id ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={editDeptName}
                onChange={(e) => setEditDeptName(e.target.value)}
                className="flex-1 px-3 py-1 border border-surface-200 rounded-lg text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameDept(dept.id)
                  if (e.key === 'Escape') setEditingDept(null)
                }}
                autoFocus
              />
              <button onClick={() => handleRenameDept(dept.id)} className="text-green-600 hover:text-green-700">
                <Check size={16} />
              </button>
              <button onClick={() => setEditingDept(null)} className="text-surface-400 hover:text-surface-600">
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <div>
                <span className="font-medium text-surface-900">{dept.name}</span>
                <span className="text-surface-400 text-xs ml-2">{dept._count?.users || 0} users</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setEditingDept(dept.id); setEditDeptName(dept.name) }}
                  className="p-1 text-surface-400 hover:text-primary-600 rounded"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDeleteDept(dept.id, dept.name)}
                  className="p-1 text-surface-400 hover:text-red-600 rounded"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Add handler functions**

```typescript
const handleAddDept = async () => {
  if (!newDeptName.trim()) return
  try {
    await departmentAPI.create(newDeptName.trim())
    setNewDeptName('')
    loadDepartments()
    toast.success('Department added')
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Failed to add department')
  }
}

const handleRenameDept = async (id: string) => {
  if (!editDeptName.trim()) return
  try {
    await departmentAPI.update(id, editDeptName.trim())
    setEditingDept(null)
    loadDepartments()
    toast.success('Department renamed')
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Failed to rename')
  }
}

const handleDeleteDept = async (id: string, name: string) => {
  if (!confirm(`Delete department "${name}"?`)) return
  try {
    await departmentAPI.delete(id)
    loadDepartments()
    toast.success('Department deleted')
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Failed to delete')
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AdminPage.tsx
git commit -m "feat: add department management tab in admin"
```

---

### Task 7: Frontend — Update AddTeacherPage to Use Department Dropdown

**Files:**
- Modify: `apps/web/src/pages/AddTeacherPage.tsx`

**Interfaces:**
- Consumes: `departmentAPI.getAll()`
- Produces: Department dropdown replacing free-text input

- [ ] **Step 1: Add departments state and load**

```typescript
const [departments, setDepartments] = useState<any[]>([])

useEffect(() => {
  loadDepartments()
}, [])

const loadDepartments = async () => {
  try {
    const data = await departmentAPI.getAll()
    setDepartments(data)
  } catch (err) {}
}
```

Import `departmentAPI` from api.ts.

- [ ] **Step 2: Replace department text input with dropdown**

Find the department input field and replace:

```diff
-  <input type="text" value={form.department} onChange={...} placeholder="Department" />
+  <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
+    <option value="">Select Department</option>
+    {departments.map((d) => (
+      <option key={d.id} value={d.id}>{d.name}</option>
+    ))}
+  </select>
```

- [ ] **Step 3: Update form state**

Change `department: ''` to `departmentId: ''`.

- [ ] **Step 4: Update handleSubmit**

Change `department: form.department` to `departmentId: form.departmentId` in the API call.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AddTeacherPage.tsx
git commit -m "feat: department dropdown in add teacher form"
```

---

### Task 8: Frontend — Update AddStudentPage to Use Department Dropdown + Incoming Year

**Files:**
- Modify: `apps/web/src/pages/AddStudentPage.tsx`

**Interfaces:**
- Consumes: `departmentAPI.getAll()`
- Produces: Department dropdown, incoming year input, computed outgoing year display

- [ ] **Step 1: Add departments state and load**

Same as Task 7.

- [ ] **Step 2: Replace department text input with dropdown**

Same pattern as Task 7.

- [ ] **Step 3: Replace year/semester inputs with incoming year**

Find the year and semester fields, replace with:

```tsx
<div>
  <label className="block text-sm font-medium text-surface-700 mb-1">Incoming Year</label>
  <input
    type="number"
    value={form.incomingYear}
    onChange={(e) => setForm({ ...form, incomingYear: e.target.value })}
    placeholder="e.g., 2024"
    min="2020"
    max="2030"
  />
</div>
{form.incomingYear && (
  <div className="text-sm text-surface-500">
    Outgoing: {parseInt(form.incomingYear) + 4} • Current Year: {Math.min(Math.max(new Date().getFullYear() - parseInt(form.incomingYear) + 1, 1), 4)}
  </div>
)}
```

- [ ] **Step 4: Update form state**

Change:
```typescript
department: '' → departmentId: ''
year: '' → incomingYear: ''
semester: '' → (remove)
```

- [ ] **Step 5: Update handleSubmit**

Change API call payload to use `departmentId` and `incomingYear`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/AddStudentPage.tsx
git commit -m "feat: department dropdown and incoming year in add student form"
```

---

### Task 9: Frontend — Hackathon Create Form with Department/Year Targeting

**Files:**
- Modify: `apps/web/src/pages/HackathonsPage.tsx`

**Interfaces:**
- Consumes: `departmentAPI.getAll()`
- Produces: Multi-select departments, year checkboxes, eligibility toggle in create form

- [ ] **Step 1: Add departments state and load**

```typescript
const [departments, setDepartments] = useState<any[]>([])
const [targetDepts, setTargetDepts] = useState<string[]>([])
const [targetYears, setTargetYears] = useState<number[]>([])
const [eligibilityEnabled, setEligibilityEnabled] = useState(false)
```

Load departments on mount alongside hackathons.

- [ ] **Step 2: Add targeting section to create form modal**

After the existing form fields, before the AI rounds section, add:

```tsx
{/* Targeting */}
<div className="border-t border-surface-100 pt-4 mt-4">
  <h4 className="text-sm font-semibold text-surface-700 mb-3">Target Students</h4>

  {/* Department multi-select */}
  <div className="mb-3">
    <label className="block text-xs font-medium text-surface-500 mb-1.5">Departments</label>
    <div className="flex flex-wrap gap-2">
      {departments.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => {
            setTargetDepts(prev =>
              prev.includes(d.id) ? prev.filter(id => id !== d.id) : [...prev, d.id]
            )
          }}
          className={clsx(
            'px-3 py-1 rounded-full text-xs font-medium transition-all border',
            targetDepts.includes(d.id)
              ? 'bg-primary-500 text-white border-primary-500'
              : 'bg-surface-50 text-surface-600 border-surface-200 hover:border-primary-300'
          )}
        >
          {d.name}
        </button>
      ))}
    </div>
  </div>

  {/* Year checkboxes */}
  <div className="mb-3">
    <label className="block text-xs font-medium text-surface-500 mb-1.5">Year of Study</label>
    <div className="flex gap-2">
      {[1, 2, 3, 4].map((y) => (
        <button
          key={y}
          type="button"
          onClick={() => {
            setTargetYears(prev =>
              prev.includes(y) ? prev.filter(v => v !== y) : [...prev, y]
            )
          }}
          className={clsx(
            'px-3 py-1 rounded-full text-xs font-medium transition-all border',
            targetYears.includes(y)
              ? 'bg-primary-500 text-white border-primary-500'
              : 'bg-surface-50 text-surface-600 border-surface-200 hover:border-primary-300'
          )}
        >
          {y}{y === 1 ? 'st' : y === 2 ? 'nd' : y === 3 ? 'rd' : 'th'}
        </button>
      ))}
    </div>
  </div>

  {/* Eligibility toggle */}
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={eligibilityEnabled}
      onChange={(e) => setEligibilityEnabled(e.target.checked)}
      className="rounded border-surface-300"
    />
    <span className="text-sm text-surface-700">Enforce eligibility (only selected students can register)</span>
  </label>
</div>
```

- [ ] **Step 3: Pass targeting data to API call**

In `handleCreate`, add to the API call:

```typescript
await hackathonAPI.create({
  ...form,
  themes: ...,
  rounds: ...,
  targetDepartments: targetDepts,
  targetYears: targetYears,
  eligibilityEnabled,
})
```

- [ ] **Step 4: Reset targeting state after create**

After successful creation, reset:

```typescript
setTargetDepts([])
setTargetYears([])
setEligibilityEnabled(false)
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/HackathonsPage.tsx
git commit -m "feat: department/year targeting in hackathon create form"
```

---

### Task 10: Frontend — Show Targeting Badges on Hackathon Detail Page

**Files:**
- Modify: `apps/web/src/pages/HackathonDetailPage.tsx`

**Interfaces:**
- Consumes: `hackathon.targetDepartments`, `hackathon.targetYears`, `hackathon.eligibilityEnabled`
- Produces: Badge display for targeted departments and years

- [ ] **Step 1: Add departments state to resolve department names**

```typescript
const [departments, setDepartments] = useState<any[]>([])

useEffect(() => {
  departmentAPI.getAll().then(setDepartments).catch(() => {})
}, [])
```

- [ ] **Step 2: Add targeting badges section**

After the Quick Info Bar section, before the About section, add:

```tsx
{/* Targeting Info */}
{(targetDepts.length > 0 || targetYears.length > 0) && (
  <div className="bg-white rounded-2xl border border-surface-100 p-6">
    <h3 className="font-bold text-surface-900 mb-3">Eligibility</h3>
    <div className="space-y-2">
      {targetDepts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-surface-500">Departments:</span>
          {targetDepts.map((id) => {
            const dept = departments.find(d => d.id === id)
            return dept ? (
              <span key={id} className="px-2.5 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-medium">
                {dept.name}
              </span>
            ) : null
          })}
        </div>
      )}
      {targetYears.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-surface-500">Years:</span>
          {targetYears.sort().map((y) => (
            <span key={y} className="px-2.5 py-1 bg-accent-50 text-accent-700 rounded-full text-xs font-medium">
              {y}{y === 1 ? 'st' : y === 2 ? 'nd' : y === 3 ? 'rd' : 'th'} Year
            </span>
          ))}
        </div>
      )}
      {hackathon.eligibilityEnabled && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs font-semibold">
          <Shield size={12} /> Eligibility Enforced
        </span>
      )}
    </div>
  </div>
)}
```

Add `Shield` to lucide-react imports.

- [ ] **Step 3: Parse JSON fields**

Where hackathon data is loaded, parse the JSON fields:

```typescript
const targetDepts: string[] = JSON.parse(hackathon.targetDepartments || '[]')
const targetYears: number[] = JSON.parse(hackathon.targetYears || '[]')
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/HackathonDetailPage.tsx
git commit -m "feat: show targeting badges on hackathon detail page"
```

---

### Task 11: Update Seed Data

**Files:**
- Modify: `packages/backend/prisma/seed.ts`

**Interfaces:**
- Produces: Sample departments, updated user creation with departmentId

- [ ] **Step 1: Create departments in seed**

After creating the college, add:

```typescript
const csDept = await prisma.department.create({
  data: { name: 'Computer Science', collegeId: college.id },
})
const eeDept = await prisma.department.create({
  data: { name: 'Electrical Engineering', collegeId: college.id },
})
const meDept = await prisma.department.create({
  data: { name: 'Mechanical Engineering', collegeId: college.id },
})
```

- [ ] **Step 2: Update user creation to use departmentId and incomingYear**

Update student creation:

```typescript
{ email: 'alex@university.edu', name: 'Alex Johnson', departmentId: csDept.id, studentId: 'CS2023001', collegeId: college.id, incomingYear: 2023 },
```

Update teacher creation:

```typescript
{ email: 'prof.sharma@university.edu', name: 'Prof. Sharma', departmentId: csDept.id, empNumber: 'EMP001', collegeId: college.id },
```

- [ ] **Step 3: Run seed**

```bash
cd packages/backend
npx prisma db seed
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/prisma/seed.ts
git commit -m "feat: update seed data with departments and incomingYear"
```

---

### Task 12: Build, Test, Verify

**Files:**
- None (verification only)

- [ ] **Step 1: Run Prisma migration**

```bash
cd packages/backend
npx prisma migrate dev
```

- [ ] **Step 2: Run seed**

```bash
npx prisma db seed
```

- [ ] **Step 3: Build frontend**

```bash
cd apps/web
npm run build
```

- [ ] **Step 4: Start both servers and manual test**

- Admin page → Departments tab → add/edit/delete departments
- Add teacher → department dropdown works
- Add student → department dropdown, incoming year, outgoing year computed
- Create hackathon → department/year multi-select, eligibility toggle
- Hackathon detail → targeting badges shown
- Register for hackathon → eligibility check enforced

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: department system with hackathon targeting complete"
```
