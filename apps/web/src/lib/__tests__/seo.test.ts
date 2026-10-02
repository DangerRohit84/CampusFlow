// SEO deep-coverage tests (TDD) — locks per-page titles/meta/OG/canonical,
// sitemap.xml + robots.txt sync, index.html fallback tags, JSON-LD shapes.
// WHY: SPA SEO regresses silently (single title, missing meta). These tests fail
// if any App.tsx route lacks unique meta or static files drift from Seo SSOT.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SITE_URL,
  PUBLIC_EXACT,
  ROUTE_META,
  getRouteMeta,
  isPublicPath,
  normalizePath,
  buildCanonical,
  organizationJsonLd,
  websiteJsonLd,
  faqJsonLd,
  breadcrumbJsonLd,
} from '../seoMeta'

const ROOT = process.cwd()
function p(...parts: string[]): string {
  return join(ROOT, ...parts)
}
function readPub(f: string): string {
  return readFileSync(p('public', f), 'utf-8')
}

// Every route declared in App.tsx (plus /404 literal). /u/:username is owned
// by PublicProfilePage (RouteSeo skips it) so it must NOT match here.
const ALL_APP_PATHS = [
  '/',
  '/landing',
  '/login',
  '/register',
  '/register-college',
  '/privacy',
  '/terms',
  '/help',
  '/about',
  '/contact',
  '/403',
  '/error',
  '/404',
  '/dashboard',
  '/schedule',
  '/chat',
  '/assignments',
  '/assignments/hub123',
  '/grades',
  '/attendance',
  '/tasks',
  '/calendar',
  '/notifications',
  '/search',
  '/insights',
  '/settings',
  '/hackathons',
  '/hackathons/abc123',
  '/internships',
  '/internships/xyz9',
  '/teacher/opportunities',
  '/contests',
  '/contests/leaderboard',
  '/coding-profile',
  '/resume-studio',
  '/portfolio-studio',
  '/forms',
  '/forms/abc',
  '/rooms',
  '/rooms/abc',
  '/alumni',
  '/alumni/abc',
  '/reports',
  '/announcements',
  '/admin',
  '/admin/opportunities',
  '/admin/register-college',
  '/admin/add-teachers',
  '/admin/add-students',
  '/admin/fetch',
  '/admin/ai-manager',
  '/admin/dashboard',
  '/superadmin',
  '/superadmin/colleges',
  '/superadmin/colleges/c1',
  '/superadmin/reports',
]

describe('seoMeta SSOT', () => {
  it('exposes a canonical https site url', () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+$/)
  })

  it('PUBLIC_EXACT holds the 10 public paths', () => {
    for (const path of [
      '/',
      '/landing',
      '/login',
      '/register',
      '/register-college',
      '/privacy',
      '/terms',
      '/about',
      '/help',
      '/contact',
    ]) {
      expect(PUBLIC_EXACT.has(path)).toBe(true)
    }
    expect(PUBLIC_EXACT.size).toBe(10)
  })

  it('covers EVERY App.tsx route with meta (no page left behind)', () => {
    const missing = ALL_APP_PATHS.filter((path) => !getRouteMeta(path))
    expect(missing).toEqual([])
  })

  it('never claims /u/* (PublicProfilePage owns that tag)', () => {
    expect(getRouteMeta('/u/rohit')).toBeUndefined()
  })

  it('returns undefined for truly unknown paths (NotFoundPage owns SEO)', () => {
    expect(getRouteMeta('/xyz-random-404-probe')).toBeUndefined()
  })

  it('gives every route a UNIQUE title (no duplicate <title>)', () => {
    const titles = ROUTE_META.map((m) => m.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('gives every route a description (20-200 chars) + keywords (2+ terms)', () => {
    for (const m of ROUTE_META) {
      expect(m.description.length).toBeGreaterThanOrEqual(20)
      expect(m.description.length).toBeLessThanOrEqual(200)
      expect(m.keywords).toBeTruthy()
      expect(m.keywords!.split(',').length).toBeGreaterThanOrEqual(2)
    }
  })

  it('marks only PUBLIC_EXACT as public (auth/app pages are noindex)', () => {
    for (const path of ['/', '/login', '/register', '/about', '/help', '/contact', '/privacy', '/terms']) {
      expect(isPublicPath(path)).toBe(true)
    }
    for (const path of [
      '/dashboard',
      '/assignments',
      '/chat',
      '/settings',
      '/admin',
      '/superadmin',
      '/u/rohit',
      '/contests/leaderboard',
      '/404',
      '/xyz-random-404-probe',
    ]) {
      expect(isPublicPath(path)).toBe(false)
    }
  })

  it('normalizes trailing slashes for public checks', () => {
    expect(normalizePath('/about/')).toBe('/about')
    expect(isPublicPath('/about/')).toBe(true)
    expect(normalizePath('/')).toBe('/')
  })

  it('canonicalizes /landing alias to / and /admin/dashboard to /superadmin', () => {
    expect(buildCanonical('/landing')).toBe(`${SITE_URL}/`)
    expect(buildCanonical('/admin/dashboard')).toBe(`${SITE_URL}/superadmin`)
    expect(buildCanonical('/about')).toBe(`${SITE_URL}/about`)
    expect(buildCanonical('/')).toBe(`${SITE_URL}/`)
  })
})

describe('seo JSON-LD builders', () => {
  it('builds Organization with name/url/logo', () => {
    const ld = organizationJsonLd() as Record<string, unknown>
    expect(ld['@type']).toBe('Organization')
    expect(ld['name']).toBe('CampusFlow')
    expect(String(ld['url'])).toContain(SITE_URL)
    expect(String(ld['logo'])).toMatch(/^https:\/\//)
  })

  it('builds WebSite with url (no auth-gated SearchAction)', () => {
    const ld = websiteJsonLd() as Record<string, unknown>
    expect(ld['@type']).toBe('WebSite')
    expect(String(ld['url'])).toContain(SITE_URL)
  })

  it('builds FAQPage from faqs', () => {
    const ld = faqJsonLd([{ q: 'Is it free?', a: 'Yes.' }]) as Record<string, unknown>
    expect(ld['@type']).toBe('FAQPage')
    expect(Array.isArray(ld['mainEntity'])).toBe(true)
  })

  it('builds BreadcrumbList for a path', () => {
    const ld = breadcrumbJsonLd('/about') as Record<string, unknown>
    expect(ld['@type']).toBe('BreadcrumbList')
    const items = ld['itemListElement'] as Array<Record<string, unknown>>
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(String(items[items.length - 1]['item'])).toContain('/about')
  })
})

describe('seo sitemap.xml (public only + lastmod)', () => {
  it('exists with 9 public urls each carrying lastmod', () => {
    expect(existsSync(p('public', 'sitemap.xml'))).toBe(true)
    const xml = readPub('sitemap.xml')
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.length).toBe(9)
    for (const loc of ['/', '/login', '/register', '/register-college', '/about', '/help', '/contact', '/privacy', '/terms']) {
      expect(locs.some((l) => l.endsWith(loc === '/' ? '/' : loc))).toBe(true)
    }
    const lastmods = xml.match(/<lastmod>/g) ?? []
    expect(lastmods.length).toBeGreaterThanOrEqual(locs.length)
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
  })

  it('never lists private surfaces', () => {
    const xml = readPub('sitemap.xml')
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    for (const banned of ['/u/', '/admin', '/superadmin', '/dashboard', '/api/', '/chat', '/settings', '/rooms']) {
      expect(locs.some((l) => l.includes(banned))).toBe(false)
    }
  })
})

describe('seo robots.txt (allow public, disallow private)', () => {
  it('allows the public set + points at the sitemap', () => {
    const robots = readPub('robots.txt')
    for (const allow of ['Allow: /login', 'Allow: /register', 'Allow: /about', 'Allow: /help', 'Allow: /contact']) {
      expect(robots).toContain(allow)
    }
    expect(robots).toContain('Sitemap: https://')
    expect(robots).toContain('/sitemap.xml')
  })

  it('disallows every private/app surface', () => {
    const robots = readPub('robots.txt')
    for (const dis of [
      'Disallow: /dashboard',
      'Disallow: /assignments',
      'Disallow: /grades',
      'Disallow: /attendance',
      'Disallow: /tasks',
      'Disallow: /calendar',
      'Disallow: /notifications',
      'Disallow: /search',
      'Disallow: /insights',
      'Disallow: /settings',
      'Disallow: /chat',
      'Disallow: /rooms/',
      'Disallow: /forms',
      'Disallow: /announcements',
      'Disallow: /alumni',
      'Disallow: /coding-profile',
      'Disallow: /resume-studio',
      'Disallow: /portfolio-studio',
      'Disallow: /reports',
      'Disallow: /admin',
      'Disallow: /superadmin',
      'Disallow: /api/',
      'Disallow: /u/',
      'Disallow: /contests/leaderboard',
      'Disallow: /fetch',
    ]) {
      expect(robots).toContain(dis)
    }
  })
})

describe('seo index.html fallback (no-JS crawlers)', () => {
  it('carries title + description + canonical + keywords + author', () => {
    const html = readFileSync(p('index.html'), 'utf-8')
    expect(html).toContain('<title>CampusFlow')
    expect(html).toContain('name="description"')
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('name="keywords"')
    expect(html).toContain('name="author"')
    expect(html).toContain('lang="en"')
    expect(html).toContain('#1ED760')
  })

  it('carries OG + Twitter fallback tags with absolute PNG + locale', () => {
    const html = readFileSync(p('index.html'), 'utf-8')
    for (const tag of [
      'og:site_name',
      'og:type',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'og:locale',
      'twitter:card',
      'twitter:title',
      'twitter:description',
      'twitter:image',
    ]) {
      expect(html).toContain(tag)
    }
    expect(html).toContain('og-cover.png')
  })

  it('preconnects fonts + preloads the font stylesheet (no FOIT)', () => {
    const html = readFileSync(p('index.html'), 'utf-8')
    expect(html).toContain('fonts.googleapis.com')
    expect(html).toContain('rel="preload" as="style"')
    expect(html).toContain('display=swap')
  })

  it('embeds static Organization + WebSite JSON-LD for no-JS bots', () => {
    const html = readFileSync(p('index.html'), 'utf-8')
    expect(html).toContain('"@type": "Organization"')
    expect(html).toContain('"@type": "WebSite"')
  })
})
