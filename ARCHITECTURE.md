# Architecture

## System Overview

CampusFlow is a monorepo managed by Turborepo with three packages:

```
┌─────────────────────────────────────────────────┐
│                    Frontend                       │
│              React + Vite + Tailwind              │
│                                                   │
 │  ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │
 │  │  Pages   │ │Components│ │    Store/Context  │  │
 │  │  (55)     │ │  (19)    │ │    (Zustand)     │  │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
│       └─────────────┼────────────────┘            │
│                     │                             │
│              ┌──────┴──────┐                      │
│              │   API Client │                      │
│              │  (axios)     │                      │
│              └──────┬──────┘                      │
└─────────────────────┼─────────────────────────────┘
                      │ HTTP
┌─────────────────────┼─────────────────────────────┐
│              ┌──────┴──────┐                      │
│              │   Express    │                      │
│              │   Router     │                      │
│              └──────┬──────┘                      │
│                     │                             │
│  ┌──────────────────┼──────────────────────────┐  │
│  │            Backend (Express)                 │  │
│  │                                              │  │
 │  │  ┌─────────┐ ┌──────────┐ ┌──────────────┐ │  │
 │  │  │ Routes  │ │Services  │ │  Middleware   │ │  │
 │  │  │ (30)    │ │  (14+)    │ │  (auth,err)  │ │  │
│  │  └────┬────┘ └────┬─────┘ └──────────────┘ │  │
│  │       └───────────┼─────────────────────────┘  │
│  │                   │                            │
│  │           ┌───────┴───────┐                    │
│  │           │  Prisma ORM   │                    │
│  │           └───────┬───────┘                    │
│  └───────────────────┼────────────────────────────┘
│                      │
 │              ┌───────┴───────┐
 │              │  PostgreSQL    │
 │              │  (Neon, pooled │
 │              │   + direct)    │
 │              └───────────────┘
└────────────────────────────────────────────────────┘
```

## Data Flow: Opportunity Lifecycle

```
External Platform (Devfolio/Devpost/MLH/Unstop/Internshala)
       │
       │  1. FETCH (scrape + parse)
       ▼
┌──────────────────┐
│  NormalizedOpp   │  Normalized data structure
│  (in-memory)     │
└────────┬─────────┘
         │  2. SAVE (dedup by title+source)
         ▼
┌──────────────────┐
│  Staging Table   │  hackathon_staging / internship_staging
│  status: DRAFT   │  (not yet enriched)
└────────┬─────────┘
         │  3. ENRICH (AI analysis)
         │     - Scrape detail pages
         │     - AI extracts departments, deadlines, prizes
         │     - Search fallback for thin content
         ▼
┌──────────────────┐
│  Staging Table   │  status: DRAFT, has targetDepartments
│  (enriched)      │
└────────┬─────────┘
         │  4. REVIEW (admin)
         │     - Approve → moves to hackathons/internships table
         │     - Reject → stays in staging, auto-deleted after 30 days
         ▼
┌──────────────────┐
│  Final Table     │  hackathons / internships
│  status: APPROVED│  (visible to students)
└──────────────────┘
```

## Backend Routes

### Auth & Users
| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/login` | POST | User login |
| `/api/auth/register` | POST | User registration |
| `/api/user/profile` | GET | Get current user profile |
| `/api/user/profile` | PUT | Update profile |

### Admin
| Route | Method | Description |
|-------|--------|-------------|
| `/api/admin/users` | GET | List users (supports `?collegeId=`) |
| `/api/admin/users` | POST | Create user (SUPER_ADMIN/COLLEGE_ADMIN) |
| `/api/admin/users/:id` | PUT | Update user |
| `/api/admin/users/:id` | DELETE | Delete user |

### Departments
| Route | Method | Description |
|-------|--------|-------------|
| `/api/departments` | GET | List departments (supports `?collegeId=`) |
| `/api/departments` | POST | Create department |
| `/api/departments/:id` | PUT | Update department |
| `/api/departments/:id` | DELETE | Delete department |

### Hackathons
| Route | Method | Description |
|-------|--------|-------------|
| `/api/hackathons` | GET | List approved hackathons |
| `/api/hackathons/:id` | GET | Get hackathon details |
| `/api/hackathons/staging` | GET | List staging items (`?status=PENDING\|APPROVED\|REJECTED`) |
| `/api/hackathons/staging/counts` | GET | Get counts by status |
| `/api/hackathons/staging/:id/approve` | POST | Approve hackathon |
| `/api/hackathons/staging/:id/reject` | POST | Reject hackathon |

### Internships
| Route | Method | Description |
|-------|--------|-------------|
| `/api/internships` | GET | List approved internships |
| `/api/internships/:id` | GET | Get internship details |
| `/api/internships/staging` | GET | List staging items (`?status=PENDING\|APPROVED\|REJECTED`) |
| `/api/internships/staging/counts` | GET | Get counts by status |
| `/api/internships/staging/:id/approve` | POST | Approve internship |
| `/api/internships/staging/:id/reject` | POST | Reject internship |

### Fetch System
| Route | Method | Description |
|-------|--------|-------------|
| `/api/fetch/all` | POST | Fetch from all platforms |
| `/api/fetch/:platform` | POST | Fetch from specific platform |
| `/api/fetch/hackathons/enrich` | POST | Enrich pending hackathons |
| `/api/fetch/internships/enrich` | POST | Enrich pending internships |
| `/api/fetch/cleanup` | POST | Delete old rejected items |
| `/api/fetch/settings/all` | GET | Get all platform limits |
| `/api/fetch/:platform/limit` | PUT | Update platform limit |

### Assignments (AssignmentHub)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/assignments/hub` | CRUD | AssignmentHub with scope ALL/DEPARTMENT/ROOM |
| `/api/assignments/hub/:id/submissions` | POST | Student submit (mode-enforced) |
| `/api/assignments/submissions/:id/grade` | PUT | Teacher grade |
| `/api/assignments/my-submissions` | GET | Student submissions (visibility-gated) |
| `/api/assignments/hub/:id/stats` | GET | Submission stats (showStats gate) |

### Other
| Route | Method | Description |
|-------|--------|-------------|
| `/api/forms` | CRUD | Form management |
| `/api/rooms` | CRUD | Room management |
| `/api/schedules` | CRUD | Schedule management |
| `/api/notifications` | CRUD | Notification management |
| `/api/contests` | CRUD | Coding contest management |
| `/api/coding-profiles` | CRUD | Coding profile management |
| `/api/chat` | WS | Real-time chat |
| `/api/search` | GET | Global search |

## Frontend Pages

### Public
- `/login` — Login page
- `/register` — Registration page
- `/college-registration` — College setup

### Student
- `/` — Dashboard
- `/hackathons` — Browse hackathons
- `/hackathons/:id` — Hackathon detail
- `/internships` — Browse internships
- `/internships/:id` — Internship detail
- `/contests` — Coding contests
- `/leaderboard` — Rankings
- `/chat` — Messaging
- `/settings` — User settings

### Teacher
- `/assigned` — Assigned courses
- `/forms` — Form management
- `/rooms` — Room management

### Admin
- `/admin` — Admin panel (college selection for super admin)
- `/admin/opportunities` — Review hackathons/internships
- `/admin/fetch` — Fetch data from platforms (super admin only)

> Full inventory: **55 pages** in `apps/web/src/pages/*.tsx` (representative routes above; see README structure + `docs/seo.md` index map for the complete list). Canonical roles are `STUDENT` / `TEACHER` / `COLLEGE_ADMIN` / `SUPER_ADMIN` (no `FACULTY`). Database is **Postgres-only** (Neon pooled `DATABASE_URL` + direct `DIRECT_URL`); local `dev.db`/SQLite is not supported.

## Backend Domains (29 route modules)

| Prefix (mounted in `src/index.ts`) | File | Domain |
|---|---|---|
| `/api/auth` | `auth.ts` | Login / register (Zod, rate-limited) |
| `/api/colleges/*` | `colleges.ts` | Public college register / list / departments |
| `/api/user` | `user.ts` | Current-user profile (+ `DELETE /user/me` erasure plan, see `docs/privacy.md`) |
| `/api/admin` | `admin.ts` | Users / colleges / dashboard / super-admin ops |
| `/api/departments` | `departments.ts` | Department CRUD (`?collegeId=`) |
| `/api/hackathons` | `hackathons.ts` | Approved list/detail + staging review |
| `/api/internships` | `internships.ts` | Same staging pattern as hackathons |
| `/api/fetch` | `fetch.ts` | Platform fetch / enrich / cleanup / settings |
| `/api/contests` | `contests.ts` | Coding contests |
| `/api/coding-profile` | `codingProfile.ts` | Handles + stats + sync |
| `/api/assignments` | `assignments.ts` | Legacy assignments (deprecated, compat only) |
| `/api/assignments/hub` | `assignmentHub.ts` | AssignmentHub CRUD |
| `/api/assignments` (submissions) | `assignmentSubmissions.ts` | Submissions / grading / stats |
| `/api/forms` | `forms.ts` | Forms + fields + responses + room shares |
| `/api/rooms` | `rooms.ts` | Rooms + members + messages + resources + uploads |
| `/api/schedules` | `schedules.ts` | Schedules |
| `/api/timetable` | `timetable.ts` | Timetable |
| `/api/tasks` | `tasks.ts` | Planner tasks |
| `/api/attendance` | `attendance.ts` | Attendance |
| `/api/grades` | `grades.ts` | Grades / courses / enrollments |
| `/api/announcements` | `announcements.ts` | Announcements + targeting + reads |
| `/api/notifications` | `notifications.ts` | Notifications |
| `/api/chat` | `chat.ts` | Chat REST (realtime over Socket.IO) |
| `/api/search` | `search.ts` | Global search |
| `/api/ai` | `ai.ts` | AI chat / insights |
| `/api/ai-manager` | `ai-manager.ts` | Provider / routing admin (`SUPER_ADMIN` only) |
| `/api/resume` | `resume.ts` | Resume build / export |
| `/api/reports` | `reports.ts` | Issue reports |
| `/api/u`, `/api/users/u` | `publicProfile.ts` | Public profiles (email masked for anon, see `docs/privacy.md`) |
| `/internal/cron/*` | `internalCron.ts` | Cron jobs (`x-cron-secret`, fails closed 503) |

> Count verified 2026-09-09: `packages/backend/src/routes/*.ts` = **30 files**. `packages/backend/src/services/*.ts` = **14 top-level modules** (+ `opportunities/`/`sources/`/`fetch/`/`room/`/`hackathon/` submodules, see Services below). `apps/web/src/pages/*.tsx` = **55 pages**. `prisma/schema.prisma` = **50 models**.

## Services (14 top-level modules in `src/services/` + submodules)

### opportunityAgent.ts
Core service for opportunity management:
- `fetchFromPlatform(platform, limit?)` — Scrape a platform
- `fetchFromAllSources()` — Scrape all platforms
- `enrichHackathonStaging(id)` — AI-enrich a hackathon
- `enrichInternshipStaging(id)` — AI-enrich an internship

### contestFetcher.ts
Coding contest management:
- `fetchAndStoreContests()` — Fetch from LeetCode, CodeChef, etc.
- `fetchYouTubeSolutions()` — Find YouTube solutions for contests

### syncEngine.ts
Coding profile synchronization:
- `syncAllUsers()` — Sync all user coding profiles

### socket.ts
Real-time communication:
- WebSocket server for chat and notifications

### notificationService.ts
Fan-out notifications (createMany + queue; see privacy retention notes).

### resumePdf.ts / resumeDocx.ts / resumeLatex.ts / resumeConvert.ts
Resume build/export pipeline (backend-authoritative; FE is preview-only).

### platformFetchers.ts / platformStats.ts
Per-platform coding-profile fetchers + aggregated stats (central TTL + SWR).

### githubActivity.ts
GitHub contribution calendar lookup for public profiles.

### ai-manager.ts
Per-college AI provider routing + encrypted key management.

## Middleware

### auth.ts
- `authenticate` — Verifies JWT token, attaches user to request
- `authorize(roles)` — Checks user role against allowed roles (`STUDENT` / `TEACHER` / `COLLEGE_ADMIN` / `SUPER_ADMIN`)

### requestId.ts
- `requestId` — Assigns/propagates `X-Request-Id` (UUID) on every request/response for log correlation.

### logger.ts
- `pino` structured logger (JSON in production, pretty in dev). Hot paths (`index.ts`, `errorHandler`, `auth`) log via `logger` with `requestId`; never log PII/secrets.

### errorHandler.ts
- Global error handler with consistent JSON responses (`{ error, code }`; detail server-only in prod).

### etagCache.ts
- Weak ETag + `Cache-Control: private` on authenticated JSON (never `public` + `s-maxage` for auth data).

## Key Design Decisions

### Staging Pattern
Opportunities go through a staging pipeline before being published. This ensures:
1. No raw scraped data reaches students
2. Admin has full control over what's published
3. AI enrichment adds structured data (departments, deadlines)

### Platform-Based Card Colors
Each platform has a distinct color in the admin UI:
- Devfolio: Green (`#00A88F`)
- Devpost: Orange (`#F5A623`)
- MLH: Red (`#F07068`)
- Unstop: Purple (`#635BFF`)
- Internshala: Blue (`#3B82F6`)

### Dark Mode Implementation
- CSS class-based (`dark` class on `<html>`)
- Inline script in `index.html` prevents flash
- `useLayoutEffect` in ThemeContext for instant apply
- All colors use CSS custom properties via Tailwind

### AssignmentHub Scoping & Visibility
AssignmentHub replaces single-user assignments with college-scoped targets:
- Scope `ALL` visible to entire college, `DEPARTMENT` filtered by `departmentId`, `ROOM` via `RoomMember`.
- Submission modes `ONLINE` (requires file/text), `OFFLINE` (requires confirmation, forbids files), `HYBRID` (either).
- Teacher visibility toggles `showGrades/showFeedback/showSubmissionStatus/showStats` gate student reads; teacher always sees raw data. Stats endpoint respects `showStats` for students.
- Legacy `Assignment` retained for backward compat (deprecated).
- Pagination `page/limit` with ETag `Cache-Control: public, max-age=15, stale-while-revalidate=30` on list endpoints.

### Limit-Aware Scraping
When a user sets limit=1 for a platform:
1. Scraper stops fetching pages after getting enough items
2. Only the requested number of items are saved
3. Enrichment only processes those items
4. No wasted network requests

### CommandPalette (`Ctrl+K`)
- Global fuzzy finder in `apps/web/src/components/CommandPalette.tsx` (see `docs/changes/CommandPalette.md`).
- Decision: single client-side index over routes + recent items; no server round-trip (keeps <100ms open). Future: scope results by role/college via `deriveCollegeId`.

### ThemeToggle
- Single source of truth: `ThemeContext` + `apps/web/src/components/ThemeToggle.tsx` (`ThemeToggle.css` for switch animation).
- Decision: CSS `dark` class on `<html>` + FOUC guard inline in `index.html` + `useLayoutEffect` apply. Do NOT add a second Zustand theme key (see CQ-11: two-theme SSOT violation).

### CSP / Security Headers (nginx + helmet)
- Decision: hardened CSP — `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://res.cloudinary.com; object-src 'none'; base-uri 'self'; frame-ancestors 'deny'; upgrade-insecure-requests` + `Permissions-Policy`.
- Rationale: removes `unsafe-eval` (blocks pdfjs RCE class), removes deprecated `X-XSS-Protection`, only enables HSTS on HTTPS (port 443, not `:80`), `Cache-Control: private` on auth JSON, CORS allowlist deny → `403` (not `500`). See `docs/seo.md` + security audit.

### SEO Strategy
- Decision: per-route `react-helmet` titles/meta + OG/Twitter + canonical, `robots.txt` (allow public, disallow `/u/*` + authed), `sitemap.xml` (public routes only, no PII URLs), `noindex` on `/u/*` public profiles until email-mask + tenant gate land.
- Rationale: current `index.html` is a single title with no meta/OG/canonical/JSON-LD (SEO 3.2/10). See `docs/seo.md` index map for the 10 smoke paths and index/noindex matrix.
