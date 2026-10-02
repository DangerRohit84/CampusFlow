// SEO SSOT — pure helpers (no React) so vitest node can import without DOM.
// WHY: Seo.tsx (React wrapper) + sitemap.xml + robots.txt + docs/seo.md must
// agree. This module is the single source: PUBLIC_EXACT (10 indexable paths),
// ROUTE_META (unique title/description/keywords per App.tsx route), canonical
// builder, and JSON-LD factories. Seo.tsx re-exports everything for callers.
export const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://campusflow.dev'
// WHY canonical SSOT: VITE_SITE_URL is the single source of truth for the canonical host
// (Vercel env: Production + Preview). Fallback `https://campusflow.dev` is a placeholder
// only — never leave VITE_SITE_URL unset in prod. Must match index.html canonical/OG,
// public/sitemap.xml locs, public/robots.txt Sitemap, .well-known/security.txt Canonical.

export const APP_NAME = 'CampusFlow'
export const DEFAULT_DESCRIPTION =
  'CampusFlow pins your timetable, rooms, assignments and career boards — live in seconds.'
export const DEFAULT_KEYWORDS =
  'CampusFlow, campus app, college timetable, student assignments, study rooms, hackathons, internships, coding contests'
export const DEFAULT_OG_IMAGE_ALT =
  'CampusFlow — Stop hunting timetables in WhatsApp forwards. Photo in, live board out in 14 seconds.'

export function defaultOgImage(): string {
  return `${SITE_URL}/og-cover.png`
}

// Routes crawlable without auth — everything else gets noindex via RouteSeo.
// WHY CSR: SPA has no SSR — social crawlers read index.html fallback tags + client Helmet on render.
// Prerender/static snapshot note: for full link-preview parity, deploy may prerender the 10 public paths
// below (react-snap / vite-plugin-prerender) and serve snapshots to bots; no framework swap (still Vite SPA,
// index.html fallback + SPA Navigate for /landing→/ covers users).
export const PUBLIC_EXACT: ReadonlySet<string> = new Set([
  '/',
  '/landing', // alias, canonicalizes to / (301). Kept for old links/bookmarks.
  '/login',
  '/register', // self-signup. /register-college is the separate college-intake form (also public).
  '/register-college',
  '/privacy',
  '/terms',
  '/about',
  '/help',
  '/contact',
])

export interface RouteMeta {
  match: (path: string) => boolean
  title: string
  description: string
  keywords: string
  /** Canonical override (redirects: /landing→/, /admin/dashboard→/superadmin). */
  canonicalPath?: string
}

const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(prefix + '/')
const detailOf = (prefix: string) => (p: string) => p.startsWith(prefix + '/')

// WHY order: most-specific first — ROUTE_META.find returns the first match, so
// detail matchers (/forms/:id) must precede their parents (/forms), and admin
// subpages must precede the generic /admin fallback. Every App.tsx route has
// exactly one entry with a UNIQUE title (enforced by seo.test.ts).
export const ROUTE_META: RouteMeta[] = [
  { match: (p) => p === '/' || p === '/landing', title: 'Campus OS for Colleges', description: 'Stop hunting timetables in WhatsApp forwards. CampusFlow pins timetable, rooms, assignments and career boards — live in 14 seconds.', keywords: 'CampusFlow, campus OS, college timetable app, student dashboard', canonicalPath: undefined },
  { match: starts('/login'), title: 'Log in', description: 'Log in to CampusFlow to open your campus board.', keywords: 'CampusFlow login, student login, college portal sign in' },
  { match: (p) => p === '/register' || p.startsWith('/register/'), title: 'Get started free', description: 'Create your free CampusFlow account. No credit card — import your timetable in 14 seconds.', keywords: 'CampusFlow sign up, free student account, college app register' },
  { match: starts('/register-college'), title: 'Register your college', description: 'Onboard your college to CampusFlow — scoped users, departments and boards.', keywords: 'CampusFlow college onboarding, register college, campus OS setup' },
  { match: starts('/privacy'), title: 'Privacy Policy', description: 'How CampusFlow collects, scopes and protects your campus data.', keywords: 'CampusFlow privacy policy, student data protection, campus data privacy' },
  { match: starts('/terms'), title: 'Terms of Service', description: 'The terms governing use of CampusFlow.', keywords: 'CampusFlow terms of service, campus app terms, user agreement' },
  { match: starts('/about'), title: 'About', description: 'CampusFlow is the hallway board for campus — timetable, rooms and career, pinned.', keywords: 'About CampusFlow, campus hallway board, college app mission' },
  { match: starts('/help'), title: 'Help & Support', description: 'Get help with CampusFlow — shortcuts, FAQ answers and how to contact support.', keywords: 'CampusFlow help, campus app support, timetable import guide, FAQ' },
  { match: starts('/contact'), title: 'Contact us', description: 'Contact the CampusFlow team — support, sales and feedback.', keywords: 'Contact CampusFlow, campus app support email, sales feedback' },
  { match: starts('/error'), title: 'Something went wrong', description: 'An unexpected error occurred on CampusFlow. Try again or contact support.', keywords: 'CampusFlow error, campus app troubleshooting, support' },
  { match: (p) => p === '/404', title: 'Page not found', description: 'This CampusFlow page does not exist. Back to your campus board.', keywords: 'CampusFlow, page not found, 404 missing page' },
  { match: (p) => p === '/403', title: 'Access denied', description: 'You do not have access to this CampusFlow page.', keywords: 'CampusFlow access denied, 403 forbidden, role permissions' },
  { match: starts('/dashboard'), title: 'Overview', description: 'Your campus overview — deadlines, rooms and boards at a glance.', keywords: 'CampusFlow dashboard, campus overview, student deadlines board' },
  { match: starts('/schedule'), title: 'Timetable', description: 'Your weekly period grid — classes, rooms and faculty.', keywords: 'CampusFlow timetable, class schedule grid, periods rooms faculty' },
  { match: starts('/chat'), title: 'Campus Assistant', description: 'Instant answers for courses, exams, schedules and campus life.', keywords: 'CampusFlow AI assistant, campus chatbot, course exam help' },
  { match: detailOf('/assignments'), title: 'Assignment details', description: 'Assignment hub — brief, submissions, grades and feedback.', keywords: 'CampusFlow assignment detail, assignment submission, grading feedback' },
  { match: starts('/assignments'), title: 'Assignments', description: 'Due slips with visibility built in — submit, track and review.', keywords: 'CampusFlow assignments, due slips, assignment submission tracking' },
  { match: starts('/grades'), title: 'Grades', description: 'Your grades board — subjects, GPA and trends.', keywords: 'CampusFlow grades, GPA tracker, subject marks trends' },
  { match: starts('/attendance'), title: 'Attendance', description: 'Track attendance by subject against your required percentage.', keywords: 'CampusFlow attendance, attendance tracker, subject percentage' },
  { match: starts('/tasks'), title: 'Planner', description: 'Your personal planner — tasks, priorities and daily summary.', keywords: 'CampusFlow planner, student tasks, daily priorities summary' },
  { match: starts('/calendar'), title: 'Calendar', description: 'Campus calendar — classes, contests, deadlines and events.', keywords: 'CampusFlow calendar, campus events, class contest deadlines' },
  { match: starts('/notifications'), title: 'Notifications', description: 'Your campus notifications — mentions, deadlines and updates.', keywords: 'CampusFlow notifications, campus alerts, deadline mentions' },
  { match: starts('/search'), title: 'Search', description: 'Search across courses, rooms, assignments and people.', keywords: 'CampusFlow search, find courses rooms assignments people' },
  { match: starts('/insights'), title: 'AI Insights', description: 'AI study insights — plans, conflicts and recommendations.', keywords: 'CampusFlow AI insights, study plan, schedule conflicts' },
  { match: starts('/settings'), title: 'Settings', description: 'Manage your profile, username, AI keys and preferences.', keywords: 'CampusFlow settings, profile preferences, AI keys username' },
  { match: detailOf('/hackathons'), title: 'Hackathon details', description: 'Hackathon rounds, eligibility and registration on CampusFlow.', keywords: 'CampusFlow hackathon detail, hackathon rounds, register eligibility' },
  { match: starts('/hackathons'), title: 'Hackathons', description: 'Hackathons you are eligible for — discover, register and track rounds.', keywords: 'CampusFlow hackathons, student hackathons, register teams rounds' },
  { match: detailOf('/internships'), title: 'Internship details', description: 'Internship role, stipend, eligibility and two-tap apply.', keywords: 'CampusFlow internship detail, internship role stipend, apply' },
  { match: starts('/internships'), title: 'Internships', description: 'Internships matched to your profile — apply in two taps.', keywords: 'CampusFlow internships, student internships, apply matched roles' },
  { match: starts('/teacher/opportunities'), title: 'Teacher Opportunities', description: 'Review and approve student opportunity applications.', keywords: 'CampusFlow teacher opportunities, approve applications, review students' },
  { match: starts('/contests/leaderboard'), title: 'Contest Leaderboard', description: 'Coding contest standings — aggregate ranks without PII emails.', keywords: 'CampusFlow contest leaderboard, coding standings, competitive ranks' },
  { match: starts('/contests'), title: 'Coding Contests', description: 'Upcoming coding contests across platforms — never miss rated rounds.', keywords: 'CampusFlow coding contests, Codeforces LeetCode rounds, rated contests' },
  { match: starts('/coding-profile'), title: 'Coding Profile', description: 'Your competitive programming profile — ratings, solves and streaks.', keywords: 'CampusFlow coding profile, Codeforces rating, LeetCode solves streak' },
  { match: starts('/resume-studio'), title: 'Resume Studio', description: 'Build an ATS-ready resume — templates, AI upgrade and export.', keywords: 'CampusFlow resume studio, ATS resume builder, AI resume templates' },
  { match: starts('/portfolio-studio'), title: 'Portfolio Studio', description: 'Design and publish your portfolio site in minutes.', keywords: 'CampusFlow portfolio studio, student portfolio site, publish projects' },
  { match: detailOf('/forms'), title: 'Form details', description: 'Campus form — fill it, track your response and export.', keywords: 'CampusFlow form detail, fill campus form, track response' },
  { match: starts('/forms'), title: 'Forms', description: 'Campus forms — fill, track responses and export.', keywords: 'CampusFlow forms, campus surveys, fill track export responses' },
  { match: detailOf('/rooms'), title: 'Room details', description: 'Study room with hallway chat, members and presence.', keywords: 'CampusFlow room detail, study room chat, hallway members' },
  { match: starts('/rooms'), title: 'Rooms', description: 'Study rooms with hallway chat, unread and presence.', keywords: 'CampusFlow rooms, study rooms, hallway chat unread presence' },
  { match: detailOf('/alumni'), title: 'Alumni profile', description: 'Verified alumni mentor profile — request mentorship on CampusFlow.', keywords: 'CampusFlow alumni mentor, alumni profile, mentorship request' },
  { match: starts('/alumni'), title: 'Alumni Network', description: 'Verified alumni mentors from your college — request mentorship, track responses, unlock contact after acceptance.', keywords: 'CampusFlow alumni network, verified mentors, mentorship requests' },
  { match: starts('/reports'), title: 'Reports', description: 'Issue reports — college and website scope, tracked to resolution.', keywords: 'CampusFlow reports, issue tracking, college website bugs resolution' },
  { match: starts('/announcements'), title: 'Announcements', description: 'Campus announcements — pinned, filtered and real-time.', keywords: 'CampusFlow announcements, campus notices, pinned updates realtime' },
  { match: starts('/admin/opportunities'), title: 'Admin Opportunities', description: 'Manage campus opportunities — approve, stage and publish.', keywords: 'CampusFlow admin opportunities, stage publish, approve hackathons' },
  { match: starts('/admin/register-college'), title: 'Register college — Admin', description: 'Admin college intake — provision a new tenant on CampusFlow.', keywords: 'CampusFlow admin register college, provision tenant, onboarding' },
  { match: starts('/admin/add-teachers'), title: 'Add teachers — Admin', description: 'Admin bulk teacher onboarding — invite and scope faculty.', keywords: 'CampusFlow add teachers, bulk invite faculty, admin onboarding' },
  { match: starts('/admin/add-students'), title: 'Add students — Admin', description: 'Admin bulk student onboarding — invite and scope learners.', keywords: 'CampusFlow add students, bulk invite learners, admin onboarding' },
  { match: starts('/admin/fetch'), title: 'Fetch Data', description: 'Super admin — fetch and stage external opportunities.', keywords: 'CampusFlow fetch data, stage opportunities, super admin console' },
  { match: starts('/admin/ai-manager'), title: 'AI Manager', description: 'Super admin — manage AI providers and routing.', keywords: 'CampusFlow AI manager, AI providers routing, super admin console' },
  { match: (p) => p === '/admin/dashboard', title: 'Admin redirect', description: 'Redirecting to the CampusFlow superadmin overview.', keywords: 'CampusFlow admin redirect, superadmin overview', canonicalPath: '/superadmin' },
  { match: starts('/admin'), title: 'Admin Panel', description: 'College admin — users, departments, colleges and content.', keywords: 'CampusFlow admin panel, college admin, users departments' },
  { match: detailOf('/superadmin/colleges'), title: 'Superadmin College details', description: 'Platform tenant detail — college scope, users and operations.', keywords: 'CampusFlow superadmin college, tenant detail, platform operations' },
  { match: starts('/superadmin/colleges'), title: 'Superadmin Colleges', description: 'Platform colleges — onboard, scope and operate tenants.', keywords: 'CampusFlow superadmin colleges, onboard tenants, platform colleges' },
  { match: starts('/superadmin/reports'), title: 'Superadmin Reports', description: 'Platform issue triage across all college tenants.', keywords: 'CampusFlow superadmin reports, platform triage, tenant issues' },
  { match: starts('/superadmin'), title: 'Superadmin Overview', description: 'Platform overview — colleges, reports and operations.', keywords: 'CampusFlow superadmin, platform overview, colleges operations' },
]

/** Strip trailing slash (except root) + query/hash for stable matching. */
export function normalizePath(raw: string): string {
  const cut = raw.split(/[?#]/)[0] ?? '/'
  const withSlash = cut.startsWith('/') ? cut : `/${cut}`
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1)
  return withSlash || '/'
}

export function getRouteMeta(path: string): RouteMeta | undefined {
  const n = normalizePath(path)
  return ROUTE_META.find((r) => r.match(n))
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_EXACT.has(normalizePath(path))
}

/** Canonical URL for any path (/landing→/, redirect overrides honored). */
export function buildCanonical(rawPath: string): string {
  const n = normalizePath(rawPath)
  if (n === '/landing') return `${SITE_URL}/`
  const target = getRouteMeta(n)?.canonicalPath ?? n
  return `${SITE_URL}${target === '/' ? '/' : target}`
}

/** JSON-LD: Organization for `/` (logo + sameAs placeholders). */
// WHY brand kit v1.0: logo must be the approved lockup (primary PNG), not legacy icon-512 placeholder.
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'CampusFlow',
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/brand/campusflow-logo-primary.png`,
    description:
      'CampusFlow pins your timetable, rooms, assignments and career boards — live in seconds.',
  }
}

/** JSON-LD: WebSite (sitewide name/url; no SearchAction — /search needs auth). */
export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'CampusFlow',
    alternateName: 'CampusFlow — Campus OS',
    url: `${SITE_URL}/`,
    description: DEFAULT_DESCRIPTION,
    inLanguage: 'en',
  }
}

/** JSON-LD: FAQPage built from the landing `faqs[]` (question + acceptedAnswer). */
export function faqJsonLd(faqs: Array<{ q: string; a: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
}

/** JSON-LD: BreadcrumbList for the current path (Home → …). */
export function breadcrumbJsonLd(
  path: string,
  trail?: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  const items =
    trail ??
    [{ name: 'Home', path: '/' }].concat(
      path !== '/'
        ? [{ name: path.replace(/^\//, '').replace(/-/g, ' '), path }]
        : [],
    )
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: `${SITE_URL}${t.path}`,
    })),
  }
}
