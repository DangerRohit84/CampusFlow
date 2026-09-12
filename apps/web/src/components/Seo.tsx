import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'

const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://campusflow.dev'
// WHY: social crawlers require absolute PNG/JPG (SVG breaks previews).
// og-cover.png (1200x630) is canonical; og-image.png is a byte-identical alias for backwards-compat.
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-cover.png`
const OG_IMAGE_ALT =
  'CampusFlow — Stop hunting timetables in WhatsApp forwards. Photo in, live board out in 14 seconds.'
const APP_NAME = 'CampusFlow'
const DEFAULT_DESCRIPTION =
  'CampusFlow pins your timetable, rooms, assignments and career boards — live in seconds.'

interface SeoProps {
  title?: string
  description?: string
  /** When true, renders `noindex, nofollow` (auth pages, private profiles). */
  noindex?: boolean
  /** Canonical path (defaults to current pathname). */
  canonicalPath?: string
  ogImage?: string
  ogImageAlt?: string
  /** Optional JSON-LD object(s) to inject (Organization, FAQPage, BreadcrumbList). */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>
}

export function Seo({ title, description, noindex, canonicalPath, ogImage, ogImageAlt, jsonLd }: SeoProps) {
  const location = useLocation()
  const rawPath = canonicalPath ?? location.pathname
  // WHY: /landing is an alias of / (301 → / at server + SPA Navigate). Canonical must be / to avoid duplicate ranking.
  const path = rawPath === '/landing' ? '/' : rawPath
  const fullTitle = title ? `${title} — ${APP_NAME}` : `${APP_NAME} — Campus OS`
  const desc = description || DEFAULT_DESCRIPTION
  const canonical = `${SITE_URL}${path === '/' ? '/' : path}`
  const image = ogImage || DEFAULT_OG_IMAGE
  const imageAlt = ogImageAlt || OG_IMAGE_ALT
  const ldList = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []
  // WHY: GSC token via env (VITE_GSC_VERIFICATION). Runtime-injected so missing env = no tag (no build warning).
  const gscToken = (() => {
    try {
      const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.['VITE_GSC_VERIFICATION']
      const t = typeof v === 'string' ? v.trim() : ''
      if (!t || t.startsWith('%VITE_')) return undefined
      return t
    } catch {
      return undefined
    }
  })()
  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      {gscToken ? <meta name="google-site-verification" content={gscToken} /> : null}
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow'} />
      <link rel="canonical" href={canonical} />
      <meta property="og:site_name" content={APP_NAME} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:secure_url" content={image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={imageAlt} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={imageAlt} />
      {ldList.map((ld, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(ld)}
        </script>
      ))}
    </Helmet>
  )
}

/** JSON-LD: Organization for `/` (logo + sameAs placeholders). */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'CampusFlow',
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon-512.png`,
    description:
      'CampusFlow pins your timetable, rooms, assignments and career boards — live in seconds.',
  }
}

/** JSON-LD: FAQPage built from the landing `faqs[]` (question + acceptedAnswer). */
export function faqJsonLd(faqs: Array<{ q: string; a: string }>) {
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
export function breadcrumbJsonLd(path: string, trail?: Array<{ name: string; path: string }>) {
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

// Routes crawlable without auth — everything else gets noindex via RouteSeo.
// WHY CSR: SPA has no SSR — social crawlers read index.html fallback tags + client Helmet on render.
// Prerender/static snapshot note: for full link-preview parity, deploy may prerender the 10 public paths
// below (react-snap / vite-plugin-prerender) and serve snapshots to bots; no framework swap (still Vite SPA,
// index.html fallback + SPA Navigate for /landing→/ covers users). PUBLIC_EXACT = 10 paths (see docs/seo.md).
const PUBLIC_EXACT = new Set([
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

interface RouteMeta {
  match: (path: string) => boolean
  title: string
  description: string
}

const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(prefix + '/')

const ROUTE_META: RouteMeta[] = [
  { match: (p) => p === '/' || p === '/landing', title: 'Campus OS for Colleges', description: 'Stop hunting timetables in WhatsApp forwards. CampusFlow pins timetable, rooms, assignments and career boards — live in 14 seconds.' },
  { match: starts('/login'), title: 'Log in', description: 'Log in to CampusFlow to open your campus board.' },
  { match: (p) => p === '/register' || p.startsWith('/register/'), title: 'Get started free', description: 'Create your free CampusFlow account. No credit card — import your timetable in 14 seconds.' },
  { match: starts('/register-college'), title: 'Register your college', description: 'Onboard your college to CampusFlow — scoped users, departments and boards.' },
  { match: starts('/privacy'), title: 'Privacy Policy', description: 'How CampusFlow collects, scopes and protects your campus data.' },
  { match: starts('/terms'), title: 'Terms of Service', description: 'The terms governing use of CampusFlow.' },
  { match: starts('/about'), title: 'About', description: 'CampusFlow is the hallway board for campus — timetable, rooms and career, pinned.' },
  { match: starts('/help'), title: 'Help & Support', description: 'Get help with CampusFlow — shortcuts, FAQ answers and how to contact support.' },
  { match: starts('/contact'), title: 'Contact us', description: 'Contact the CampusFlow team — support, sales and feedback.' },
  { match: starts('/error'), title: 'Something went wrong', description: 'An unexpected error occurred. Try again or contact support.' },
  { match: (p) => p === '/403', title: 'Access denied', description: 'You do not have access to this page.' },
  { match: starts('/dashboard'), title: 'Overview', description: 'Your campus overview — deadlines, rooms and boards at a glance.' },
  { match: starts('/schedule'), title: 'Timetable', description: 'Your weekly period grid — classes, rooms and faculty.' },
  { match: starts('/chat'), title: 'Campus Assistant', description: 'Instant answers for courses, exams, schedules and campus life.' },
  { match: starts('/assignments'), title: 'Assignments', description: 'Due slips with visibility built in — submit, track and review.' },
  { match: starts('/grades'), title: 'Grades', description: 'Your grades board — subjects, GPA and trends.' },
  { match: starts('/attendance'), title: 'Attendance', description: 'Track attendance by subject against your required percentage.' },
  { match: starts('/tasks'), title: 'Planner', description: 'Your personal planner — tasks, priorities and daily summary.' },
  { match: starts('/calendar'), title: 'Calendar', description: 'Campus calendar — classes, contests, deadlines and events.' },
  { match: starts('/notifications'), title: 'Notifications', description: 'Your campus notifications — mentions, deadlines and updates.' },
  { match: starts('/search'), title: 'Search', description: 'Search across courses, rooms, assignments and people.' },
  { match: starts('/insights'), title: 'AI Insights', description: 'AI study insights — plans, conflicts and recommendations.' },
  { match: starts('/settings'), title: 'Settings', description: 'Manage your profile, username, AI keys and preferences.' },
  { match: starts('/hackathons'), title: 'Hackathons', description: 'Hackathons you are eligible for — discover, register and track rounds.' },
  { match: starts('/internships'), title: 'Internships', description: 'Internships matched to your profile — apply in two taps.' },
  { match: starts('/teacher/opportunities'), title: 'Opportunities', description: 'Review and approve student opportunity applications.' },
  { match: starts('/admin/opportunities'), title: 'Opportunities', description: 'Manage campus opportunities — approve, stage and publish.' },
  { match: starts('/contests'), title: 'Coding Contests', description: 'Upcoming coding contests across platforms — never miss rated rounds.' },
  { match: starts('/coding-profile'), title: 'Coding Profile', description: 'Your competitive programming profile — ratings, solves and streaks.' },
  { match: starts('/resume-studio'), title: 'Resume Studio', description: 'Build an ATS-ready resume — templates, AI upgrade and export.' },
  { match: starts('/portfolio-studio'), title: 'Portfolio Studio', description: 'Design and publish your portfolio site in minutes.' },
  { match: starts('/forms'), title: 'Forms', description: 'Campus forms — fill, track responses and export.' },
  { match: starts('/rooms'), title: 'Rooms', description: 'Study rooms with hallway chat, unread and presence.' },
  { match: starts('/reports'), title: 'Reports', description: 'Issue reports — college and website scope, tracked to resolution.' },
  { match: starts('/announcements'), title: 'Announcements', description: 'Campus announcements — pinned, filtered and real-time.' },
  { match: starts('/admin/fetch'), title: 'Fetch Data', description: 'Super admin — fetch and stage external opportunities.' },
  { match: starts('/admin/ai-manager'), title: 'AI Manager', description: 'Super admin — manage AI providers and routing.' },
  { match: starts('/admin'), title: 'Admin Panel', description: 'College admin — users, departments, colleges and content.' },
  { match: starts('/superadmin'), title: 'Superadmin', description: 'Platform overview — colleges, reports and operations.' },
]

/**
 * Per-route title + description + robots. Mounted once in App.
 * WHY: SEO parity (one Helmet source per route) + privacy — every
 * authenticated route renders `noindex, nofollow` so tenant pages
 * never leak into search engines. `/u/*` is owned by PublicProfilePage
 * (index only when the profile is public).
 * Tenant lists (/hackathons, /internships, /contests details) stay noindex
 * until F01–F04 tenant gates land (documented in docs/seo.md index map).
 */
export function RouteSeo() {
  const location = useLocation()
  const path = location.pathname
  if (path.startsWith('/u/')) return null
  const entry = ROUTE_META.find((r) => r.match(path))
  const isPublic = PUBLIC_EXACT.has(path)
  return <Seo title={entry?.title} description={entry?.description} noindex={!isPublic} />
}
