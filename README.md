# CampusFlow 🎓

> A full-stack, multi-tenant campus operating system — academics, opportunities, coding growth, collaboration, and AI insights in one monorepo.

[![Monorepo](https://img.shields.io/badge/monorepo-turborepo-blue)](./turbo.json)
[![Frontend](https://img.shields.io/badge/web-react%2018%20%2B%20vite%20%2B%20ts-61dafb)](./apps/web/package.json)
[![Backend](https://img.shields.io/badge/api-express%20%2B%20prisma%20%2B%20postgres-green)](./packages/backend/package.json)
[![Database](https://img.shields.io/badge/db-postgresql%20%2F%20neon-336791)](./packages/backend/prisma/schema.prisma)
[![Realtime](https://img.shields.io/badge/realtime-socket.io-black)](./packages/backend/src/services/socket.ts)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#-license)

---

## 📖 Overview

**CampusFlow** is a multi-tenant campus platform built as a Turborepo monorepo.

- **Who it serves:** Students, Teachers, College Admins, and Super Admins (platform owners).
- **Tenant isolation:** every record is scoped by `collegeId`. `SUPER_ADMIN` is global (`collegeId = null`) and selects a college context explicitly.
- **What it does:** combines academic operations (assignments, attendance, grades, timetable, rooms, announcements, forms, tasks, calendar) with career growth (hackathons, internships, coding contests, profiles, leaderboard, resume + portfolio studio) plus realtime chat/notifications and AI assistance.

> Status: active development. Web + API are production-shaped (Render + Neon + Cloudinary + cron). Mobile (Expo) is a skeleton. Backend has a hermetic vitest suite (see `packages/backend/tests/`) + supertest API-contract test — see [Roadmap](#-roadmap--known-gaps).

---

## ✨ Key Highlights

- 🏫 **Multi-tenancy by design** — `College → Department → User/Room/Opportunity` isolation enforced in queries and middleware.
- 🔄 **Opportunity pipeline** — Fetch → Stage → AI-enrich → Admin review → Publish for hackathons/internships.
- 🤖 **AI layer** — Groq / OpenAI-compatible + Anthropic + Gemini SDKs wired; `AiProvider` + `AiRouting` models with per-college routing and encrypted keys (`AiManager`).
- 💻 **Coding growth** — Contest aggregation + per-user profile sync (LeetCode, Codeforces, CodeChef, HackerRank, GFG) + leaderboard + participation history.
- 📝 **AssignmentHub** — College-scoped assignments (`ALL` / `DEPARTMENT` / `ROOM`), `ONLINE` / `OFFLINE` / `HYBRID` modes, visibility gates (`showGrades`, `showFeedback`, `showSubmissionStatus`, `showStats`).
- 💬 **Realtime** — Socket.IO for chat, room messages, and notifications.
- 📦 **File handling** — Cloudinary in production, local `uploads/` fallback in dev; forced-download headers for active-content extensions.
- ⚙️ **Ops-ready** — `render.yaml` blueprint, multi-stage `Dockerfile`, `docker-compose.yml`, health checks, rate limits, ETag + compression middleware, embedded cron (dev) / Render Cron Jobs (prod).

---

## 🧰 Tech Stack

| Layer | Technology | Source |
|---|---|---|
| Monorepo | Turborepo `^2.3.0`, npm workspaces (`apps/*`, `packages/*`), `npm@10` | `package.json`, `turbo.json` |
| Web | React `18.3.1`, Vite `6`, TypeScript `5.6`, Tailwind `3.4`, Framer Motion `11`, Zustand `5`, React Router `6.28`, TanStack Query `5`, Axios, `socket.io-client` | `apps/web/package.json` |
| Web extras | `lucide-react`, `date-fns`, `@dnd-kit`, `react-hot-toast`, `dompurify`, `docx`, `jspdf`, `html-to-image`, `mammoth`, `pdfjs-dist`, `tesseract.js` | `apps/web/package.json` |
| API | Node `20` (Docker `node:20-alpine`), Express `4.21`, TypeScript `5.6`, `tsx` dev runner | `packages/backend/package.json`, `Dockerfile` |
| Data | Prisma `6`, PostgreSQL (Neon; pooled `DATABASE_URL` + direct `DIRECT_URL`), Zod validation | `prisma/schema.prisma`, `.env.example` |
| Auth/Security | JWT (`jsonwebtoken`), `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `compression`, ETag cache middleware | `src/index.ts`, `src/middleware/` |
| Realtime | `socket.io` server + client | `src/services/socket.ts` |
| AI | `groq-sdk`, `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `node-cache` (6h scrape cache), DuckDuckGo fallback | `package.json`, `src/services/opportunityAgent.ts`, `src/ai/` |
| Storage/Media | `cloudinary`, `multer`, `sharp`, `canvas`, `pdf-parse`, `pdfkit`, `pdfjs-dist`, `docx`, `mammoth`, `exceljs`, `chrono-node` | `packages/backend/package.json` |
| Jobs | `node-cron` (dev embedded) + Render Cron Jobs (prod `/internal/cron/*`) | `src/routes/internalCron.ts`, `render.yaml` |
| Mobile | Expo `~52`, React Native `0.76`, React Navigation `7`, Zustand, Axios (skeleton) | `apps/mobile/package.json` |
| Deploy | Render Blueprint, Docker, Nginx (frontend static), Neon Postgres | `render.yaml`, `Dockerfile`, `docker-compose.yml`, `nginx.conf` |

---

## 🗂️ Monorepo Structure

```text
CampusFlow/
├── apps/
│   ├── web/                  # React 18 + Vite + TS + Tailwind frontend (:3000)
│   │   ├── src/
│   │   │   ├── pages/        # 55 pages (Dashboard, Hackathons, Internships,
│   │   │   │               # Contests, Leaderboard, Rooms, AssignmentHub,
│   │   │   │               # Resume/Portfolio Studio, Admin, SuperAdmin, …)
│   │   │   ├── components/   # UI / layout / shared / fetch components
│   │   │   ├── hooks/        # Custom React hooks
│   │   │   ├── store/        # Zustand stores (auth, app)
│   │   │   ├── context/      # Theme context
│   │   │   ├── lib/          # Axios API client + utilities
│   │   │   └── types/        # Shared TS types
│   │   ├── public/
│   │   ├── vite.config.ts    # Alias @, vendor/query/ui chunk splitting
│   │   └── tailwind.config.js
│   └── mobile/               # Expo skeleton (start/android/ios/web)
├── packages/
│   └── backend/              # Express + Prisma API (:4000)
│       ├── src/
 │       │   ├── routes/       # 30 route modules (see API overview)
│       │   ├── services/     # opportunityAgent, contestFetcher, syncEngine,
│       │   │               # socket, notificationService, resume*, githubActivity
│       │   ├── ai/           # groq.ts, client.ts (+ provider routing)
│       │   ├── middleware/   # auth (authenticate/authorize), errorHandler, etagCache
│       │   ├── config/       # config, db (retry), storage (local/cloudinary)
│       │   └── utils/        # date, search helpers
 │       └── prisma/
 │           ├── schema.prisma # PostgreSQL, 50 models (see below)
│           ├── migrations/   # Baseline 00000000000000_init (+ history)
│           └── seed.ts       # Demo seed (skipped in prod unless SEED_DEMO_USERS=true)
├── docs/                     # Additional documentation
├── turbo.json                # build/dev/lint/clean tasks
├── render.yaml               # Render web + 4 cron + keepalive services
├── docker-compose.yml        # db + backend + frontend (nginx)
├── Dockerfile                # Multi-stage Node 20 builder → runner
├── nginx.conf                # Frontend static serving
 ├── ARCHITECTURE.md           # System + data-flow deep dive
 └── README.md                   # This file
 ```

> Counts verified 2026-09-09: `src/routes/` has 30 files, `src/services/` has 14 top-level modules (+ `opportunities/`/`sources/`/`fetch/`/`room/`/`hackathon/` submodules), `src/pages/` has 55 pages, `prisma/schema.prisma` defines 50 models.

---

## 🚀 Features by Module

### 🔐 Auth, Colleges & Departments
- JWT login/register, role-aware guards (`authenticate`, `authorize(roles)`).
- Public college registration (`POST /api/colleges/register`), approved-college dropdown (`GET /api/colleges/list` + legacy alias `/api/colleges/public`), per-college departments (`GET /api/colleges/:id/departments`).
- User profile (`/api/user/profile` GET/PUT), admin user CRUD (`/api/admin/users`), department CRUD (`/api/departments`).
- Frontend: `Login`, `Register`, `CollegeRegistration`, `Settings`, `Admin`, `SuperAdmin*` pages.

### 📊 Dashboard, Search, Notifications, Chat & AI
- Role-adaptive dashboard with realtime stats.
- Global search (`/api/search`), notifications CRUD (`/api/notifications`), tasks/planner (`/api/tasks`), schedules/timetable/calendar (`/api/schedules`, `/api/timetable`).
- Chat: REST + Socket.IO (`/api/chat`, `WS`), room chat with replies/reactions/hides, `RoomRead` receipts, `chatMode` (`EVERYONE` gated via `RoomChatAllowedMember`).
- AI: chat/insights endpoints (`/api/ai`), sessions/messages (`ChatSession`/`ChatMessage`), `AiManager` UI + `/api/ai-manager` (SUPER_ADMIN-only provider/route management).

### 🏆 Hackathons + 💼 Internships Pipeline
- Sources: **Devfolio, Devpost, MLH, Unstop, Internshala, Hack2Skill** (see `opportunityAgent.ts`).
- Flow:
  1. **Fetch** — scrape/parse, per-platform limits, limit-aware paging, `node-cache` 6h TTL.
  2. **Stage** — dedup by title+source into `HackathonStaging` / `InternshipStaging` (`DRAFT`/`PENDING`).
  3. **Enrich** — detail scrape + AI (departments, deadlines, prizes, eligibility), near-deadline priority, DuckDuckGo fallback, auto-reject past-deadline.
  4. **Review** — admin approve/reject (`/staging/:id/approve`, `/staging/:id/reject`), counts (`/staging/counts`).
  5. **Publish** — approved rows move to `Hackathon` / `Internship`; rejected rows auto-deleted after 30 days (weekly cron).
- Fetch API (mounted at `/api/fetch`): `POST /all`, `POST /:platform`, `POST /hackathons/enrich`, `POST /internships/enrich`, `POST /cleanup`, `POST /other/hackathons`, `POST /other/internships`, `POST /custom`, `GET /stats`, `GET /:platform/hackathons`, `GET /:platform/internships`, `PUT /:platform/limit`, `PUT /settings`, `GET /settings/all`.
- Registrations + rounds: `HackathonRegistration`, `HackathonRound`, `InternshipRegistration`.

### 💻 Coding Contests, Profiles & Leaderboard
- Aggregation via `contestFetcher.ts` + per-platform fetchers (`platformFetchers.ts`): **LeetCode, Codeforces, CodeChef, HackerRank, GFG**.
- `CodingContest` store (`/api/contests`), per-user `CodingProfile` (`/api/coding-profile`), `ContestParticipation` history, `syncEngine.ts` hourly sync (per-user 1h throttle), YouTube solutions lookup.
- Frontend: `CodingContests`, `CodingProfile`, `ContestLeaderboard` pages.

### 📝 AssignmentHub (scoped assignments)
- Replaces legacy single-user `Assignment` (kept deprecated for compat).
- Scope `ALL` (college) / `DEPARTMENT` (`departmentId`) / `ROOM` (`RoomMember`).
- Modes `ONLINE` (file/text required) / `OFFLINE` (confirmation, no files) / `HYBRID`.
- Visibility gates: `showGrades` / `showFeedback` / `showSubmissionStatus` / `showStats` (teachers see raw data; students gated).
- Pagination `page/limit` + ETag `Cache-Control: public, max-age=15, stale-while-revalidate=30` on lists.
- Routes: `/api/assignments/hub` CRUD + `/:id/submissions`, `/api/assignments/*` submissions/grading/stats (see `assignmentHub.ts`, `assignmentSubmissions.ts`).

### 🏠 Rooms — Chat + Resources
- `Room` (joinCode, `teacherId`, optional `departmentId`), `RoomMember` (incl. `isCR`), messages with files/replies/reactions, `Resource` library (PDF/PPT/link), `RoomNotification`, `FormRoom` linkage.
- Cloudinary CDN URLs in prod; local `/uploads` static in dev with forced-download for risky extensions.
- Frontend: `Rooms`, `RoomDetail`, `StudentRooms`, `StudentRoomDetail` pages.

### 📋 Forms, 📢 Announcements, ✅ Tasks/Planner, 🗓️ Timetable/Schedule/Calendar
- Forms: builder (`FormField`), targeting (`targetDepartments`, `targetYears`), expiry, `FormResponse` (unique per user), room sharing.
- Announcements: `ALL_DEPARTMENTS` / `SPECIFIC_DEPARTMENTS` × `ALL_COLLEGES` / `SPECIFIC_COLLEGES` / `MY_COLLEGES`, scheduling (`publishAt`/`expiresAt`), reads tracking.
- Tasks: personal/academic planner with categories, priorities, recurrence, class linkage.
- Schedules/Timetable: recurring weekly classes (`dayOfWeek`, `startTime`/`endTime`), teacher/location metadata.

### 🧑‍🏫 Attendance, Grades & Reports
- `AttendanceData` (per-student subjects JSON + `requiredPct` default 75), `Grade` + `GradeData` (subjects JSON, 10-point scale default), `Course` + `Enrollment`.
- `Report` issue tracker (`WEBSITE`/`COLLEGE` scope; `DESIGN`/`BUG`/`CRASH`/`PERFORMANCE`/`SECURITY`/`FEATURE_REQUEST`/`OTHER`; `LOW`–`CRITICAL`; `OPEN`/`IN_PROGRESS`/`RESOLVED`/`CLOSED`) at `/api/reports`.

### 📄 Resume Studio + Portfolio
- Resume builder with multi-format export: PDF (`resumePdf.ts` + `pdfkit`), DOCX (`resumeDocx.ts`), LaTeX (`resumeLatex.ts`, local `pdflatex` if available else `latexonline.cc` fallback + `pdfkit`), converters (`resumeConvert.ts`).
- TeX Live install attempted in `render.yaml` build; graceful fallback documented in code.
- Portfolio Studio + public profiles (`/api/u/*`, alias `/api/users/u/*`).

### 🎨 UI/UX
- Full dark mode (class-based `dark` on `<html>`, FOUC guard in `index.html`, CSS vars via Tailwind), custom teal/ink palette.
- Responsive mobile-first, command palette (`Ctrl+K`), animated theme toggle, platform-colored opportunity cards.
- Data fetching with TanStack Query + Axios client, Zustand auth/app stores.

---

## 🏗️ Architecture & Data Flow

High-level request path:

```text
React (Vite) ──Axios/JWT──▶ Express Router ─▶ Services ─▶ Prisma ─▶ Postgres (Neon)
     ▲                         │  ├─ opportunityAgent / contestFetcher / syncEngine
     │                         │  ├─ socket.io (chat + notifications)
     └────── Socket.IO ────────┘  └─ AI clients (Groq/OpenAI/Anthropic/Gemini via AiRouting)
```

Middleware order in `src/index.ts`: `compression` → `helmet` → `etagCache` → `CORS (FRONTEND_URL allowlist)` → `express.json ({limit 10mb, strict false})` → null-body normalizer → `urlencoded` → static `/uploads` (local mode only) → rate limiters (`general 500/15m`, `auth 10/15m`, `cron 10/h`, college-register `5/h`) → routes → 404 → `errorHandler`.

Opportunity lifecycle (see `ARCHITECTURE.md`):

```text
External (Devfolio/Devpost/MLH/Unstop/Internshala/Hack2Skill)
  │ 1. FETCH (scrape + normalize → NormalizedOpportunity in-memory)
  ▼
Staging (HackathonStaging/InternshipStaging, DRAFT)
  │ 2. SAVE (dedup title+source)  3. ENRICH (detail scrape + AI + search fallback)
  ▼
Staging (enriched: targetDepartments, deadlines, prizes)
  │ 4. REVIEW (approve → publish / reject → 30-day auto-delete)
  ▼
Final (Hackathon/Internship, visible to students)
```

AssignmentHub visibility, dark-mode strategy, platform card colors, and limit-aware scraping are documented in `ARCHITECTURE.md` — read it alongside this README.

---

## 🔌 API Surface Overview

Base URL (dev): `http://localhost:4000`. Health: `GET /api/health` (returns `status`, `db`, `version`, feature list).

Mounted routers in `src/index.ts` (methods vary per resource; see `ARCHITECTURE.md` + route files for exact verbs):

| Prefix | Domain |
|---|---|
| `/api/auth` | Login / register (rate-limited) |
| `/api/colleges/register`, `/api/colleges/list`, `/api/colleges/public`, `/api/colleges/:id/departments` | Public college flows (register rate-limited 5/h) |
| `/api/user` | Current-user profile |
| `/api/admin` | Users/colleges/dashboard/super-admin ops |
| `/api/departments` | Department CRUD (`?collegeId=`) |
| `/api/hackathons` | Approved list/detail + staging review (`/staging`, `/staging/counts`, `/:id/approve`, `/:id/reject`) |
| `/api/internships` | Same staging pattern as hackathons |
| `/api/fetch` | Platform fetch/enrich/cleanup/settings (see Features) |
| `/api/contests` | Coding contests |
| `/api/coding-profile` | Handles + stats + sync |
| `/api/assignments`, `/api/assignments/hub` | Legacy + AssignmentHub + submissions/grading/stats |
| `/api/forms` | Forms + fields + responses + room shares |
| `/api/rooms` | Rooms + members + messages + resources + uploads |
| `/api/schedules`, `/api/timetable` | Schedules / timetable |
| `/api/tasks` | Planner tasks |
| `/api/attendance`, `/api/grades` | Attendance + grades/courses/enrollments |
| `/api/announcements` | Announcements + targeting + reads |
| `/api/notifications` | Notifications |
| `/api/chat` | Chat REST (realtime over Socket.IO) |
| `/api/search` | Global search |
| `/api/ai`, `/api/ai-manager` | AI chat/insights; provider/routing admin (SUPER_ADMIN) |
| `/api/resume` | Resume build/export |
| `/api/reports` | Issue reports |
| `/api/u`, `/api/users/u` | Public profiles |
| `/internal/cron/contests`, `/profile-sync`, `/opportunities`, `/cleanup` | Cron jobs (`x-cron-secret` required, fails closed 503 if unset) |

> No endpoints invented here — verify verbs/schemas in `packages/backend/src/routes/*.ts`. `ARCHITECTURE.md` lists representative methods for auth/admin/departments/hackathons/internships/fetch/assignments.

---

## 🗄️ Database Models Overview

Provider `postgresql`. Datasource uses `DATABASE_URL` (Neon pooled, `-pooler` + `pgbouncer=true`) and `directUrl = DIRECT_URL` (Neon direct, no pooler) for migrations. File: `packages/backend/prisma/schema.prisma`.

| Group | Models |
|---|---|
| Identity & tenancy | `User` (roles `STUDENT`/`TEACHER`/`COLLEGE_ADMIN`/`SUPER_ADMIN`, `collegeId`, `departmentId`), `College`, `Department`, `UserIntegration` |
| Opportunities | `Hackathon`, `HackathonRegistration`, `HackathonRound`, `HackathonStaging`, `Internship`, `InternshipRegistration`, `InternshipStaging`, `PlatformSettings` |
| Coding | `CodingContest`, `CodingProfile`, `ContestParticipation` |
| Academics | `Assignment` (legacy, deprecated), `AssignmentHub`, `AssignmentSubmission`, `Course`, `Enrollment`, `Grade`, `GradeData`, `AttendanceData`, `Schedule`, `Task` |
| Collaboration | `Room`, `RoomMember`, `RoomMessage`, `MessageHide`, `MessageReaction`, `RoomChatAllowedMember`, `Resource`, `RoomNotification`, `RoomRead`, `Form`, `FormField`, `FormResponse`, `FormRoom` |
| Comms | `Notification`, `Announcement`, `AnnouncementDepartment`, `AnnouncementCollege`, `AnnouncementRead`, `ChatSession`, `ChatMessage` |
| AI & ops | `AiProvider`, `AiRouting`, `Report` |

Key indexes: `(collegeId, status, createdAt)` on opportunities/forms/contests, `(collegeId, role)` on users, `(roomId, createdAt)` on messages, unique guards (`[formId,userId]`, `[roomId,studentId]`, `[assignmentId,studentId]`, `[platform,type]` on settings).

---

## 👋 Getting Started

### Prerequisites

- **Node.js `20 LTS`** (Docker uses `node:20-alpine`; repo `packageManager` is `npm@10`). Node 18+ may work, but use 20 to match prod.
- **npm 10**, **Git**, **Docker + Compose** (optional, for full-stack local).
- **PostgreSQL** — local via Docker **or** Neon (recommended; required for prod parity).
- Optional: **Groq / OpenAI / Anthropic / Gemini** keys for AI + enrichment; **Cloudinary** account for uploads.

### 1) Install

```bash
git clone <repo-url>
cd CampusFlow
npm install
```

### 2) Environment

```bash
cp packages/backend/.env.example packages/backend/.env
# Edit packages/backend/.env with your values
```

Required variables (see `packages/backend/.env.example`):

```env
# Neon Postgres — BOTH required
DATABASE_URL="postgresql://USER:PASSWORD@ep-example-pooler.../campusflow?sslmode=require&channel_binding=prefer&connect_timeout=30&pgbouncer=true&connection_limit=20&pool_timeout=30"
DIRECT_URL="postgresql://USER:PASSWORD@ep-example.../campusflow?sslmode=require&channel_binding=prefer&connect_timeout=30"

# Auth / server / frontend
JWT_SECRET="your-secret-key-here"
JWT_EXPIRES_IN="7d"
PORT="4000"
FRONTEND_URL="http://localhost:3000"
NODE_ENV="development"

# AI (at least one for enrichment/insights)
GROQ_API_KEY="your-groq-api-key-here"
OPENAI_API_KEY="your-openai-api-key-here"
AI_ENCRYPTION_KEY="your-secret-encryption-key-at-least-32-chars"

# Cron (required — endpoints fail closed 503 when unset, even locally)
CRON_SECRET="your-cron-secret-here"
DISABLE_EMBEDDED_CRON="false"

# Cloudinary (optional locally; required in prod — else local uploads/ is used)
CLOUDINARY_CLOUD_NAME="your-cloud-name-here"
CLOUDINARY_API_KEY="your-api-key-here"
CLOUDINARY_API_SECRET="your-api-secret-here"
```

> Local Postgres via Compose uses `postgresql://campusflow:campusflow@localhost:5432/campusflow` — set both `DATABASE_URL` and `DIRECT_URL` to it if you skip Neon locally.

### 3) Database — generate, migrate, seed

```bash
cd packages/backend
npx prisma generate
npx prisma migrate deploy   # prod-like; or: npx prisma db push (dev sync)
npm run db:seed             # demo data; skipped in NODE_ENV=production unless SEED_DEMO_USERS=true
```

### 4) Develop

```bash
# From repo root — runs all dev servers via Turborepo
npm run dev

# Or per-package:
npm run dev -w @campusflow/backend   # tsx watch src/index.ts → :4000
npm run dev -w @campusflow/web       # vite → :3000
```

Open `http://localhost:3000` (web) and `http://localhost:4000/api/health` (API).

### 5) Build / Lint / Clean

```bash
npm run build   # turbo build (web: tsc -b && vite build; api: tsc)
npm run lint    # turbo lint (web: eslint .)
npm run clean   # turbo clean

# Per-package equivalents:
npm run build -w @campusflow/web
npm run build -w packages/backend   # note: workspace name is @campusflow/backend
```

### 6) Docker (full stack)

```bash
# Requires built web assets for nginx service:
npm run build -w @campusflow/web

# Then:
docker compose up --build
# db       → 127.0.0.1:5432 (postgres:16-alpine, healthy-gated)
# backend  → :4000 (/api/health gated)
# frontend → :3000 (nginx serving apps/web/dist)
```

Set `JWT_SECRET` (and optionally `GROQ_API_KEY`) in your shell or `.env` before compose — they are interpolated in `docker-compose.yml`.

---

## ☁️ Deployment

### Render + Neon (primary path — `render.yaml`)

- **Web service `campusflow-api`** (Node):
  - Build: `npm install --include=dev && prisma generate && npm run build -w packages/backend` (+ best-effort TeX Live for local `pdflatex`).
  - Pre-deploy: `prisma migrate deploy`.
  - Start: `node packages/backend/dist/index.js`. Health: `/api/health`.
  - Env: `DATABASE_URL` (pooled, `-pooler` + `pgbouncer=true&connection_limit=20&pool_timeout=30`), `DIRECT_URL` (direct, no pooler), `JWT_SECRET` + `CRON_SECRET` (generated), `DISABLE_EMBEDDED_CRON=true`, `NODE_ENV=production`, `FRONTEND_URL`, Cloudinary trio (`sync: false` — set in dashboard).
- **Cron services** (all `curl` the web service with `x-cron-secret: $CRON_SECRET`):

| Service | Schedule | Endpoint |
|---|---|---|
| `campusflow-cron-contests` | `0 */6 * * *` | `POST /internal/cron/contests` |
| `campusflow-cron-profile-sync` | `0 * * * *` | `POST /internal/cron/profile-sync` |
| `campusflow-cron-opportunities` | `0 */12 * * *` | `POST /internal/cron/opportunities` |
| `campusflow-cron-cleanup` | `0 3 * * 0` (Sun) | `POST /internal/cron/cleanup` |
| `campusflow-keepalive` | `*/5 * * * *` | `GET /api/health` |

> Replace the `https://campusflow-api.onrender.com` placeholder in cron commands with your actual service URL. Each cron service needs the same `CRON_SECRET` as web.

### Cost options (from prior README, still valid)

- **Option A — $0/mo:** deploy only web; leave `DISABLE_EMBEDDED_CRON` unset so in-process schedules run. Trade-off: free-instance sleep (15-min spin-down), schedule drift, cold-start fetches, notifications stall while idle.
- **Option B — ~$11/mo:** always-on Starter web ($7) + 4 cron jobs (~$1 each). Reliable schedules + realtime.
- **Recommendation:** start with A; move to B with real users.

### Neon Postgres

1. Create a Neon project; copy **pooled** and **direct** URLs.
2. Pooled URL must contain `-pooler` + `?sslmode=require&pgbouncer=true&connection_limit=20&pool_timeout=30` (+ `channel_binding=prefer&connect_timeout=30` per `.env.example`).
3. Set `DATABASE_URL` (pooled) + `DIRECT_URL` (direct) on Render and locally.

### Cloudinary storage

Render disk is ephemeral — without Cloudinary, `uploads/` is wiped every deploy. When all three `CLOUDINARY_*` vars are set, uploads go to Cloudinary and the CDN URL is persisted; otherwise local disk fallback (fine for dev).

---

## 🔑 Roles & Multi-Tenancy

| Role | Scope | Capabilities |
|---|---|---|
| `STUDENT` | Own college | Browse opportunities/contests, join rooms, submit assignments/forms, track attendance/grades/tasks, chat, build resume/portfolio |
| `TEACHER` | Own college/dept | Create rooms/assignments/forms/announcements, grade, verify offline submissions, manage resources |
| `COLLEGE_ADMIN` | Own college | Manage users/departments, review staging (`approve`/`reject`), publish opportunities, college analytics |
| `SUPER_ADMIN` | Global (`collegeId=null`) | Approve colleges, manage all tenants (via `?collegeId=` / college picker), fetch controls, `AiManager` providers |

Enforcement: `authenticate` (JWT) → `authorize(roles)` → per-query `collegeId` scoping (`SUPER_ADMIN` bypass with explicit target). Public registration validates `collegeId` (must be `APPROVED`, except `COLLEGE_ADMIN` pending-flow) to prevent IDOR.

---

## 🗺️ Roadmap & Known Gaps

- [x] **Tests (hermetic)** — backend vitest suite (`packages/backend/tests/`: validators, pagination, masking, staging, security-all, solid-all, api-health contract) + Playwright smoke (`apps/web/e2e/smoke.spec.ts` with title + key-text + no-500 + noindex asserts). Next: Prisma integration with rollback + full e2e (Playwright) + CI.
- [ ] **Mobile** — Expo app is a skeleton; wire auth/API parity with web.
- [ ] **Docs drift** — `ARCHITECTURE.md` still references `FACULTY`/`SQLite` in places; canonical roles are `STUDENT`/`TEACHER`/`COLLEGE_ADMIN`/`SUPER_ADMIN`, DB is Postgres-only.
- [ ] **API docs** — add OpenAPI/Swagger generated from Zod schemas + route files.
- [ ] **Observability** — structured logging, request IDs, metrics/traces, alerting.
- [ ] **Seed hygiene** — weak-credential demo accounts already gated (`NODE_ENV=production` skip unless `SEED_DEMO_USERS=true`); keep extending.
- [ ] **Accessibility/i18n** — audit contrast/keyboard/screen-reader + multi-language support.

Contributions that close any of the above are especially welcome.

---

## 🤝 Contributing

1. Fork + branch (`feat/<scope>`, `fix/<scope>`).
2. Keep changes small (<200 lines where possible, one logical change).
3. Follow existing style (TS strict, Tailwind, Prisma patterns); explain **why**, not what, in comments.
4. Run before pushing:
   ```bash
   npm run lint
   npm run build
   ```
5. Open a PR with what/why, screenshots for UI, and linked issues.

> No commit hooks configured. Never commit secrets (`.env`, `dev.db`, Cloudinary keys). `packages/backend/uploads/` and `prisma/dev.db` are local-only artifacts.

---

## 📚 Additional Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system diagram, opportunity lifecycle, routes, pages, services, middleware, design decisions.
- [`docs/`](./docs/) — supplementary project documentation.
- [`packages/backend/.env.example`](./packages/backend/.env.example) — canonical env reference.
- [`render.yaml`](./render.yaml) / [`docker-compose.yml`](./docker-compose.yml) / [`Dockerfile`](./Dockerfile) — deploy references.

---

## 📄 License

Private — Alpha Coders. All rights reserved. Contact the organization for licensing inquiries.
