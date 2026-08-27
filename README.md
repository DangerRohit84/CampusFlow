# CampusFlow

A comprehensive campus management platform with AI-powered opportunity discovery, coding contests, hackathons, and internship tracking.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, TypeScript, Tailwind CSS v3.4, Framer Motion, Zustand |
| Backend | Node.js + Express, TypeScript, Prisma ORM |
| Database | SQLite (dev) / PostgreSQL (prod) |
| AI | Groq SDK, OpenAI-compatible API |
| Monorepo | Turborepo |
| Deployment | Vercel (frontend) + Render (backend) |

## Project Structure

```
CampusFlow/
├── apps/
│   ├── web/                    # React frontend (Vite)
│   │   ├── src/
│   │   │   ├── components/     # UI, shared, layout, fetch components
│   │   │   ├── pages/          # 35 page components
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── store/          # Zustand stores (auth, app)
│   │   │   ├── context/        # Theme context
│   │   │   ├── lib/            # API client, utilities
│   │   │   └── types/          # TypeScript type definitions
│   │   ├── public/             # Static assets
│   │   └── tailwind.config.js  # Theme configuration
│   └── mobile/                 # React Native app (Expo)
├── packages/
│   └── backend/                # Express API server
│       ├── src/
│       │   ├── routes/         # 18 API route files
│       │   ├── services/       # Business logic (enrichment, fetch, sync)
│       │   ├── middleware/     # Auth, error handling
│       │   ├── config/         # Database, environment config
│       │   └── utils/          # Date utilities, search
│       └── prisma/
│           ├── schema.prisma   # Database schema
│           └── migrations/     # Database migrations
└── docs/                       # Project documentation
```

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup

```bash
# Clone and install
git clone <repo-url>
cd CampusFlow
npm install

# Set up environment
cp packages/backend/.env.example packages/backend/.env
# Edit .env with your API keys

# Initialize database
cd packages/backend
npx prisma db push
npm run db:seed

# Start development servers
cd ../..
npm run dev
```

### Environment Variables

Create `packages/backend/.env`:

```env
# Database
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/campusflow"

# AI Provider (OpenCode Serve)
OPENCODE_SERVE_URL="http://localhost:8080/v1"

# JWT
JWT_SECRET="your-secret-key"

# Server
PORT=4000
```

## Features

### Core
- **Dashboard** — Real-time stats, role-adaptive UI
- **Hackathons** — Browse, search, filter, detail views
- **Internships** — Browse, search, filter, detail views
- **Coding Contests** — Multi-platform tracking (LeetCode, CodeChef, Codeforces, GFG, HackerRank)
- **Leaderboard** — Gamified rankings
- **Chat** — Real-time messaging

### Admin
- **Admin Panel** — Department, user, and college management
- **Opportunities Review** — Approve/reject hackathons and internships
- **Fetch System** — Auto-fetch from 5 platforms (Devfolio, Devpost, MLH, Unstop, Internshala)
- **Enrichment** — AI-powered data enrichment for opportunities

### UI/UX
- **Dark Mode** — Full dark theme with custom palette
- **Responsive** — Mobile-first design
- **Command Palette** — Keyboard navigation (Ctrl+K)
- **Theme Toggle** — Animated hanging bulb SVG

## Platform Fetch System

### Supported Platforms
| Platform | Type | Source |
|----------|------|--------|
| Devfolio | Hackathons | HTML scraping |
| Devpost | Hackathons | HTML scraping |
| MLH | Hackathons | JSON parsing |
| Unstop | Hackathons | JSON API |
| Internshala | Internships | HTML + JSON-LD |

### How It Works

1. **Fetch** — Scrapes platform pages, extracts opportunity data
2. **Save** — Stores in staging tables (`hackathon_staging`, `internship_staging`)
3. **Enrich** — AI analyzes content, extracts departments, deadlines, prizes
4. **Review** — Admin approves/rejects in the Opportunities page
5. **Publish** — Approved items move to `hackathons`/`internships` tables

### Key Features
- **Per-platform limits** — Control how many items to fetch per platform
- **Limit-aware scraping** — Stops fetching pages once limit is reached
- **In-memory caching** — 6-hour TTL for scraped content (node-cache)
- **Search fallback** — DuckDuckGo search when page content is thin
- **Near-deadline priority** — Enriches items closest to deadline first
- **Auto-reject ended** — Automatically rejects items past their deadline
- **Auto-cleanup** — Deletes rejected items older than 30 days (weekly cron)

### Fetch API

```
POST /api/fetch/all              # Fetch from all platforms
POST /api/fetch/:platform        # Fetch from specific platform
POST /api/fetch/hackathons/enrich  # Enrich pending hackathons
POST /api/fetch/internships/enrich # Enrich pending internships
POST /api/fetch/cleanup           # Delete old rejected items
GET  /api/fetch/settings/all      # Get platform limits
PUT  /api/fetch/:platform/limit   # Update platform limit
```

## Database Schema

### Core Tables
- `users` — User accounts with roles (STUDENT, FACULTY, COLLEGE_ADMIN, SUPER_ADMIN)
- `colleges` — College institutions
- `departments` — Academic departments
- `hackathons` — Approved hackathons (visible to students)
- `internships` — Approved internships (visible to students)

### Staging Tables
- `hackathon_staging` — Pending hackathons awaiting admin review
- `internship_staging` — Pending internships awaiting admin review

### Supporting Tables
- `coding_contests` — Coding contest records
- `coding_profiles` — User coding platform profiles
- `platform_settings` — Per-platform fetch limits
- `forms`, `rooms`, `schedules`, `notifications`, etc.

## Color Theme

### Light Mode
| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#007060` | Buttons, active tabs, approve |
| Surface 100 | `#FEF9F1` | Sidebar background |
| Surface 50 | `#FFFFFF` | Main background |
| Danger | `#F07068` | Reject, delete |
| Warning | `#F5A623` | Alerts, near-deadline |
| Accent | `#635BFF` | Devfolio/Unstop tags |

### Dark Mode
| Token | Hex | Usage |
|-------|-----|-------|
| Main BG | `#080D12` | Page background |
| Sidebar | `#0C1218` | Sidebar background |
| Card BG | `#111920` | Card backgrounds |
| Border | `#202C35` | Borders, dividers |
| Primary | `#00A88F` | Buttons, active elements |
| Text | `#F4F7F8` | Primary text |
| Muted | `#71808C` | Secondary text |

## Scripts

```bash
npm run dev          # Start all dev servers
npm run build        # Build all packages
npm run lint         # Lint all packages
```

## Background Jobs (Render Cron Jobs)

Recurring jobs no longer run inside the API process in production. They are exposed as authenticated HTTP endpoints and triggered by [Render Cron Jobs](https://render.com/docs/cron-jobs):

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `POST /internal/cron/contests` | `0 */6 * * *` | Fetch coding contests from external APIs |
| `POST /internal/cron/profile-sync` | `0 * * * *` | Sync user coding profiles (per-user 1h throttle) |
| `POST /internal/cron/opportunities` | `0 */12 * * *` | Fetch + AI-enrich hackathons/internships |
| `POST /internal/cron/cleanup` | `0 3 * * 0` | Delete rejected staging items older than 30 days |

Every request must send header `x-cron-secret: $CRON_SECRET`. In production, an unset `CRON_SECRET` fails closed with 503.

- **Local dev:** embedded schedules stay enabled by default (`DISABLE_EMBEDDED_CRON` unset).
- **Production:** set `DISABLE_EMBEDDED_CRON=true` on the web service (done automatically by `render.yaml`) and deploy the cron services defined there. Set each cron service's `CRON_SECRET` env var to the same value as the web service's, and replace the `https://campusflow-api.onrender.com` placeholder in the cron commands with your actual service URL.

## Deployment Cost Options

- **Option A - $0/mo:** Deploy only the web service from `render.yaml` (skip the 4 cron services). Leave `DISABLE_EMBEDDED_CRON` unset so embedded schedules run inside the web service. Trade-offs: schedules drift while the free instance sleeps (15-min spin-down), boot-time fetch fires on cold starts, and live notifications break after idle until the next request warms the server.
- **Option B - ~$11/mo:** Starter always-on web service ($7) + the 4 Render Cron Job services (~$1/mo each minimum). No spin-downs, reliable schedules, working real-time notifications.

**Recommendation:** start with Option A for zero cost; move to Option B when you have real users.

## File Storage (Cloudinary)

Uploaded room resources are stored in **Cloudinary** in production — Render's filesystem is ephemeral, so local files would be lost on every deploy. When all three variables below are set on the backend, uploads go to Cloudinary and the returned CDN URL is saved in the database. Without them, the backend falls back to the local `uploads/` folder (fine for development, wiped on every production deploy).

Set these on the Render web service (placeholders are pre-wired with `sync: false` in `render.yaml`):

| Variable | Description |
|----------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Cloud name from the [Cloudinary dashboard](https://cloudinary.com/console) |
| `CLOUDINARY_API_KEY` | API key |
| `CLOUDINARY_API_SECRET` | API secret |

Local development needs no configuration — behavior is unchanged when the variables are unset.

## Database

The backend uses managed **PostgreSQL** (Prisma `postgresql` provider). SQLite was removed because Render's disk is ephemeral — a local `dev.db` would be wiped on every deploy.

We recommend [Neon](https://NEONHOST_REMOVED); the free tier is sufficient for dev and prod.

1. Create a Neon project and copy its connection string.
2. Set it in `packages/backend/.env`:

   ```env
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/campusflow"
   ```

3. Apply migrations:

   ```bash
   cd packages/backend
   npx prisma migrate deploy
   ```

4. Seed the database:

   ```bash
   npm run db:seed
   ```

   Demo data (including weak-credential demo accounts) is skipped automatically when `NODE_ENV=production`; set `SEED_DEMO_USERS=true` to opt in for production demos.

Migration history starts from a single baseline (`prisma/migrations/00000000000000_init`). The old SQLite migration files were removed; `prisma/dev.db` is kept locally for reference only and is no longer used by the app.

## License

Private — Alpha Coders
