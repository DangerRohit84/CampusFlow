# Class Representative (CR) Feature Design

**Date:** 2026-08-06
**Status:** Approved

---

## Overview

Add a "Class Representative" (CR) role within rooms. A teacher can designate any student member of a room as CR. CRs gain form management privileges — creating, editing, and deleting forms linked to rooms they represent.

---

## Schema Changes

### `RoomMember` — add `isCR` boolean

```prisma
model RoomMember {
  id        String   @id @default(uuid())
  roomId    String
  studentId String
  isCR      Boolean  @default(false)   // NEW
  joinedAt  DateTime @default(now())

  room    Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  student User @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([roomId, studentId])
  @@index([roomId])
}
```

**Migration:** `npx prisma db push` (SQLite dev) — adds `isCR` column with default `false`.

---

## Backend Changes

### New Routes (in `packages/backend/src/routes/rooms.ts`)

#### `POST /rooms/:id/make-cr`

- **Auth:** Teacher only (must be room owner)
- **Body:** `{ studentId: string }`
- **Logic:** Verify user is teacher, room exists, teacher owns room, student is a member. Update `RoomMember.isCR = true`.
- **Response:** `{ member }` with updated CR status.

#### `POST /rooms/:id/remove-cr`

- **Auth:** Teacher only (must be room owner)
- **Body:** `{ studentId: string }`
- **Logic:** Same ownership check. Update `RoomMember.isCR = false`.
- **Response:** `{ member }` with updated CR status.

### Modified Routes

#### `POST /forms` (form creation)

- **Current:** Only `TEACHER`, `COLLEGE_ADMIN`, `SUPER_ADMIN` can create.
- **New:** Also allow students who are CR of at least one room listed in `roomIds`.
- **Check:** If user role is `STUDENT`, verify `roomIds` is provided and user is `isCR: true` in at least one of those rooms.

#### `PUT /forms/:id` (form update)

- **Current:** Teacher owns form, or admin.
- **New:** Also allow if user is CR of any room linked to the form (via `FormRoom`).

#### `DELETE /forms/:id` (form delete)

- **Current:** Teacher owns form, or admin.
- **New:** Also allow if user is CR of any room linked to the form.

---

## Frontend Changes

### `RoomDetailPage.tsx` (Teacher View)

- Each student member row gets a **"Make CR"** button (or **"Remove CR"** if already CR).
- CR students show a **"CR" badge** (styled like existing role badges).
- Click toggles CR status via `POST /rooms/:id/make-cr` or `remove-cr`.

### `StudentRoomDetailPage.tsx`

- CR members show a **"CR" badge** next to their name in the member list.
- No action buttons (students cannot manage CR).

### `FormsPage.tsx`

- If user is `STUDENT` and is CR of at least one room, show **"Create Form"** button.
- When creating form, CR can link rooms they are CR of (same room selection popup as teacher).
- CR-created forms show in their forms list with full edit/delete access.

### `FormDetailPage.tsx`

- CR can edit fields, extend deadline, export — same as teacher for forms they created or forms linked to their rooms.

### `api.ts` — new API methods

```typescript
makeCR: (roomId: string, studentId: string) =>
  api.post(`/rooms/${roomId}/make-cr`, { studentId }).then(r => r.data),
removeCR: (roomId: string, studentId: string) =>
  api.post(`/rooms/${roomId}/remove-cr`, { studentId }).then(r => r.data),
```

---

## Data Flow

1. Teacher opens Room → sees member list with CR badges and toggle buttons.
2. Clicks "Make CR" → `POST /rooms/:id/make-cr` → student becomes CR.
3. Student logs in → sees CR badge in their room view.
4. CR goes to FormsPage → "Create Form" button appears.
5. CR creates form → links it to room(s) → only room members can respond.
6. CR can edit/delete forms in their rooms.

---

## Edge Cases

- **Multiple CRs per room:** Allowed. Any CR can manage any form linked to the room.
- **CR leaves room:** `RoomMember` deleted (cascade), CR status gone. Forms remain.
- **Teacher removes CR:** `isCR` set to false. Forms remain, but student loses edit/delete access.
- **Student creates form without linking rooms:** Rejected — must link at least one room they're CR of.
- **CR tries to create form for room they're not CR of:** Rejected.

---

## Files to Modify

1. `packages/backend/prisma/schema.prisma` — add `isCR` to `RoomMember`
2. `packages/backend/src/routes/rooms.ts` — add make-cr, remove-cr routes
3. `packages/backend/src/routes/forms.ts` — modify create/update/delete auth checks
4. `apps/web/src/pages/RoomDetailPage.tsx` — CR toggle buttons + badge
5. `apps/web/src/pages/StudentRoomDetailPage.tsx` — CR badge display
6. `apps/web/src/pages/FormsPage.tsx` — CR create form button + room linking
7. `apps/web/src/pages/FormDetailPage.tsx` — CR edit/delete access
8. `apps/web/src/lib/api.ts` — makeCR/removeCR API methods
