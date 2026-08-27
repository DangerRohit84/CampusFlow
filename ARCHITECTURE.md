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
│  │ (35)     │ │  (19)    │ │    (Zustand)     │  │
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
│  │  │ (18)    │ │  (5)     │ │  (auth,err)  │ │  │
│  │  └────┬────┘ └────┬─────┘ └──────────────┘ │  │
│  │       └───────────┼─────────────────────────┘  │
│  │                   │                            │
│  │           ┌───────┴───────┐                    │
│  │           │  Prisma ORM   │                    │
│  │           └───────┬───────┘                    │
│  └───────────────────┼────────────────────────────┘
│                      │
│              ┌───────┴───────┐
│              │   SQLite /     │
│              │  PostgreSQL    │
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

### Faculty
- `/assigned` — Assigned courses
- `/forms` — Form management
- `/rooms` — Room management

### Admin
- `/admin` — Admin panel (college selection for super admin)
- `/admin/opportunities` — Review hackathons/internships
- `/admin/fetch` — Fetch data from platforms (super admin only)

## Services

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

## Middleware

### auth.ts
- `authenticate` — Verifies JWT token, attaches user to request
- `authorize(roles)` — Checks user role against allowed roles

### errorHandler.ts
- Global error handler with consistent JSON responses

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

### Limit-Aware Scraping
When a user sets limit=1 for a platform:
1. Scraper stops fetching pages after getting enough items
2. Only the requested number of items are saved
3. Enrichment only processes those items
4. No wasted network requests
