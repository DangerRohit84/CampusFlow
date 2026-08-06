# Class Representative (CR) Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Class Representative (CR) role to rooms — teachers can designate students as CRs, and CRs can create/manage forms for those rooms.

**Architecture:** Add `isCR` boolean to `RoomMember`. Two new backend routes for make/remove CR. Modify form CRUD auth to allow CRs. Frontend: CR toggle on teacher room detail, CR badge on student room detail, CR create form button on FormsPage.

**Tech Stack:** Prisma + SQLite, Express, React + Tailwind CSS

## Global Constraints

- SQLite database (no `mode: 'insensitive'` in queries)
- TypeScript strict — no `any` casts unless unavoidable
- Backend runs on port 4000, frontend on port 3000
- Use existing API pattern: `api.get/post/put/delete` from `lib/api.ts`
- Forms already have `FormRoom` join table linking forms to rooms
- `RoomMember` model has `roomId`, `studentId`, `joinedAt`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/backend/prisma/schema.prisma` | Modify | Add `isCR` to `RoomMember` |
| `packages/backend/src/routes/rooms.ts` | Modify | Add `make-cr`, `remove-cr` routes |
| `packages/backend/src/routes/forms.ts` | Modify | Allow CRs to create/edit/delete forms |
| `apps/web/src/lib/api.ts` | Modify | Add `makeCR`/`removeCR` API methods |
| `apps/web/src/pages/RoomDetailPage.tsx` | Modify | Teacher: CR toggle + badge |
| `apps/web/src/pages/StudentRoomDetailPage.tsx` | Modify | Student: CR badge display |
| `apps/web/src/pages/FormsPage.tsx` | Modify | CR create form button |
| `apps/web/src/pages/FormDetailPage.tsx` | Modify | CR edit/delete access |

---

### Task 1: Add `isCR` to RoomMember schema

**Files:**
- Modify: `packages/backend/prisma/schema.prisma:401-411`

- [ ] **Step 1: Add `isCR` field to `RoomMember` model**

```prisma
model RoomMember {
  id        String   @id @default(uuid())
  roomId    String
  studentId String
  isCR      Boolean  @default(false)
  joinedAt  DateTime @default(now())

  room    Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  student User @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([roomId, studentId])
  @@index([roomId])
}
```

- [ ] **Step 2: Push schema to database**

Run: `cd packages/backend; npx prisma db push`

- [ ] **Step 3: Verify migration**

Run: `cd packages/backend; npx prisma studio` — open RoomMember table, confirm `isCR` column exists with default `false`.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/prisma/schema.prisma
git commit -m "feat: add isCR boolean to RoomMember schema"
```

---

### Task 2: Add make-cr / remove-cr backend routes

**Files:**
- Modify: `packages/backend/src/routes/rooms.ts`

**Interfaces:**
- Consumes: `prisma` client, `AuthRequest` type, `authMiddleware`
- Produces: `POST /rooms/:id/make-cr`, `POST /rooms/:id/remove-cr`

- [ ] **Step 1: Add `make-cr` route at the end of rooms.ts (before `export default router`)**

```typescript
// Make a student CR (Teacher only)
router.post('/:id/make-cr', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'TEACHER') {
      res.status(403).json({ error: 'Only teachers can manage CR status' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id: req.params.id } })
    if (!room || room.teacherId !== req.userId) {
      res.status(403).json({ error: 'You can only manage CR in your own rooms' })
      return
    }

    const { studentId } = req.body
    if (!studentId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }

    const member = await prisma.roomMember.findUnique({
      where: { roomId_studentId: { roomId: req.params.id, studentId } }
    })
    if (!member) {
      res.status(404).json({ error: 'Student is not a member of this room' })
      return
    }

    const updated = await prisma.roomMember.update({
      where: { id: member.id },
      data: { isCR: true },
    })

    res.json({ member: updated })
  } catch (error) {
    console.error('Make CR error:', error)
    res.status(500).json({ error: 'Failed to make CR' })
  }
})

// Remove CR status (Teacher only)
router.post('/:id/remove-cr', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'TEACHER') {
      res.status(403).json({ error: 'Only teachers can manage CR status' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id: req.params.id } })
    if (!room || room.teacherId !== req.userId) {
      res.status(403).json({ error: 'You can only manage CR in your own rooms' })
      return
    }

    const { studentId } = req.body
    if (!studentId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }

    const member = await prisma.roomMember.findUnique({
      where: { roomId_studentId: { roomId: req.params.id, studentId } }
    })
    if (!member) {
      res.status(404).json({ error: 'Student is not a member of this room' })
      return
    }

    const updated = await prisma.roomMember.update({
      where: { id: member.id },
      data: { isCR: false },
    })

    res.json({ member: updated })
  } catch (error) {
    console.error('Remove CR error:', error)
    res.status(500).json({ error: 'Failed to remove CR' })
  }
})
```

- [ ] **Step 2: Add `isCR` to the members include in existing routes**

In `GET /rooms/:id` (teacher detail), the members include already has `student: { select: { ... } }`. We need to add `isCR` to the member object. Find the route that returns room with members and ensure `isCR` is returned.

Actually, `isCR` is a field on `RoomMember` itself, so it's automatically included. No changes needed for existing routes.

- [ ] **Step 3: Verify routes compile**

Run: `cd packages/backend; npx tsc --noEmit 2>&1 | Select-String "rooms.ts"`

- [ ] **Step 4: Test manually**

Start backend, then:
```bash
# Make CR
curl -X POST http://localhost:4000/rooms/{roomId}/make-cr \
  -H "Authorization: Bearer {teacherToken}" \
  -H "Content-Type: application/json" \
  -d '{"studentId": "{studentId}"}'

# Remove CR
curl -X POST http://localhost:4000/rooms/{roomId}/remove-cr \
  -H "Authorization: Bearer {teacherToken}" \
  -H "Content-Type: application/json" \
  -d '{"studentId": "{studentId}"}'
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/rooms.ts
git commit -m "feat: add make-cr and remove-cr backend routes"
```

---

### Task 3: Modify form CRUD to allow CRs

**Files:**
- Modify: `packages/backend/src/routes/forms.ts`

**Interfaces:**
- Consumes: `prisma` client, `AuthRequest` type
- Produces: Modified auth checks on POST, PUT, DELETE

- [ ] **Step 1: Modify POST /forms — allow CRs to create forms**

Replace the role check at the top of the create handler. Currently:

```typescript
if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
  res.status(403).json({ error: 'Only teachers can create forms' })
  return
}
```

Replace with:

```typescript
const isCR = user.role === 'STUDENT' && roomIds?.length > 0 && await prisma.roomMember.findFirst({
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
```

- [ ] **Step 2: Modify PUT /forms/:id — allow CRs to edit forms linked to their rooms**

After the ownership check, add CR check. Find the block:

```typescript
if (user.role === 'TEACHER' && existingForm.creatorId !== req.userId) {
  res.status(403).json({ error: 'Can only update your own forms' })
  return
}
```

Replace with:

```typescript
const isOwner = user.role === 'TEACHER' && existingForm.creatorId === req.userId
const isAdmin = user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
const isCRofLinkedRoom = user.role === 'STUDENT' && await prisma.formRoom.findFirst({
  where: {
    formId: req.params.id,
    room: { members: { some: { studentId: req.userId!, isCR: true } } },
  }
})

if (!isOwner && !isAdmin && !isCRofLinkedRoom) {
  res.status(403).json({ error: 'You do not have permission to edit this form' })
  return
}
```

- [ ] **Step 3: Modify DELETE /forms/:id — allow CRs to delete forms linked to their rooms**

Same pattern as PUT. Find the delete handler's ownership check and replace with the same `isOwner || isAdmin || isCRofLinkedRoom` logic.

- [ ] **Step 4: Modify PUT /forms/:id/fields — allow CRs to edit fields**

Same ownership/CR check as the PUT route.

- [ ] **Step 5: Verify**

Run: `cd packages/backend; npx tsc --noEmit 2>&1 | Select-String "forms.ts"`

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/forms.ts
git commit -m "feat: allow CRs to create/edit/delete forms for their rooms"
```

---

### Task 4: Add frontend API methods

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: existing `api` axios instance
- Produces: `roomAPI.makeCR`, `roomAPI.removeCR`

- [ ] **Step 1: Add makeCR and removeCR to roomAPI**

Find the `roomAPI` object and add after `delete`:

```typescript
makeCR: (roomId: string, studentId: string) =>
  api.post(`/rooms/${roomId}/make-cr`, { studentId }).then(r => r.data),
removeCR: (roomId: string, studentId: string) =>
  api.post(`/rooms/${roomId}/remove-cr`, { studentId }).then(r => r.data),
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd apps/web; npx tsc --noEmit 2>&1 | Select-String "api.ts"`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat: add makeCR/removeCR frontend API methods"
```

---

### Task 5: Teacher Room Detail — CR toggle + badge

**Files:**
- Modify: `apps/web/src/pages/RoomDetailPage.tsx`

**Interfaces:**
- Consumes: `roomAPI.makeCR`, `roomAPI.removeCR`, member list with `isCR` field
- Produces: CR badge + toggle button per member

- [ ] **Step 1: Add `handleToggleCR` function**

```typescript
const handleToggleCR = async (studentId: string, isCurrentlyCR: boolean) => {
  try {
    if (isCurrentlyCR) {
      await roomAPI.removeCR(id!, studentId)
      toast.success('CR removed')
    } else {
      await roomAPI.makeCR(id!, studentId)
      toast.success('Student is now CR')
    }
    loadRoom()
  } catch (err) {
    toast.error('Failed to update CR status')
  }
}
```

- [ ] **Step 2: Update member list to show CR badge + toggle**

In the members section, each student row should show:
- A "CR" badge if `member.isCR` is true
- A button: "Make CR" if not CR, "Remove CR" if CR

Find the member list rendering and add:

```tsx
{member.isCR && (
  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full">
    CR
  </span>
)}
<button
  onClick={() => handleToggleCR(member.student.id, member.isCR)}
  className={`text-xs font-semibold px-2 py-1 rounded-lg ${
    member.isCR
      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
      : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
  }`}
>
  {member.isCR ? 'Remove CR' : 'Make CR'}
</button>
```

- [ ] **Step 3: Verify visually**

Start both servers, open teacher room detail, confirm CR badge and toggle appear.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/RoomDetailPage.tsx
git commit -m "feat: teacher can toggle CR status with badge and button"
```

---

### Task 6: Student Room Detail — CR badge display

**Files:**
- Modify: `apps/web/src/pages/StudentRoomDetailPage.tsx`

**Interfaces:**
- Consumes: member list with `isCR` field
- Produces: CR badge next to CR member names

- [ ] **Step 1: Add CR badge to member list**

In the members section, next to each member's name, add:

```tsx
{member.isCR && (
  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full">
    CR
  </span>
)}
```

- [ ] **Step 2: Verify visually**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/StudentRoomDetailPage.tsx
git commit -m "feat: show CR badge in student room view"
```

---

### Task 7: FormsPage — CR create form button

**Files:**
- Modify: `apps/web/src/pages/FormsPage.tsx`

**Interfaces:**
- Consumes: `user.role`, `user.id` from authStore, roomAPI to check CR status
- Produces: "Create Form" button visible to CRs

- [ ] **Step 1: Fetch CR rooms on mount**

Add state and fetch:

```typescript
const [crRoomIds, setCrRoomIds] = useState<string[]>([])

useEffect(() => {
  if (user?.role === 'STUDENT') {
    roomAPI.getAll().then((rooms: any[]) => {
      const crIds = rooms
        .filter((r: any) => r.members?.some((m: any) => m.studentId === user.id && m.isCR))
        .map((r: any) => r.id)
      setCrRoomIds(crIds)
    }).catch(() => {})
  }
}, [user])
```

- [ ] **Step 2: Show create button for CRs**

Currently the create button only shows for teachers. Add CR condition:

```typescript
const canCreate = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN' || crRoomIds.length > 0
```

Use `canCreate` instead of the role-only check for the create button visibility.

- [ ] **Step 3: When CR creates form, pre-link their rooms**

When `showCreate` opens for a CR, auto-select their rooms in the room linking step (if room-based flow is used).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/FormsPage.tsx
git commit -m "feat: CRs can see create form button on FormsPage"
```

---

### Task 8: FormDetailPage — CR edit/delete access

**Files:**
- Modify: `apps/web/src/pages/FormDetailPage.tsx`

**Interfaces:**
- Consumes: form data with linked rooms, user from authStore
- Produces: CR can edit/delete forms in their rooms

- [ ] **Step 1: Add CR permission check**

```typescript
const isCRofLinkedRoom = user?.role === 'STUDENT' && form.formRooms?.some(
  (fr: any) => fr.room.members?.some((m: any) => m.studentId === user.id && m.isCR)
)
const canEdit = isTeacher || isCRofLinkedRoom
```

- [ ] **Step 2: Use `canEdit` for edit/delete buttons**

Replace `isTeacher` checks on edit/delete buttons with `canEdit`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/FormDetailPage.tsx
git commit -m "feat: CRs can edit/delete forms linked to their rooms"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Seed test data**

```bash
cd packages/backend; npx tsx prisma/seed.ts
```

- [ ] **Step 2: Test teacher creates room, adds students, makes one CR**

Login as teacher → Create room → Join students → Make student1 CR → Verify badge appears

- [ ] **Step 3: Test CR creates form**

Login as student1 (CR) → FormsPage → Create Form → Link to room → Verify form created

- [ ] **Step 4: Test non-CR cannot create form**

Login as student2 (not CR) → FormsPage → Verify no create button

- [ ] **Step 5: Test CR can edit/delete form**

Login as student1 → FormDetailPage → Edit/delete → Verify works

- [ ] **Step 6: Test teacher can remove CR**

Login as teacher → Room → Remove CR → Verify badge gone → Verify student1 loses edit access

- [ ] **Step 7: Final commit**

```bash
git add -A; git commit -m "feat: CR feature complete — teacher can designate students as CRs who manage forms"
```
