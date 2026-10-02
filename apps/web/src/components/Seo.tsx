import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'
import {
  APP_NAME,
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_OG_IMAGE_ALT,
  defaultOgImage,
  buildCanonical,
  getRouteMeta,
  isPublicPath,
  websiteJsonLd,
  breadcrumbJsonLd,
} from '../lib/seoMeta'

// Re-export the SEO SSOT so existing callers (`../components/Seo`) keep working
// (LandingPage: organizationJsonLd/faqJsonLd/breadcrumbJsonLd; pages: Seo; App: RouteSeo).
export {
  SITE_URL,
  APP_NAME,
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_OG_IMAGE_ALT,
  defaultOgImage,
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
} from '../lib/seoMeta'

interface SeoProps {
  title?: string
  description?: string
  /** Meta keywords — falls back to DEFAULT_KEYWORDS so every page has some. */
  keywords?: string
  /** When true, renders `noindex, nofollow` (auth pages, private profiles). */
  noindex?: boolean
  /** Canonical path (defaults to current pathname). */
  canonicalPath?: string
  ogImage?: string
  ogImageAlt?: string
  /** Optional JSON-LD object(s) to inject (Organization, WebSite, FAQPage, BreadcrumbList). */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>
}

export function Seo({ title, description, keywords, noindex, canonicalPath, ogImage, ogImageAlt, jsonLd }: SeoProps) {
  const location = useLocation()
  const rawPath = canonicalPath ?? location.pathname
  const fullTitle = title ? `${title} — ${APP_NAME}` : `${APP_NAME} — Campus OS`
  const desc = description || DEFAULT_DESCRIPTION
  const kw = keywords || DEFAULT_KEYWORDS
  // WHY canonical SSOT: buildCanonical honors /landing→/ + redirect overrides
  // (/admin/dashboard→/superadmin) from seoMeta so Helmet always agrees with
  // index.html + sitemap.xml + robots.txt Sitemap (VITE_SITE_URL host).
  const canonical = buildCanonical(rawPath)
  const image = ogImage || defaultOgImage()
  const imageAlt = ogImageAlt || DEFAULT_OG_IMAGE_ALT
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
      <meta name="keywords" content={kw} />
      {gscToken ? <meta name="google-site-verification" content={gscToken} /> : null}
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'} />
      <meta name="author" content={APP_NAME} />
      <link rel="canonical" href={canonical} />
      <meta property="og:site_name" content={APP_NAME} />
      <meta property="og:locale" content="en_US" />
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

/**
 * Per-route title + description + keywords + robots + structured data. Mounted once in App.
 * WHY: SEO parity (one Helmet source per route) + privacy — every
 * authenticated route renders `noindex, nofollow` so tenant pages
 * never leak into search engines. `/u/*` is owned by PublicProfilePage
 * (index only when the profile is public); unknown paths return null so
 * NotFoundPage owns the 404 tag (no duplicate Helmet).
 * Tenant lists (/hackathons, /internships, /contests details) stay noindex
 * until F01–F04 tenant gates land (documented in docs/seo.md index map).
 * Public non-root routes also inject BreadcrumbList; `/` injects WebSite
 * (LandingPage owns Organization + FAQPage + Breadcrumb — no duplicates).
 */
export function RouteSeo() {
  const location = useLocation()
  const path = location.pathname
  if (path.startsWith('/u/')) return null
  const entry = getRouteMeta(path)
  if (!entry) return null
  const isPublic = isPublicPath(path)
  const jsonLd =
    path === '/' || path === '/landing'
      ? [websiteJsonLd()]
      : isPublic
        ? [breadcrumbJsonLd(path)]
        : undefined
  return (
    <Seo
      title={entry?.title}
      description={entry?.description}
      keywords={entry?.keywords}
      noindex={!isPublic}
      canonicalPath={entry?.canonicalPath}
      jsonLd={jsonLd}
    />
  )
}
