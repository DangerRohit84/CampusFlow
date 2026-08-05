# Department System + Hackathon Targeting

## Overview

Add structured departments to colleges, link them to students/teachers, and enable hackathon eligibility targeting by department and year of study.

## Current State

- `department` on User is a plain `String?` — free text, no validation
- `year` and `semester` on Student are manual Int fields — must be updated every year
- Hackathons have no department/year targeting
- No Department model exists

## Design

### 1. Department Model

```prisma
model Department {
  id        String   @id @default(uuid())
  name      String
  collegeId String
  createdAt DateTime @default(now())

  college  College @relation(fields: [collegeId], references: [id], onDelete: Cascade)
  users    User[]

  @@unique([collegeId, name])
}
```

- College admin can create, rename, delete departments
- Departments are scoped to a college (no cross-college sharing)
- Delete cascade: deleting a college removes its departments
- Users linked via `departmentId` FK

### 2. User Model Changes

```diff
model User {
-  department   String?
+  departmentId String?
+  department   Department? @relation(fields: [departmentId], references: [id])
```

- `departmentId` replaces free-text `department`
- Backward compatible: `departmentId` is optional

### 3. Student-Specific Changes

Add to User model (when role = STUDENT):
```diff
+  incomingYear  Int?    // e.g., 2024 — year student joined
+  outgoingYear  Int?    // auto-calculated: incomingYear + 4
```

Remove:
- `year` (Int?) — replaced by computed `currentYear`
- `semester` (Int?) — derived from `currentYear`

**Computed field (never stored):**
```
currentYear = min(currentDate.year - incomingYear + 1, 4)
```

| Incoming | Current Date | Computed Year |
|----------|-------------|---------------|
| 2024 | Aug 2024 | 1st |
| 2024 | Aug 2025 | 2nd |
| 2024 | Aug 2026 | 3rd |
| 2024 | Aug 2027 | 4th |
| 2024 | Aug 2028 | graduated (>4) |

### 4. Teacher Changes

Teacher department is set via `departmentId` FK. No other changes.

### 5. Hackathon Targeting

Add to Hackathon model:
```diff
+  targetDepartments  String?  @default("[]")   // JSON array of department IDs
+  targetYears        String?  @default("[]")   // JSON array of year numbers [1,2,3,4]
+  eligibilityEnabled Boolean  @default(false)   // enforce eligibility check
```

**Hackathon creation form additions:**
- Multi-select dropdown: target departments (from college's department list)
- Checkboxes: target years (1st, 2nd, 3rd, 4th year of study)
- Toggle: "Enforce eligibility" (off by default)

**Hackathon card display:**
- Show targeted departments as badges
- Show targeted years as badges
- Show "Eligibility Enforced" badge if enabled

### 6. Eligibility Check Flow

When a student clicks "Register" on a hackathon:

1. If `eligibilityEnabled === false` → allow registration (no check)
2. If `eligibilityEnabled === true`:
   a. Compute student's `currentYear` from `incomingYear` + current date
   b. Check `student.departmentId` is in `hackathon.targetDepartments` array
   c. Check computed `currentYear` is in `hackathon.targetYears` array
   d. If ALL match → allow registration
   e. If any mismatch → show error: "You are not eligible for this hackathon"

### 7. Admin Pages

**Department Management (new tab in AdminPage):**
- List departments with student/teacher count
- Add department: name input
- Rename department: inline edit
- Delete department: confirmation dialog (warns if users attached)

**Student Add Form changes:**
- Department: dropdown (from college's departments) instead of free text
- Incoming Year: number input (e.g., 2024)
- Outgoing Year: auto-calculated display (incoming + 4)
- Year of Study: auto-calculated display (based on current date)
- Remove: year, semester fields

**Teacher Add Form changes:**
- Department: dropdown (from college's departments) instead of free text

**CSV Upload changes:**
- Teacher CSV: Department column maps to department name (looked up by name)
- Student CSV: Department column maps to department name, Incoming Year column added

### 8. Migration Strategy

**SQLite migration:**
1. Create `Department` table
2. Add `departmentId`, `incomingYear`, `outgoingYear` columns to User
3. For existing users with `department` string:
   - Try to find matching Department in their college (case-insensitive name match)
   - If found → set `departmentId`
   - If not found → leave `departmentId` null, keep old `department` string for reference
4. For existing students with `year` field:
   - Set `incomingYear = currentYear - year + 1` (approximate, best-effort)
   - Set `outgoingYear = incomingYear + 4`
5. Drop `year` and `semester` columns after migration

### 9. API Changes

**New routes:**
- `GET /api/departments?collegeId=X` — list departments for a college
- `POST /api/departments` — create department (college admin only)
- `PUT /api/departments/:id` — rename department
- `DELETE /api/departments/:id` — delete department

**Modified routes:**
- `POST /api/admin/users` (add user) — accept `departmentId`, `incomingYear` instead of `department`, `year`, `semester`
- `POST /api/admin/users/bulk` (CSV upload) — same changes
- `POST /api/hackathons` — accept `targetDepartments`, `targetYears`, `eligibilityEnabled`
- `POST /api/hackathons/:id/register` — check eligibility before allowing registration

### 10. Frontend Pages Modified

- `AdminPage.tsx` — new Departments tab
- `AddStudentPage.tsx` — department dropdown, incoming year, remove year/semester
- `AddTeacherPage.tsx` — department dropdown
- `HackathonsPage.tsx` — create form: department/year multi-select, eligibility toggle
- `HackathonDetailPage.tsx` — show targeted departments/years as badges
- `api.ts` — new department API functions, updated user/hackathon creation payloads
