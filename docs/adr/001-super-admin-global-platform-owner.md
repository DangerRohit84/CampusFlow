# ADR 001: SUPER_ADMIN as Global Platform Owner

- **Status:** accepted
- **Date:** 2026-09-04
- **Deciders:** CTO
- **Scope:** auth, tenant isolation, all college-scoped resources (rooms, assignments, forms, hackathons, internships, contests, departments, announcements, colleges)

## Context

CampusFlow is multi-tenant: one `College` has many users, departments, rooms, assignments, forms, hackathons, internships, contests, announcements. Previous implementation treated `SUPER_ADMIN` and `COLLEGE_ADMIN` as interchangeable in most checks (`role === 'COLLEGE_ADMIN' || role === 'SUPER_ADMIN'`), and assumed every user has `collegeId`. Concrete forces:

- **Business:** `SUPER_ADMIN` is platform operator (owns the SaaS), manages all tenants: approve/reject colleges, CRUD colleges, assign college-admins, view cross-college analytics, operate global services (contest fetcher, opportunity fetcher, AI manager, staging review). `COLLEGE_ADMIN` is tenant operator (owns one college), scoped to `collegeId`.
- **Technology:** Prisma `User.collegeId` is `String?` nullable. Super admins should be `collegeId = null` (global, not orphaned to a tenant). Existing registration allowed `role: SUPER_ADMIN` via public `/auth/register` — privilege escalation. Tenant isolation helpers were ad-hoc (`user.collegeId !== resource.collegeId && !isSuper`) duplicated per route, often missing or using wrong collegeId (e.g., department validation used `user.collegeId` instead of derived `collegeId` for super admin, blocking cross-college creation).
- **Team:** Confusing UX — Super admin drilled into a college then creating departments/users failed because `collegeId` wasn't forwarded; Rooms listing filtered by `teacherId == me` so super admin only saw rooms they created, not platform-wide; Internships listing early-returned `[]` for `!collegeId` (super admin); AssignmentHub department creation broken for super admin.

## Decision

**SUPER_ADMIN is distinct from all other roles: global singleton, `collegeId = null`, bypasses tenant isolation; COLLEGE_ADMIN is per-college.**

### Model

- `User.role` remains `String` but validated centrally:
  - Public `POST /auth/register` only allows `STUDENT` / `TEACHER`; `SUPER_ADMIN` → 403, `COLLEGE_ADMIN` → 403 (must go via `/register-college` or super-admin promotion). Prevents self-escalation.
  - `PUT /admin/users/:id` — only `SUPER_ADMIN` may assign `SUPER_ADMIN`; promotion to `SUPER_ADMIN` clears `collegeId`/`departmentId` (global). Promotion to `COLLEGE_ADMIN` requires a `collegeId`.
  - Helper `utils/roles.ts`: `isSuperAdmin`, `isCollegeAdmin`, `canAccessCollege(user, resourceCollegeId)` (`isSuper → true`), `deriveCollegeId(user, explicitCollegeId)` (super: explicit or null; others: own `collegeId`).

### Backend Invariants

- **Every college-scoped write** derives `collegeId` via `deriveCollegeId`. Super admin may explicitly target a college: `body.collegeId`. Tenant roles ignore supplied `collegeId` (use own).
- **Every college-scoped read** checks `canAccessCollege` or `isSuperAdmin` bypass. List endpoints:
  - Super admin: `where = {}` (global) or `?collegeId=` filter. Tenant: `where.collegeId = user.collegeId`.
  - Fixed: `GET /internships` (super now global, supports `?collegeId=`), `GET /rooms` (super now global, optional `?collegeId=` via teacher join), `GET /rooms/unread-counts` (super now all rooms), `GET /assignments/hub` (super `buildHubListWhere` now respects `?collegeId=`), `POST /assignments/hub` department validation now uses `derivedCollegeId`, same for `PUT`.
  - `PUT/DELETE /rooms/:id` now allow `creator || isSuper || isCollegeAdminForSameCollege` (previously creator-only).
  - `POST /internships`, `GET /internships/:id/registrations`, `PUT ...`, `GET /export/:id`, `GET /export-all` now include super admin and correct college derivation.
  - `POST /forms` now derives `collegeId` for super admin via `body.collegeId`.
  - `POST /fetch` etc remain super-only (authorize middleware).
- **Department creation** for super admin inside college drill now correctly targets selected college via frontend forwarding.

### Frontend Invariants

- `navByRole.SUPER_ADMIN` already distinct (Fetch, AI Manager, Admin Panel). Keep — super admin is global, tenant admins don't see Fetch/AI Manager.
- `AdminPage`: when super admin drilled (`selectedCollegeId`), all scoped creates (`departmentAPI.create`, `adminAPI.addTeacher/addStudent`, `loadCollegeData`) explicitly pass `selectedCollegeId`. Added warning when `isSuperAdmin && !selectedCollegeId`.
- `AddTeacherPage` / `AddStudentPage`: for super admin show college selector (fetched via `adminAPI.getColleges`), fetch departments scoped to selected college, require selection before create, pass `collegeId` to `adminAPI.addTeacher/addStudent` and `bulkAdd*`. Tenant admins unchanged (own college implied).
- `departmentAPI.create` / `adminAPI.bulkAdd*` updated to carry `collegeId` for super admin bulk.
- `assignmentHubAPI.getHubs` now supports `collegeId` query for super admin global filtering.

## Consequences

### What becomes easier

- Supply-chain: single source of truth for role/tenant checks → less copy-paste `if (user.role !== 'SUPER_ADMIN' && ...)` bugs; linter can enforce `import { isSuperAdmin }`.
- Operations: super admin can manage any tenant without creating a dummy `collegeId` or impersonating; onboarding new colleges and disaster recovery (tenant deletion, user moves) no longer blocked.
- Security: public registration closed for escalation; Hyrum-proof — future endpoints must use `deriveCollegeId`/`canAccessCollege` or fail closed (400 if missing collegeId for super admin).
- UX: super admin college-drill pattern is consistent (Admin → pick college → analytics/users/departments/content scoped); empty states explain why.

### What becomes harder / trade-offs accepted

- **Super admin null collegeId** means queries like `where: { collegeId: user.collegeId }` must branch; we added branches in 6+ routes — slight complexity vs creating a synthetic “global” college row. Rejected global-college row because it pollutes `College` table and breaks `collegeId` FK semantics (rooms/hubs/forms with `collegeId=null` already mean global/system).
- **Global listings** (rooms, internships, hubs) pagination for super admin can be large (cross-tenant). We cap `limit 50` and add `?collegeId=` filter recommendation; not full multi-tenant search index yet. Future: read replicas + ES.
- **Existing users** with `role=SUPER_ADMIN` but non-null `collegeId` (legacy) are still treated as global via `isSuperAdmin` bypass, but their stray `collegeId` is ignored (fallback to null). Migration to nullify them is optional; no breaking migration required now.
- **Testing burden:** need tenant-isolation QA matrix (4 roles × N resources). Added to verification checklist.

## Alternatives considered

- **Keep SUPER_ADMIN as just another COLLEGE_ADMIN with collegeId='global' string.** Rejected — requires FK to fake college, leaks into analytics (`_count` per college), complicates joins, violates “collegeId nullable = global” already encoded in schema.
- **Separate `PlatformAdmin` table.** Rejected — duplicates user auth, complicates login, audit, notifications.
- **Enum for role in Prisma schema.** Deferred — would require migration and doesn't fix escalation bug alone; string+runtime guard is faster, enum can be added later with same helpers.

## Validation

- `tsc --noEmit` (backend) passes; `npm run build` passes.
- Manual QA matrix: login as SUPER_ADMIN (collegeId null) → Admin Panel → college list → drill → users/departments/content filtered correctly; create department/teacher/student with collegeId scoping; Rooms global list vs tenant list; AssignmentHub create with DEPARTMENT scope for target college succeeds; Internships global vs tenant; Forms create with collegeId; unauthorized collegeId tampering → 403.
- Negative: public `POST /auth/register {role: SUPER_ADMIN}` → 403; `PUT /admin/users/:id {role: SUPER_ADMIN}` by COLLEGE_ADMIN → 403.

## Revisit date

2027-03-04 (6 months) or when introducing multi-region/cell architecture — super admin will need region-aware scoping.
